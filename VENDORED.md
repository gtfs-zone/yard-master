# Vendored files

Files copied from a sibling repo are marked with a banner as the very first lines
of the file:

```ts
/* @vendored-from test-track:src/modules/basemap-control.ts
   @sha 56f120a
   @status verbatim */
```

`@status` is one of:
- `verbatim`: byte-identical apart from the banner. Re-sync = overwrite + re-add banner.
- `modified`: adapted. Must be followed by an `@changes` line listing what diverged,
  one bullet per change, so a re-sync knows what to re-apply.
- `adopted`: yard-master's file now. The banner records where it came from and
  nothing is checked, neither drift nor staleness. A file moves here when feature
  work has taken it over far enough that re-syncing has stopped being meaningful.

`adopted` exists so `verbatim` stays a contract that is actually enforced. As the
later phases land, files the features own will drift by design: promote one to
`adopted` rather than contorting the feature to keep a row green. What is left
under `verbatim` is then a real guarantee about the files nobody has taken over.

**test-track is the upstream.** Everything here resolves against it, with one
exception noted below. The earlier two-upstream plan, coloring-book for the shell
and test-track for the realtime modules, did not survive the import graph:
test-track has already adapted coloring-book's map and panel modules from the
editor model to the `GTFSStatic` model yard-master shares, so re-deriving them
from coloring-book would reproduce test-track's files by hand. Where test-track
carries a coloring-book file verbatim the bytes are identical either way, so
those rows resolve against test-track too and the coloring-book origin is
recorded in the note. Nothing ever flows the other way: a change wanted upstream
is made upstream and re-vendored.

The exceptions all name coloring-book. `modal-utils.ts` is one: coloring-book's
copy is a superset of test-track's older one, and `notification-system.ts`
imports `renderCloseIcon` from the newer form. `tooltip-position.ts` and
`spec-markup.ts` are two more, and for the same underlying reason as the
RT spec below — spec-driven form labels are a coloring-book idea that test-track
has no counterpart to, because test-track edits nothing. `breadcrumb-trail.ts`
is the fourth: the crumb shell is shared by all three apps and coloring-book is
where it was written, so both test-track and yard-master vendor it straight
from there rather than through each other.

`src/modules/pages/feed-page.ts`, `src/modules/pages/tracker-page.ts`,
`src/modules/pages/trip-page.ts`, `src/modules/share-modal.ts`,
`src/modules/alerts-modal.ts`,
`src/modules/managed-render.ts`, `src/modules/service-date.ts`,
`src/modules/entity-row.ts` and `src/modules/trip-picker.ts` are in neither
tier and deliberately absent from the table: they are yard-master's own files
with no upstream at all. test-track browses route, stop, vehicle and alert, and
shows a feed status page when nothing is focused; this repo's hierarchy runs
Feed -> Route -> Trip, its home page is the feed itself with the trackers and
routes hanging off it as scrollboxes rather than as pages, and the managed half
of that hierarchy — feeds, trackers, assignments, alerts and members — has no
counterpart upstream at all, because test-track owns none of those objects.
Sharing and the alert list are navbar modals for the same reason: nothing
upstream has an object to put in them. The calendar is a navbar modal too, but
its month grid does have an upstream now — see the table. `entity-row.ts` is the same
kind of file for a different reason: coloring-book's
`utils/entity-references.ts` is its visual model and nothing else, so there is
no upstream to diff it against and nothing about it is checked.

`src/gtfs-rt-spec/` is not vendored and is not in the table. Its *shape* is
coloring-book's `src/gtfs-spec/` — the same `types.ts` / `files/*.ts` /
`index.ts` split, the same verbatim-description discipline, the same
reference-snapshot-plus-checker arrangement — but not one line of its content
comes from a sibling, because coloring-book describes the schedule spec and this
describes the realtime one. There is nothing to re-sync and nothing to diff, so
`vendor-check` is told about none of it. What holds it honest instead is
`scripts/check-rt-spec.ts` against `reference/gtfs-realtime-reference.md`, and
`scripts/check-alert-enums.ts` against cafe-car's `alert_enums.py`. Both run
from `.githooks/pre-commit`.

Run `pnpm vendor:check` to diff every `verbatim` entry against its recorded SHA
in the repo its `Source repo` column names (rows whose sibling is not checked out
are skipped, so CI is never blocked by it). `adopted` rows are listed and then
left alone.

| Local path | Source repo | Source path | SHA | Status | Note |
|---|---|---|---|---|---|
| `src/styles/main.css` | `test-track` | `src/styles/main.css` | 56f120a | verbatim | The whole stylesheet: daisyUI theme block, the panel/map grid and its 768px collapse, the bottom-sheet transforms, and the MapLibre control overrides. test-track's copy is already the no-editor form of coloring-book's, so it is taken from there rather than re-stripped |
| `src/modules/modal-utils.ts` | `coloring-book` | `src/modules/modal-utils.ts` | 52baec7 | modified | `showModal` plus the shared icon builders. Taken from coloring-book, which is a superset of test-track's older copy everywhere except `renderWarningIcon`; see the banner's `@changes`. `notification-system.ts` imports `renderCloseIcon` from here |
| `src/modules/calendar-modal.ts` | `coloring-book` | `src/modules/calendar-modal.ts` | 6ef855e | modified | The month grid's cell shape: `min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30 overflow-hidden`, the day number line, and a `max-h-24 overflow-y-auto` chip stack in place of a fixed count plus `+n more`. See the banner's `@changes`: the chips, the data source and the timeline half are all this repo's own |
| `src/modules/notification-system.ts` | `test-track` | `src/modules/notification-system.ts` | 56f120a | verbatim | Toast system; the `notify` singleton needs an explicit `.initialize()`. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-progress-indicator.ts` | `test-track` | `src/modules/feed-progress-indicator.ts` | 56f120a | verbatim | Top loading bar, keyed by operation name. The singleton touches `document.body` at import time, so it cannot be imported before the DOM exists. Born in coloring-book; test-track carries it verbatim |
| `src/modules/theme-controller.ts` | `test-track` | `src/modules/theme-controller.ts` | 56f120a | verbatim | Applies `data-theme` and persists the choice. Every theme change has to be followed by `clearThemeColorCache()` or MapLibre keeps painting the old accent. Born in coloring-book; test-track carries it verbatim |
| `src/modules/panel-resizer.ts` | `test-track` | `src/modules/panel-resizer.ts` | 56f120a | verbatim | Drag handle on the right panel; persists `--panel-width` to localStorage and exposes `restorePanelWidth()` |
| `src/modules/bottom-sheet.ts` | `test-track` | `src/modules/bottom-sheet.ts` | 56f120a | verbatim | The panel's mobile form below 768px. Re-activates across the breakpoint; `coveredHeight()`/`onSnapChange()` drive the map's bottom padding |
| `src/modules/basemap-styles.ts` | `test-track` | `src/modules/basemap-styles.ts` | 56f120a | verbatim | Six raster basemaps. All are glyph-less, so no `symbol` layer with text can render over them. Born in coloring-book; test-track carries it verbatim |
| `src/modules/basemap-control.ts` | `test-track` | `src/modules/basemap-control.ts` | 56f120a | verbatim | The basemap FAB and the appearance model, injected and persisted by the caller |
| `src/modules/layer-manager.ts` | `test-track` | `src/modules/layer-manager.ts` | 56f120a | modified | Every map layer: stops, route lines and casings, and the moving dots. Fed from `GTFSStatic`, which is why this row resolves against test-track rather than coloring-book, whose copy reads the editor's IndexedDB model. See the banner's `@changes`: a vehicle feature carries `tracker_id` beside the composite `vehicle_id`, so a click on a dot resolves to the tracker it is reporting under |
| `src/modules/stop-layer-style.ts` | `test-track` | `src/modules/stop-layer-style.ts` | 56f120a | verbatim | How a stop circle looks, as pure MapLibre expression builders. Selection is carried by the halo, never by size. Born in coloring-book; test-track carries it verbatim |
| `src/modules/route-sort.ts` | `test-track` | `src/modules/route-sort.ts` | 56f120a | verbatim | Paint order for route lines: `route_type` rank blended with a log-scaled trip count. Feeds `line-sort-key`. Born in coloring-book; test-track carries it verbatim |
| `src/utils/route-colors.ts` | `test-track` | `src/utils/route-colors.ts` | 56f120a | verbatim | Route fill, casing and badge text color, with an OKLCH hue hashed from `route_id` when the feed omits `route_color` |
| `src/utils/theme-color.ts` | `test-track` | `src/utils/theme-color.ts` | 56f120a | verbatim | Resolves a daisyUI theme token to an sRGB hex MapLibre can parse. Cached per token, so `clearThemeColorCache()` must run on every theme change. Born in coloring-book; test-track carries it verbatim |
| `src/modules/search-controller.ts` | `test-track` | `src/modules/search-controller.ts` | 56f120a | verbatim | The map search box. Data-source agnostic: entries come from `search-entries.ts`. Needs `#map-search` inside `#map-search-card`. `SearchEntry.priority` (lower sorts first) buckets by type. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-download.ts` | `test-track` | `src/modules/feed-download.ts` | fa12a57 | verbatim | `downloadWithProgress` (byte progress over a streamed body, `AbortSignal`-aware), `downloadPercent`, `formatBytes`, `LoadCancelledError`. DOM-free on purpose. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-selection.ts` | `test-track` | `src/modules/feed-selection.ts` | 56f120a | verbatim | The `FeedSelection` model and the error describers. Pulled in as a dependency of `feed-download.ts`; yard-master's own feed picker is not built on it, since a feed here is one of your own rows, not a URL you type. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-url-resolve.ts` | `test-track` | `src/modules/feed-url-resolve.ts` | 56f120a | verbatim | `RT_BASE` (re-exported from `CONFIG`), `normalizeFeedUrl`, `validateFeedUrl`, `isLocalUrl`, `splitInnerZipPath`. Born in coloring-book; test-track carries it verbatim |
| `src/modules/about-links.ts` | `test-track` | `src/modules/about-links.ts` | 56f120a | verbatim | The About modal's shared blocks: version/source, the sibling-app links, the GTFS resources list, and the feedback list. Born in coloring-book; test-track carries it verbatim |
| `src/modules/about-modal.ts` | `test-track` | `src/modules/about-modal.ts` | 9656623 | modified | The About modal. See the banner's `@changes`: yard-master's own `AboutApp`, which says plainly that an uploaded schedule is stored and published, and locally rendered Project and Resources blocks, because the shared Project block links manage.rt.gtfs.zone and this app is it |
| `src/gtfs-static.ts` | `test-track` | `src/gtfs-static.ts` | fa12a57 | modified | Downloads and parses a GTFS zip in the browser: stops, routes, trips, stop_times, calendars, shapes, plus the raw row behind every entity. The whole reason the API never has to serve a schedule. See the banner's `@changes`: two arrow characters became `->` |
| `src/gtfs-rt.ts` | `test-track` | `src/gtfs-rt.ts` | 56f120a | modified | The `TripUpdate` / `ServiceAlert` / `AlertRecord` types and `presentNumber`, which is what the vendored panel modules read. The decoder and the poller around them were dropped: yard-master never fetches a `.pb`, and while `FeedMessage.decode` was still reachable protobufjs survived tree-shaking at ~190kB of the built JS. `gtfs-realtime-bindings` is a devDependency now, imported for its types alone |
| `src/map-controller.ts` | `test-track` | `src/map-controller.ts` | 56f120a | modified | MapLibre setup, camera moves and focus. See the banner's `@changes`: the `vehicle` PageState variant became `tracker`, `VehiclePosition` carries a `trackerId`, and follow tracks a tracker rather than one of its vehicles |
| `src/modules/rt-index.ts` | `test-track` | `src/modules/rt-index.ts` | 56f120a | verbatim | Indexes the live payloads by trip and stop, including the derived `current_stop_sequence` `render-utils.ts` marks |
| `src/modules/alerts.ts` | `test-track` | `src/modules/alerts.ts` | 56f120a | verbatim | Alert lookups by route, stop and trip over the session's alert map |
| `src/modules/feed-time.ts` | `test-track` | `src/modules/feed-time.ts` | 56f120a | verbatim | `adoptFeedTimezone` and the feed-local clock helpers. Every transit time is rendered against the feed's zone, never the browser's |
| `src/modules/render-utils.ts` | `test-track` | `src/modules/render-utils.ts` | 56f120a | verbatim | Shared page furniture: `escHtml`, `entityLink`, `routeBadge`, the raw-column table, and the time/delay formatters. `RenderContext.session` resolves against yard-master's own `feed-session.ts`, which is deliberately shaped like test-track's |
| `src/modules/search-entries.ts` | `test-track` | `src/modules/search-entries.ts` | 56f120a | modified | Builds `SearchController` entries from the session. See the banner's `@changes`: the vehicle loop became a tracker loop over the API's list (one entry per tracker, whatever it is running), service alerts were added, and the priorities bucket managed objects ahead of GTFS objects |
| `src/types/page-state.ts` | `test-track` | `src/types/page-state.ts` | 56f120a | modified | The union of every page. See the banner's `@changes`: yard-master's six variants replace test-track's five, and there are no list variants |
| `src/modules/page-state-manager.ts` | `test-track` | `src/modules/page-state-manager.ts` | 56f120a | modified | Owns the current focus, the navigation history and the hash. See the banner's `@changes`: the hash codec is rewritten around an explicit `type` param |
| `src/modules/breadcrumb-trail.ts` | `coloring-book` | `src/modules/breadcrumb-trail.ts` | 138a116 | verbatim | The crumb type vocabulary (`STOP_TYPE_LABELS`, `stopTypeLabel`), the `BreadcrumbItem` shape, the two-line crumb render (`renderBreadcrumbTrail`), the header eyebrow, and `pageTitle`. Only the shell: which crumbs a page state has and how their labels are looked up stays in `breadcrumbs.ts`, since the variant set and the label sources are yard-master's own |
| `src/modules/breadcrumbs.ts` | `test-track` | `src/modules/breadcrumbs.ts` | 5570228 | modified | The breadcrumb trail build and `validateState`, consuming `breadcrumb-trail.ts`'s shared shell. See the banner's `@changes`: the variant set is yard-master's, trackers resolve against the API list, and a managed object is accepted while its list is still empty |
| `src/modules/app-state.ts` | `test-track` | `src/modules/app-state.ts` | fa12a57 | modified | Focus changes and feed selection. See the banner's `@changes`: a feed is an API row rather than a `FeedSelection` of URLs, a linked focus is held pending until the zip it names has parsed, and the feed's event stream and live fleet are owned here |
| `src/types/gtfs-flex.ts` | `test-track` | `src/types/gtfs-flex.ts` | fa12a57 | verbatim | `StopTimeRef`, the one-of behind a stop_time's stop / location group / zone. Pulled in as `route-source.ts`'s vocabulary; this repo ingests no flex tables, so every ref it ever sees is `kind: 'stop'`. Born in coloring-book |
| `src/modules/route-source.ts` | `test-track` | `src/modules/route-source.ts` | fa12a57 | verbatim | The storage-agnostic interface `route-sequence.ts` and `route-graph.ts` read, so the same engine runs over `GTFSStatic` here and the editor's tables in coloring-book. Born in coloring-book |
| `src/modules/gtfs-static-route-source.ts` | `test-track` | `src/modules/gtfs-static-route-source.ts` | fa12a57 | verbatim | `RouteSource` over `GTFSStatic`. The feed is parsed once and never mutated, so it needs no invalidation |
| `src/modules/scs.ts` | `test-track` | `src/modules/scs.ts` | 7347ce9 | verbatim | Shortest common supersequence over stop patterns. The engine behind one strip that shows every pattern on a route. Born in coloring-book |
| `src/modules/route-sequence.ts` | `test-track` | `src/modules/route-sequence.ts` | 7347ce9 | verbatim | Merges a route's trips into one ordered stop list per direction, with per-stop trip counts and repeat-visit handling. Born in coloring-book |
| `src/modules/route-graph.ts` | `test-track` | `src/modules/route-graph.ts` | 7347ce9 | verbatim | Assigns the strip's rows to lanes so branches and merges can be drawn. Born in coloring-book |
| `src/modules/route-strip.ts` | `test-track` | `src/modules/route-strip.ts` | fa12a57 | verbatim | The strip's SVG rail: lane geometry, row paths, dots and the endpoint heuristics. `STRIP_ROW_CLASS` is what `panel-renderer.ts` delegates stop hovering off. Born in coloring-book |
| `src/modules/pages/alert-page.ts` | `test-track` | `src/modules/pages/alert-page.ts` | fa12a57 | modified | `renderAlertList`, which the route, stop and trip pages all embed, plus both alert pages. See the banner's `@changes`: the page renders the managed `Alert` from the API, test-track's decoded-entity page is kept underneath it as the fallback for an alert that is only in the live payload, and the embedded list is drawn on `entity-row.ts` |
| `src/modules/pages/route-page.ts` | `test-track` | `src/modules/pages/route-page.ts` | fa12a57 | modified | The route strip. See the banner's `@changes`: `vehicle` links became `tracker` links, the wording follows, a Trips section lists the direction's trips, and the page's two lists render through `entity-row.ts`. The strip itself is untouched |
| `src/modules/pages/stop-page.ts` | `test-track` | `src/modules/pages/stop-page.ts` | fa12a57 | modified | The stop and station page. See the banner's `@changes`: `vehicle` links became `tracker` links, a departure's headsign links to its trip page, and every list on the page — departures included, which was a `<table>` — renders through `entity-row.ts` |
| `src/modules/panel-renderer.ts` | `test-track` | `src/modules/panel-renderer.ts` | 5570228 | modified | The panel dispatcher, its scroll/`<details>` restore and the shared ticker. See the banner's `@changes`: yard-master's session events (`change`, `vehicles`, `assignments`, `staticloaded`), no status page to hand back to, the six-variant switch, the `meUserId` and `action` hooks the pages emit buttons against, and the breadcrumb trail rendered through the shared `renderBreadcrumbTrail` rather than inline |
| `src/modules/feed-session.ts` | `test-track` | `src/feed-session.ts` | 56f120a | adopted | Not a copy: written here, and deliberately shaped so the vendored modules that read a `FeedSession` compile against it unchanged. test-track's owns a GTFS-RT poller; here the managed objects come from the API and the live half arrives on the SSE channel, so only the `staticFeed` / `vehicles` / `alerts` / `tripUpdates` surface is held in common. Listed so the seam is inventoried rather than invisible |
| `src/utils/tooltip-position.ts` | `coloring-book` | `src/utils/tooltip-position.ts` | 6ee1372 | verbatim | The portal behind every spec tooltip: delegated document listeners, `position: fixed` off the trigger's rect, clamped to the viewport. A CSS tooltip is clipped by the scrollable modal body these labels live in, which is what this exists to sidestep. Its doc comment names coloring-book's own paths, which is what verbatim means |
| `src/utils/spec-markup.ts` | `coloring-book` | `src/utils/spec-markup.ts` | 6ee1372 | modified | Renders a verbatim reference description as HTML: `<br>`, backticks, bold, links, bullets and tables. See the banner's `@changes`: image support removed with the three schedule SVGs it resolved against, `escHtml` from this repo's `render-utils`, and the anchor base pointed at the realtime reference |
