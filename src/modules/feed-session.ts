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
 * Phase 7 fills `vehicles` from the event stream. That name does not change: a
 * tracker with a fix is a `VehiclePosition` here, keyed by `Tracker.id`, and
 * an unassigned one is drawn in `CONFIG.VEHICLE_UNMATCHED_COLOR` rather than on
 * a layer of its own.
 */
import { GTFSStatic } from '../gtfs-static';
import type { AlertRecord, TripUpdate } from '../gtfs-rt';
import type { Alert, AlertDetail, Feed, People, Tracker, TrackerDetail } from '../types/api';
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

  staticFeed: GTFSStatic | null = null;
  staticError: string | null = null;
  staticLoadedAt: number | null = null;

  // Live payloads, keyed for lookup by a focused object without waiting for
  // the next push. Replaced wholesale, never mutated in place.
  vehicles = new Map<string, VehiclePosition>();
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
    this.staticFeed = null;
    this.staticError = null;
    this.staticLoadedAt = null;
    this.vehicles = new Map();
    this.alerts = new Map();
    this.tripUpdates = [];
  }
}
