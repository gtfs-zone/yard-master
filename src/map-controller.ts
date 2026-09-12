/* @vendored-from test-track:src/map-controller.ts
   @sha 459c4e7
   @status modified
   @changes
   - The `vehicle` PageState variant became `tracker`, keyed by `Tracker.id`. The
     LayerManager target kind stays `vehicle` — that is the map layer's own
     vocabulary — but carries the `trackerId` a click has to navigate by.
   - `applyFocus` covers yard-master's variant set. `alert` clears the focus
     without moving the camera, since a managed alert has no geometry of its
     own; `home` reframes the whole feed.
   - `trip` draws the trip's own geometry on a source this file owns, spotlights
     its route and frames it. LayerManager has no `trip` focus kind, so the
     shape lives here instead. The same source takes a whole
     day's assigned trips at once, which is what a selected day in the
     assignments calendar draws.
   - `VehiclePosition` grows a `trackerId`. A tracker can carry several
     concurrent vehicles, so `key` is the tracker *plus* the trip instance and
     something else has to say which tracker they belong to; upstream's feeds
     have no such object.
   - The last pushed positions are kept here so a `tracker` focus can resolve
     the tracker's vehicles. LayerManager's layer is keyed by `key`, so it
     cannot answer "which of these is this tracker's".
   - The shape/stops render toggle is kept: `BasemapControl` is held on a field
     and wired to `LayerManager.setShapeMode`. Upstream dropped the control, so
     this repo's `basemap-control.ts` keeps it too. */
import maplibregl from 'maplibre-gl';
import { CONFIG } from './config';
import type { GTFSScheduled } from './gtfs-scheduled';
import type { PageState } from './types/page-state';
import { BasemapControl, initialMapStyle } from './modules/basemap-control';
import type { MapAppearance } from './modules/basemap-control';
import { LayerManager } from './modules/layer-manager';
import type { MapDataIssues } from './modules/layer-manager';
import { STOP_FOCUS_HALO_LAYER } from './modules/stop-layer-style';
import { resolveThemeColor } from './utils/theme-color';

export interface VehiclePosition {
  /**
   * The internal instance handle: the map feature id, the key in
   * `FeedSession.vehicles`, and the click identity. Built by cafe-car as the
   * surrogate `Tracker.id` plus the trip instance, which is the `vehicle:*`
   * Redis key without its prefix, so it is unique even when one tracker is
   * carrying several concurrent vehicles.
   */
  key: string;
  /**
   * The surrogate `Tracker.id` this vehicle is reporting under. Several
   * vehicles can share one, which is the whole reason `key` is not it.
   */
  trackerId: string;
  /**
   * The feed's `vehicle.id`, **verbatim** — duplicated, empty, whatever the feed
   * said. This is reportage, never plumbing: it is what the vehicle page shows
   * and dumps, and never synthesized.
   */
  vehicleId: string;
  entityId: string;
  label?: string;
  lat: number;
  lon: number;
  bearing?: number;
  /** Metres per second, as the spec defines it. */
  speed?: number;
  tripId?: string;
  routeId?: string;
  directionId?: string;
  startDate?: string;
  startTime?: string;
  /** TripDescriptor.schedule_relationship, or undefined when the producer omitted it. */
  scheduleRelationship?: number;
  /**
   * The GTFS `stop_sequence` value of the stop the vehicle is working on — not
   * an index into the trip's stop list. Absent in many feeds, which is why the
   * route strip has an "unplaced vehicles" section.
   */
  currentStopSequence?: number;
  /** `stop_id` of the same stop, when the feed reports it. */
  stopId?: string;
  /** VehicleStopStatus: 0 INCOMING_AT, 1 STOPPED_AT, 2 IN_TRANSIT_TO. */
  currentStatus?: number;
  occupancyStatus?: number;
  /** Seconds since epoch, per the spec. Stale values are worth surfacing. */
  timestamp?: number;
  /** The decoded entity, kept verbatim for the vehicle page's raw dump. */
  raw: unknown;
}

interface MapView {
  center: [number, number];
  zoom: number;
  bearing: number;
  pitch: number;
}

const DEFAULT_VIEW: MapView = { center: [0, 30], zoom: 2, bearing: 0, pitch: 0 };

/**
 * Map view and appearance live in localStorage rather than the URL: they are
 * per-device preferences, not part of what a shared link describes (Plan 03).
 */
function readStored<T>(key: string): Partial<T> | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Partial<T>) : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing / quota — appearance simply won't persist.
  }
}

function restoreView(): MapView {
  const stored = readStored<MapView>(CONFIG.MAP_VIEW_KEY);
  if (
    !stored ||
    !Array.isArray(stored.center) ||
    stored.center.length !== 2 ||
    !stored.center.every(Number.isFinite) ||
    typeof stored.zoom !== 'number'
  ) {
    return DEFAULT_VIEW;
  }
  return {
    center: stored.center as [number, number],
    zoom: stored.zoom,
    bearing: stored.bearing ?? 0,
    pitch: stored.pitch ?? 0,
  };
}

/** The trip overlay's own source and layers, owned here rather than by LayerManager. */
const TRIP_SOURCE = 'ym-trip-shape';
const TRIP_CASING_LAYER = 'ym-trip-shape-casing';
const TRIP_LINE_LAYER = 'ym-trip-shape-line';
const TRIP_LINE_WIDTH = 4;

/** Same token LayerManager paints selection in, resolved the same way. */
function tripAccent(): string {
  return resolveThemeColor('--color-primary', '#3b82f6');
}

/** Bounding box of a path, or null when there is nothing to frame. */
function boundsOf(path: [number, number][] | null): [[number, number], [number, number]] | null {
  if (!path || path.length === 0) return null;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [lon, lat] of path) {
    if (lon < west) west = lon;
    if (lon > east) east = lon;
    if (lat < south) south = lat;
    if (lat > north) north = lat;
  }
  return [
    [west, south],
    [east, north],
  ];
}

export class MapController {
  private map!: maplibregl.Map;
  private layers!: LayerManager;
  private basemap!: BasemapControl;
  private resizeTimeout: ReturnType<typeof setTimeout> | null = null;
  private viewSaveTimeout: ReturnType<typeof setTimeout> | null = null;
  /** Height of the mobile bottom sheet, kept out of the camera's way. */
  private bottomPadding = 0;

  /** The parsed feed, for the geometry LayerManager does not hold: trip paths. */
  private feed: GTFSScheduled | null = null;

  /**
   * Flips true exactly once, on the first `load`, and never back. Work issued
   * before that point is queued and flushed in order; nothing else consults
   * `map.loaded()`, which goes false on every dirty frame and would silently
   * drop map updates issued mid-repaint (see Plan 06 Root cause A).
   */
  private ready = false;
  private pending: Array<() => void> = [];

  /**
   * The `Tracker.id` currently being followed, or null. Focusing a tracker
   * enters follow mode; each positions push re-centres on its newest fix until
   * the user takes the camera back (see the gesture listeners in
   * `initialize`). Focusing anything else — including home and alert — leaves
   * follow mode.
   *
   * A tracker rather than a vehicle key, because a tracker running several
   * trips would otherwise stop being followed the moment the instance the
   * camera latched onto ended.
   */
  private following: string | null = null;

  /**
   * The last positions handed to `showVehicles`. LayerManager holds these too
   * but is keyed by `key` alone, and this file needs to ask which of them
   * belong to one tracker.
   */
  private positions: VehiclePosition[] = [];

  /**
   * The drawn trip geometry, held so it can be re-added after a `setStyle`.
   * Empty when nothing is focused, or when nothing focused has a drawable path.
   *
   * A list rather than one path: a focused trip is one of these, and a selected
   * day in the assignments calendar is every trip assigned on it.
   */
  private tripShapes: [number, number][][] = [];

  /**
   * The trip ids `showTrips` last drew, so a re-draw with the same set leaves
   * the camera alone. The calendar re-reads its window after every write, and
   * refitting on each one would fight whoever is looking at the map.
   */
  private drawnTripKey = '';

  /** Called when the user clicks a stop, route, or vehicle on the map. */
  onSelect: ((state: PageState) => void) | null = null;

  /** Called when the user clicks the map away from any feature. */
  onEmptySelect: (() => void) | null = null;

  initialize(container: string): void {
    const view = restoreView();
    const appearance = readStored<MapAppearance>(CONFIG.MAP_APPEARANCE_KEY) ?? {};

    this.map = new maplibregl.Map({
      container,
      style: initialMapStyle(appearance),
      center: view.center,
      zoom: view.zoom,
      bearing: view.bearing,
      pitch: view.pitch,
    });
    // Bottom-left is the only free corner: `#map-controls` covers the top strip
    // and the basemap FAB owns bottom-right.
    this.map.addControl(new maplibregl.NavigationControl(), 'bottom-left');

    this.layers = new LayerManager(this.map);
    this.layers.onSelect = target => {
      switch (target.kind) {
        case 'stop':
          this.onSelect?.({ type: 'stop', stop_id: target.id });
          break;
        case 'route':
          this.onSelect?.({ type: 'route', route_id: target.id });
          break;
        case 'vehicle':
          // The map's moving dots are trackers, addressed by their surrogate.
          // `target.id` is the composite feature key, never a tracker id.
          if (target.trackerId) {
            this.onSelect?.({ type: 'tracker', tracker_id: target.trackerId });
          }
          break;
      }
    };
    this.layers.onEmptySelect = () => this.onEmptySelect?.();

    this.basemap = new BasemapControl(this.map, {
      initial: appearance,
      onRenderModeChange: mode => this.layers.setShapeMode(mode),
      onAppearanceChange: next => writeStored(CONFIG.MAP_APPEARANCE_KEY, next),
    });
    this.layers.setShapeMode(this.basemap.getShapeMode());

    this.map.once('load', () => {
      this.layers.rebuild();
      this.layers.attachInteraction();
      this.ready = true;
      const queued = this.pending;
      this.pending = [];
      for (const fn of queued) fn();
    });

    // setStyle drops every source and layer we own, so each basemap or
    // projection change has to re-add them. This is the single highest-risk
    // path in the map: without it, switching basemaps blanks all GTFS data.
    this.map.on('basemap:changed', () => {
      this.layers.rebuild();
      // setStyle dropped the trip source along with LayerManager's, so it has
      // to be re-added and re-filled here too.
      this.drawTripShape();
    });

    this.map.on('moveend', () => this.queueViewSave());

    // A user-initiated camera gesture unlocks follow permanently for the
    // current focus. Our own programmatic easeTo/fitBounds carry no
    // `originalEvent`, which is exactly what distinguishes them from a real
    // drag/scroll/rotate/pitch — so the follow ease itself never unlocks.
    for (const type of ['dragstart', 'zoomstart', 'rotatestart', 'pitchstart'] as const) {
      this.map.on(type, e => {
        if ((e as { originalEvent?: unknown }).originalEvent) this.following = null;
      });
    }
  }

  /** Feed problems the map found, for the status page. */
  get issues(): MapDataIssues {
    return this.layers.issues;
  }

  private queueViewSave(): void {
    if (this.viewSaveTimeout) clearTimeout(this.viewSaveTimeout);
    this.viewSaveTimeout = setTimeout(() => {
      const center = this.map.getCenter();
      writeStored(CONFIG.MAP_VIEW_KEY, {
        center: [center.lng, center.lat],
        zoom: this.map.getZoom(),
        bearing: this.map.getBearing(),
        pitch: this.map.getPitch(),
      } satisfies MapView);
      this.viewSaveTimeout = null;
    }, CONFIG.MAP_VIEW_SAVE_DEBOUNCE);
  }

  private whenLoaded(fn: () => void): void {
    if (this.ready) fn();
    else this.pending.push(fn);
  }

  loadScheduledFeed(feed: GTFSScheduled): void {
    this.feed = feed;
    this.whenLoaded(() => {
      this.layers.setScheduledFeed(feed);
      this.fitFeed();
    });
  }

  clearScheduledFeed(): void {
    this.feed = null;
    this.tripShapes = [];
    this.drawnTripKey = '';
    this.whenLoaded(() => {
      this.layers.setScheduledFeed(null);
      this.drawTripShape();
    });
  }

  showVehicles(positions: VehiclePosition[]): void {
    // Held outside `whenLoaded` so a focus that lands before the style is up
    // can still resolve a tracker's vehicles.
    this.positions = positions;
    this.whenLoaded(() => {
      this.layers.setVehicles(positions);
      // Follow: re-centre on the followed tracker's new position. If it has
      // stopped reporting, leave the camera where it is — the tracker page
      // says so in words rather than the map lying with a stale dot.
      if (this.following) {
        const v = this.trackerVehicle(this.following);
        if (v) {
          this.map.easeTo({
            center: [v.lon, v.lat],
            duration: CONFIG.FOLLOW_DURATION,
            essential: true,
          });
        }
      }
    });
  }

  clearVehicles(): void {
    this.positions = [];
    this.whenLoaded(() => this.layers.setVehicles([]));
  }

  /**
   * A tracker's most recently reported vehicle, or undefined when it has none.
   *
   * Most recent rather than first: scan order is not the fleet's order, and a
   * tracker running several trips should be followed on the one that just
   * moved.
   */
  private trackerVehicle(trackerId: string): VehiclePosition | undefined {
    let best: VehiclePosition | undefined;
    for (const p of this.positions) {
      if (p.trackerId !== trackerId) continue;
      if (!best || (p.timestamp ?? 0) > (best.timestamp ?? 0)) best = p;
    }
    return best;
  }

  /**
   * Frame the loaded feed. Every schedule load refits, reloads included: the old
   * "camera is already inside the bbox" bail-out skipped the fit whenever the
   * stored view happened to sit in the new feed's box, and the only thing that
   * framed the feed after that was a click-in/click-out returning focus to home.
   *
   * Instant, with no duration: on the boot path a deep link's focus ease runs
   * right after this and would visibly interrupt an animated fit.
   */
  private fitFeed(): void {
    const bounds = this.layers.stopsBounds();
    if (!bounds) return;
    this.map.fitBounds(bounds, { padding: this.padding() });
  }

  private padding(): maplibregl.PaddingOptions {
    return { top: 40, left: 40, right: 40, bottom: 40 + this.bottomPadding };
  }

  /**
   * Reserve space at the bottom of the map for the mobile bottom sheet, so a
   * focused feature isn't hidden behind it.
   */
  setBottomPadding(px: number): void {
    this.bottomPadding = px;
  }

  // ── Focus ──────────────────────────────────────────────────────────────────

  /**
   * Highlight the focused object and move the camera to it. Called for every
   * focus change, including one restored from a link.
   */
  focus(state: PageState): void {
    this.whenLoaded(() => this.applyFocus(state));
  }

  /**
   * Light up a stop the pointer is over elsewhere in the app (a route strip
   * row). Purely visual: no camera move, no focus change, no spotlight. Not
   * wrapped in `whenLoaded` - a hover queued behind style load would fire long
   * after the pointer left.
   */
  hoverStop(stop_id: string | null): void {
    this.layers?.setHoveredStop(stop_id);
  }

  /**
   * Repaint the accent-colored map layers against the now-active theme. The
   * accent is resolved from the DaisyUI palette, so it only changes here.
   */
  refreshAccentColor(): void {
    this.layers?.refreshAccentColor();
    if (this.map?.getLayer(TRIP_LINE_LAYER)) {
      this.map.setPaintProperty(TRIP_LINE_LAYER, 'line-color', tripAccent());
    }
  }

  private applyFocus(state: PageState): void {
    // Any focus that is not this same tracker leaves follow mode.
    if (state.type !== 'tracker') this.following = null;

    switch (state.type) {
      case 'home': {
        this.clearTrip();
        this.layers.setFocus(null);
        // Unfocusing frames the whole feed again, mirroring how focusing a
        // route frames that route.
        const bounds = this.layers.stopsBounds();
        if (bounds) {
          this.map.fitBounds(bounds, {
            padding: this.padding(),
            duration: CONFIG.FOCUS_BOUNDS_DURATION,
            essential: true,
          });
        }
        return;
      }

      case 'alert':
        // A page with no geometry of its own. Nothing to highlight or fly to;
        // the camera stays where the reader left it.
        this.clearTrip();
        this.layers.setFocus(null);
        return;

      case 'trip': {
        const path = this.tripPath(state.trip_id);
        this.tripShapes = path ? [path] : [];
        this.drawnTripKey = '';
        this.drawTripShape();
        // No route-wide spotlight here: dimming every stop but the route's
        // would leave only whichever of them fall in the trip's own tight
        // bounds looking highlighted, which reads as one stop lit at random.
        this.layers.setFocus(null);
        const bounds = boundsOf(path);
        if (bounds) {
          this.map.fitBounds(bounds, {
            padding: this.padding(),
            maxZoom: 15,
            duration: CONFIG.FOCUS_BOUNDS_DURATION,
            essential: true,
          });
        }
        return;
      }

      case 'route': {
        this.clearTrip();
        this.layers.setFocus({ kind: 'route', id: state.route_id });
        const bounds = this.layers.routeBounds(state.route_id);
        if (bounds) {
          this.map.fitBounds(bounds, {
            padding: this.padding(),
            maxZoom: 15,
            duration: CONFIG.FOCUS_BOUNDS_DURATION,
            essential: true,
          });
        }
        return;
      }

      case 'stop': {
        this.clearTrip();
        this.layers.setFocus({ kind: 'stop', id: state.stop_id });
        this.easeToPoint(this.layers.focusPosition(state.stop_id));
        return;
      }

      case 'tracker': {
        this.clearTrip();
        // The layer is keyed by `key`, so a tracker running several vehicles
        // spotlights its most recent one; the panel lists all of them.
        const vehicle = this.trackerVehicle(state.tracker_id);
        this.layers.setFocus(
          vehicle ? { kind: 'vehicle', id: vehicle.key, trackerId: vehicle.trackerId } : null
        );
        // Re-arm follow on this tracker (a different one replaces the old).
        this.following = state.tracker_id;
        if (vehicle) this.easeToPoint([vehicle.lon, vehicle.lat]);
        return;
      }
    }
  }

  // ── Trip geometry ──────────────────────────────────────────────────────────

  /**
   * The path to draw for a trip: its `shapes.txt` polyline where the feed has
   * one, and otherwise the straight line through its stops in `stop_sequence`
   * order. The fallback is a real approximation and is drawn dashed to say so.
   */
  private tripPath(tripId: string): [number, number][] | null {
    const feed = this.feed;
    const trip = feed?.trips.get(tripId);
    if (!feed || !trip) return null;

    const shape = trip.shape_id ? feed.shapes.get(trip.shape_id) : undefined;
    if (shape && shape.length > 1) return shape;

    const points: [number, number][] = [];
    for (const time of feed.stopTimesByTrip.get(tripId) ?? []) {
      const stop = feed.stops.get(time.stop_id);
      if (stop) points.push([stop.lon, stop.lat]);
    }
    return points.length > 1 ? points : null;
  }

  private clearTrip(): void {
    this.drawnTripKey = '';
    if (this.tripShapes.length === 0) return;
    this.tripShapes = [];
    this.drawTripShape();
  }

  /**
   * Draw a set of trips at once: the assignments calendar's selected day.
   *
   * Called after `focus`, which has already cleared whatever the previous page
   * drew, and again whenever the expansion is re-read. The camera moves only
   * when the set itself changes, so a refresh that finds the same trips does
   * not yank the view back.
   */
  showTrips(tripIds: string[]): void {
    const key = tripIds.join('\u0000');
    this.whenLoaded(() => {
      const changed = key !== this.drawnTripKey;
      this.drawnTripKey = key;
      this.tripShapes = tripIds
        .map((id) => this.tripPath(id))
        .filter((path): path is [number, number][] => path !== null);
      this.drawTripShape();
      if (!changed) return;

      const bounds = boundsOf(this.tripShapes.flat());
      if (bounds) {
        this.map.fitBounds(bounds, {
          padding: this.padding(),
          maxZoom: 15,
          duration: CONFIG.FOCUS_BOUNDS_DURATION,
          essential: true,
        });
      }
    });
  }

  /** Add the trip source and layers if missing, then publish the current path. */
  private drawTripShape(): void {
    if (!this.ready) return;

    if (!this.map.getSource(TRIP_SOURCE)) {
      this.map.addSource(TRIP_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      });
      // Under the stop and vehicle layers, over the route lines: the trip is a
      // path through the network, not a thing sitting on top of it.
      const before = this.map.getLayer(STOP_FOCUS_HALO_LAYER) ? STOP_FOCUS_HALO_LAYER : undefined;
      this.map.addLayer(
        {
          id: TRIP_CASING_LAYER,
          type: 'line',
          source: TRIP_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': '#000000',
            'line-opacity': 0.35,
            'line-width': TRIP_LINE_WIDTH + 4,
          },
        },
        before
      );
      this.map.addLayer(
        {
          id: TRIP_LINE_LAYER,
          type: 'line',
          source: TRIP_SOURCE,
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': tripAccent(), 'line-width': TRIP_LINE_WIDTH },
        },
        before
      );
    }

    const source = this.map.getSource(TRIP_SOURCE) as maplibregl.GeoJSONSource;
    source.setData({
      type: 'FeatureCollection',
      features: this.tripShapes.map((path) => ({
        type: 'Feature',
        properties: {},
        geometry: { type: 'LineString', coordinates: path },
      })),
    });
  }

  /**
   * Ease to a point, always. Focusing something moves the camera to it — unlike
   * the earlier "already visible" bail-out, which left the camera where it was
   * and made a panel click feel like it did nothing.
   */
  private easeToPoint(point: [number, number] | null): void {
    if (!point) return;
    this.map.easeTo({
      center: point,
      zoom: Math.max(this.map.getZoom(), CONFIG.STOP_FOCUS_ZOOM),
      padding: { top: 0, left: 0, right: 0, bottom: this.bottomPadding },
      duration: CONFIG.FOCUS_POINT_DURATION,
      essential: true,
    });
  }

  // ── Sizing ─────────────────────────────────────────────────────────────────

  /** Immediate resize — called on every frame of a panel drag. */
  resizeNow(): void {
    this.map?.resize();
  }

  /**
   * Deferred resize for after a CSS transition settles. Restores center and
   * zoom so the viewport doesn't jump when the canvas changes size.
   */
  forceMapResize(): void {
    if (!this.map) return;

    if (this.resizeTimeout) clearTimeout(this.resizeTimeout);

    this.resizeTimeout = setTimeout(() => {
      const center = this.map.getCenter();
      const zoom = this.map.getZoom();

      this.map.resize();
      this.map.setCenter(center);
      this.map.setZoom(zoom);

      this.resizeTimeout = null;
    }, 350);
  }
}
