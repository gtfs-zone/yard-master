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
 * Phase 1 carries the static half. Phase 3 adds the selected feed and its API
 * objects; phases 6 and 7 fill `vehicles` from the event stream and the
 * positions endpoint. Those names do not change: a tracker with a fix is a
 * `VehiclePosition` here, keyed by nickname.
 */
import { GTFSStatic } from '../gtfs-static';
import type { AlertRecord, TripUpdate } from '../gtfs-rt';
import type { VehiclePosition } from '../map-controller';
import { adoptFeedTimezone } from './feed-time';
import { feedProgressIndicator } from './feed-progress-indicator';
import { downloadPercent, formatBytes, LoadCancelledError } from './feed-download';

export class FeedSession extends EventTarget {
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

  /** Drop everything. Called when the selected feed changes. */
  clear(): void {
    this.cancelLoad();
    this.staticFeed = null;
    this.staticError = null;
    this.staticLoadedAt = null;
    this.vehicles = new Map();
    this.alerts = new Map();
    this.tripUpdates = [];
    this.dispatchEvent(new CustomEvent('change'));
  }
}
