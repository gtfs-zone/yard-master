/* @vendored-from test-track:src/feed-session.ts
   @sha 56f120a
   @status adopted */
/**
 * Owns whatever is currently selected: the parsed static GTFS, and the live
 * payloads the map and the panel read.
 *
 * Adopted, not copied. test-track's `feed-session.ts` is built around a GTFS-RT
 * poller it owns; here the managed objects come from the API and the live half
 * arrives on the SSE channel, so only the shape the vendored modules read
 * (`staticFeed`, `vehicles`, `alerts`, `tripUpdates`) is deliberately the same.
 * Every module that takes a `FeedSession` reads it through that surface, which
 * is what lets them stay verbatim.
 *
 * The selected feed and its managed objects live here alongside the static
 * half, and the two are deliberately independent: `feed` and `trackers` are
 * populated the moment a feed is chosen, while `staticFeed` arrives whenever
 * the zip finishes downloading, or never, if `static_feed_url` is unreachable.
 * Every reader has to cope with one without the other.
 *
 * `vehicles` is filled from two places that must be indistinguishable: the
 * whole live fleet, fetched once on selection, and every fix after that,
 * pushed one at a time down the event channel. cafe-car builds both with one
 * function, so neither this class nor anything reading it needs to know which
 * a vehicle came through.
 *
 * **Nothing tells this app a vehicle has gone away.** A position record expires
 * out of Redis after 60s and an expiry is not an event, so a vehicle that is
 * only ever added would sit on the map forever, in the last place it was seen,
 * looking exactly like one that is still reporting. `pruneVehicles` is what
 * makes presence mean the same thing here as it does on the server, and it
 * counts from the moment a fix *arrived* rather than from the timestamp inside
 * it: the timestamp is the producer's clock, and a phone with a skewed one
 * would otherwise be either immortal or invisible.
 */
import { CONFIG } from '../config';
import { GTFSStatic } from '../gtfs-static';
import type { AlertRecord, TripUpdate } from '../gtfs-rt';
import type {
  Alert,
  AlertDetail,
  Assignment,
  Feed,
  GtfsUpload,
  LoadStatus as LoadStatusRow,
  People,
  Tracker,
  TrackerDetail,
  TrackerRule,
} from '../types/api';
import type { ServiceDate } from './service-date';
import type { VehiclePosition } from '../map-controller';
import { adoptFeedTimezone } from './feed-time';
import { feedProgressIndicator } from './feed-progress-indicator';
import { downloadPercent, formatBytes, LoadCancelledError } from './feed-download';

export class FeedSession extends EventTarget {
  /** The selected feed's API row, or null when nothing is selected. */
  feed: Feed | null = null;

  /** This feed's trackers, keyed by `Tracker.id`. No `device_key` in here. */
  trackers = new Map<string, Tracker>();

  /**
   * Tracker detail, keyed by `Tracker.id`. This is the only place in the app
   * that holds a `device_key`, it is fetched when the properties panel asks for
   * it, and it is dropped with the rest of the feed's data on the next
   * selection. Nothing else may read it.
   */
  trackerDetails = new Map<string, TrackerDetail>();

  /**
   * The feed's managed service alerts, keyed by `String(Alert.id)` — the same
   * key a `PageState` of type `alert` carries.
   *
   * Deliberately not `alerts`: that name belongs to the decoded GTFS-RT
   * records the vendored modules read, and the two are different objects. A
   * managed alert is a row this app writes; an `AlertRecord` is what a
   * consumer of the published feed sees.
   */
  serviceAlerts = new Map<string, Alert>();

  /** Alerts whose informed entities have been fetched, by the same key. */
  alertDetails = new Map<string, AlertDetail>();

  /** Members and pending invites, or null until the list has arrived. */
  people: People | null = null;

  /**
   * The feed's schedule uploads, newest first, or null until they have been
   * asked for. Empty is a real answer — a linked feed has none — so the null
   * matters: a page that read `[]` as "no uploads" would say so while the
   * request was still out.
   */
  uploads: GtfsUpload[] | null = null;

  /**
   * The feed's assignment rules as stored, keyed by rule id, or null until
   * they have been fetched.
   *
   * Null rather than an empty map, because the difference matters: a trip page
   * that read an empty map as "no tracker is assigned to this" would say so
   * confidently while the request was still out. The rules are not fetched on
   * selection like the trackers are — they are only needed by the calendar and
   * by a trip page — so "not yet asked for" is the normal state.
   */
  rules: Map<number, TrackerRule> | null = null;

  /**
   * The rules expanded over the window the calendar last asked for, by service
   * date. The expansion is the server's, so the calendar and the resolver
   * cannot disagree about which day a rule runs.
   */
  assignments = new Map<ServiceDate, Assignment[]>();

  /** The window `assignments` covers, inclusive, or null if none is loaded. */
  assignmentsRange: { from: ServiceDate; to: ServiceDate } | null = null;

  staticFeed: GTFSStatic | null = null;
  staticError: string | null = null;
  staticLoadedAt: number | null = null;

  /**
   * Every vehicle currently reporting, keyed by `VehiclePosition.key` — the
   * surrogate `Tracker.id` plus the trip instance, which is what the map
   * feature is keyed by too.
   *
   * Not keyed by tracker: one tracker can be running several concurrent
   * vehicles, and keying by tracker would silently keep only the last one to
   * arrive. `vehiclesFor` is how a tracker's vehicles are asked for.
   */
  vehicles = new Map<string, VehiclePosition>();

  /** When each vehicle's latest fix reached this browser, by the same key. */
  private vehicleArrivals = new Map<string, number>();

  /**
   * When each tracker was last reporting, by `Tracker.id`, and kept after its
   * vehicles expire. This is the whole "last seen 4m ago" the list shows: the
   * server has no such record, because a fix that has expired is simply gone
   * from Redis, so a tracker's history only exists for as long as this session
   * has been watching it.
   */
  private trackerArrivals = new Map<string, number>();

  alerts = new Map<string, AlertRecord>();
  tripUpdates: TripUpdate[] = [];

  private controller: AbortController | null = null;

  /**
   * Select a feed, discarding everything belonging to the previous one.
   *
   * The static half is not started here: the caller decides whether to
   * download the zip, because the managed half of the app is usable without it
   * and a slow feed must not gate the tree.
   */
  selectFeed(feed: Feed): void {
    this.cancelLoad();
    this.clearData();
    this.feed = feed;
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Replace the selected feed's row in place, keeping everything loaded. */
  updateFeed(feed: Feed): void {
    this.feed = feed;
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * Replace just the load half of the selected feed, from the event stream.
   *
   * A new object rather than a mutation of `feed.load`, so a renderer that
   * held the old row still sees the state it rendered. Nothing else on the
   * feed is touched: the stream reports on the loader, and a rename or a
   * repointed URL arrives through `updateFeed` instead.
   */
  setLoadStatus(load: LoadStatusRow | null): void {
    if (!this.feed) return;
    this.feed = { ...this.feed, load };
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * Replace the whole live fleet, from `GET /feeds/{id}/tracker-positions`.
   *
   * Wholesale, so a vehicle that stopped reporting between two calls is gone
   * rather than lingering. Arrival times are stamped now: the fetch is what
   * proved these are live, whatever the producer's clock says.
   */
  setVehicles(positions: VehiclePosition[]): void {
    const now = Date.now();
    this.vehicles = new Map(positions.map((v) => [v.key, v]));
    this.vehicleArrivals = new Map(positions.map((v) => [v.key, now]));
    for (const v of positions) this.trackerArrivals.set(v.trackerId, now);
    this.dispatchEvent(new CustomEvent('vehicles'));
  }

  /**
   * Apply one pushed fix, replacing that vehicle and leaving the rest alone.
   *
   * A `Map` set rather than a rebuilt map: a fleet of fifty reporting every
   * ten seconds is five of these a second, and the map layer diffs by feature
   * id, so replacing one entry is the whole update.
   */
  applyVehicle(vehicle: VehiclePosition): void {
    const now = Date.now();
    this.vehicles.set(vehicle.key, vehicle);
    this.vehicleArrivals.set(vehicle.key, now);
    this.trackerArrivals.set(vehicle.trackerId, now);
    this.dispatchEvent(new CustomEvent('vehicles'));
  }

  /**
   * Drop vehicles whose last fix is older than the server's own TTL, and say
   * whether anything went.
   *
   * The caller decides how often to ask; nothing here holds a timer, so a
   * session that is not being ticked simply stops expiring rather than keeping
   * one alive against a feed nobody is looking at.
   */
  pruneVehicles(): boolean {
    const cutoff = Date.now() - CONFIG.TRACKER_STALE_MS;
    let dropped = false;
    for (const [key, at] of this.vehicleArrivals) {
      if (at > cutoff) continue;
      this.vehicles.delete(key);
      this.vehicleArrivals.delete(key);
      dropped = true;
    }
    if (dropped) this.dispatchEvent(new CustomEvent('vehicles'));
    return dropped;
  }

  /**
   * One tracker's vehicles, newest fix first.
   *
   * Usually zero or one. A producer running many vehicles under a single
   * credential (a whole fleet on one Traccar device) returns all of them, and
   * the tracker page lists all of them, because showing the first one the scan
   * happened to return would silently hide the rest.
   */
  vehiclesFor(trackerId: string): VehiclePosition[] {
    const mine: VehiclePosition[] = [];
    for (const v of this.vehicles.values()) {
      if (v.trackerId === trackerId) mine.push(v);
    }
    return mine.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }

  /**
   * When this tracker last had a fix, in epoch milliseconds, or null if it has
   * not had one while this session was watching. Not "never reported": a
   * tracker that went quiet before the app was opened is indistinguishable
   * from one that has never reported at all, and claiming otherwise would be
   * inventing a history the server does not keep.
   */
  lastSeen(trackerId: string): number | null {
    return this.trackerArrivals.get(trackerId) ?? null;
  }

  /** Replace the tracker list. Wholesale, so a deleted tracker disappears. */
  setTrackers(trackers: Tracker[]): void {
    this.trackers = new Map(trackers.map((t) => [t.id, t]));
    // A detail fetched for a tracker that is no longer in the list is stale,
    // and it holds a credential, so it goes rather than lingering in memory.
    for (const id of this.trackerDetails.keys()) {
      if (!this.trackers.has(id)) this.trackerDetails.delete(id);
    }
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Cache one tracker's detail, credential included. */
  setTrackerDetail(detail: TrackerDetail): void {
    this.trackerDetails.set(detail.id, detail);
    // The summary is a strict subset, so the list row is refreshed with it and
    // a rename made elsewhere shows up without a second request.
    this.trackers.set(detail.id, {
      id: detail.id,
      nickname: detail.nickname,
      feed_id: detail.feed_id,
    });
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Replace the rule list. Wholesale, so a deleted rule disappears. */
  setRules(rules: TrackerRule[]): void {
    this.rules = new Map(rules.map((r) => [r.id, r]));
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * Replace the expanded window.
   *
   * Its own event rather than `change`: the map draws the selected day's trips
   * off this, and `change` fires for every managed list and every detail fetch
   * as well.
   */
  setAssignments(from: ServiceDate, to: ServiceDate, rows: Assignment[]): void {
    const byDate = new Map<ServiceDate, Assignment[]>();
    for (const row of rows) {
      const day = byDate.get(row.service_date);
      if (day) day.push(row);
      else byDate.set(row.service_date, [row]);
    }
    this.assignments = byDate;
    this.assignmentsRange = { from, to };
    this.dispatchEvent(new CustomEvent('assignments'));
  }

  /** What is assigned on one service date, earliest window first. */
  assignmentsOn(date: ServiceDate): Assignment[] {
    return this.assignments.get(date) ?? [];
  }

  /** Every rule naming this trip, for the trip page. Empty when unfetched. */
  rulesForTrip(tripId: string): TrackerRule[] {
    if (!this.rules) return [];
    return [...this.rules.values()].filter((r) => r.trip_id === tripId);
  }

  /** Replace the managed alert list. Wholesale, like the trackers. */
  setServiceAlerts(alerts: Alert[]): void {
    this.serviceAlerts = new Map(alerts.map((a) => [String(a.id), a]));
    for (const key of this.alertDetails.keys()) {
      if (!this.serviceAlerts.has(key)) this.alertDetails.delete(key);
    }
    this.dispatchEvent(new CustomEvent('change'));
  }

  /** Cache one alert's detail, which is the only form carrying its entities. */
  setAlertDetail(detail: AlertDetail): void {
    const key = String(detail.id);
    this.alertDetails.set(key, detail);
    this.serviceAlerts.set(key, detail);
    this.dispatchEvent(new CustomEvent('change'));
  }

  setUploads(uploads: GtfsUpload[]): void {
    this.uploads = uploads;
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * Say plainly that there is no zip to fetch, rather than leaving the panel
   * on "downloading" forever.
   *
   * The case is a hosted feed with no upload yet, which is every hosted feed
   * for the moment between its creation and its first zip.
   */
  noStatic(reason: string): void {
    this.cancelLoad();
    this.staticFeed = null;
    this.staticError = reason;
    this.staticLoadedAt = null;
    this.dispatchEvent(new CustomEvent('change'));
  }

  setPeople(people: People): void {
    this.people = people;
    this.dispatchEvent(new CustomEvent('change'));
  }

  /**
   * Download and parse a feed's zip in the browser.
   *
   * The managed half of the app stays usable throughout, so an unreachable or
   * malformed `static_feed_url` sets `staticError` and resolves rather than
   * throwing at the caller.
   */
  async loadStatic(url: string, label: string): Promise<void> {
    this.cancelLoad();
    const controller = new AbortController();
    this.controller = controller;

    const feed = new GTFSStatic();

    // Download and parse are separate operations so the bar shows real byte
    // progress first, then per-file parse progress.
    let parsing = false;
    const hooks = {
      onDownload: (loaded: number, total: number | null) => {
        feedProgressIndicator.updateProgress(
          'static-download',
          downloadPercent(loaded, total) ?? 0,
          total
            ? `Downloading ${label} - ${formatBytes(loaded)} of ${formatBytes(total)}`
            : `Downloading ${label} - ${formatBytes(loaded)}`
        );
      },
      onParse: (fileName: string, done: number, total: number) => {
        if (!parsing) {
          parsing = true;
          feedProgressIndicator.finishLoading('static-download');
          feedProgressIndicator.startLoading('static-parse', `Parsing ${label}…`);
        }
        feedProgressIndicator.updateProgress(
          'static-parse',
          Math.round((done / total) * 100),
          `Parsing ${label} - ${fileName}`
        );
      },
      signal: controller.signal,
    };

    feedProgressIndicator.startLoading('static-download', `Downloading ${label}…`, {
      onCancel: () => controller.abort(),
    });

    try {
      await feed.loadFromUrl(url, hooks);
      this.staticFeed = feed;
      // Every transit time rendered from here on is anchored to this feed's zone.
      adoptFeedTimezone(feed);
      this.staticError = null;
      this.staticLoadedAt = Date.now();
      // Separate from `change` because the map has to reload its sources on
      // this and on nothing else; `change` fires for every tracker update too.
      this.dispatchEvent(new CustomEvent<GTFSStatic>('staticloaded', { detail: feed }));
    } catch (err) {
      // A cancel is not a feed error: the previously loaded feed stays live.
      if (!(err instanceof LoadCancelledError)) {
        this.staticError = err instanceof Error ? err.message : String(err);
      }
    } finally {
      if (this.controller === controller) this.controller = null;
      feedProgressIndicator.finishLoading('static-download');
      feedProgressIndicator.finishLoading('static-parse');
      this.dispatchEvent(new CustomEvent('change'));
    }
  }

  cancelLoad(): void {
    this.controller?.abort();
    this.controller = null;
  }

  /** Drop everything, including the selection. */
  clear(): void {
    this.cancelLoad();
    this.feed = null;
    this.clearData();
    this.dispatchEvent(new CustomEvent('change'));
  }

  private clearData(): void {
    this.trackers = new Map();
    this.trackerDetails = new Map();
    this.serviceAlerts = new Map();
    this.alertDetails = new Map();
    this.people = null;
    this.uploads = null;
    this.rules = null;
    this.assignments = new Map();
    this.assignmentsRange = null;
    this.staticFeed = null;
    this.staticError = null;
    this.staticLoadedAt = null;
    this.vehicles = new Map();
    this.vehicleArrivals = new Map();
    this.trackerArrivals = new Map();
    this.alerts = new Map();
    this.tripUpdates = [];
  }
}
