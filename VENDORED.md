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
  work has taken it over far enough that re-syncing has stopped being meaningful,
  here or upstream.
- `origin`: not vendored at all, but the canonical copy another repo vendors
  *from*. Carries no banner, no source repo and no SHA; listed so the table is
  the whole map of what is shared.

`adopted` exists so `verbatim` stays a contract that is actually enforced. Files
the features own will drift by design: promote one to `adopted` rather than
contorting the feature to keep a row green. What is left under `verbatim` is then
a real guarantee about the files nobody has taken over.

The four statuses and the six columns are the same here and in test-track's own
`VENDORED.md`, which adopted this form along with `scripts/vendor-check.ts`.

**test-track is the upstream.** Everything here resolves against it, with one
exception noted below. The earlier two-upstream plan, coloring-book for the shell
and test-track for the realtime modules, did not survive the import graph:
test-track has already adapted coloring-book's map and panel modules from the
editor model to the `GTFSScheduled` model yard-master shares, so re-deriving them
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
from there rather than through each other. `navbar-actions.ts` is the fifth, and
the only one test-track does not have at all: it took `nav-icons.ts` alone and
left its navbar in markup, so the descriptor list comes from coloring-book
directly. `calendar-input.ts` is the sixth, and the second test-track does not
have: it edits nothing, so it has no date to pick. `calendar-modal.ts` is the
seventh, for the same reason as the input: the month grid is coloring-book's and
test-track has no calendar.

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
in the repo its `Source repo` column names, and to report every `verbatim` and
`modified` entry whose source has moved since (rows whose sibling is not checked
out are skipped, so CI is never blocked by it). `adopted` and `origin` rows are
listed and then left alone. `--strict` makes staleness fatal; the pre-commit hook runs
without it on purpose, so a sibling's commit cannot break a commit here.

| Local path | Source repo | Source path | SHA | Status | Note |
|---|---|---|---|---|---|
| `src/styles/main.css` | `test-track` | `src/styles/main.css` | 4be8cb1 | modified | The whole stylesheet: daisyUI theme block, the panel/map grid and its 768px collapse, the bottom-sheet transforms, and the MapLibre control overrides. test-track's copy is already the no-editor form of coloring-book's, so it is taken from there rather than re-stripped. See the banner's `@changes`: test-track grew a mobile dock and this repo has none, so the three `--dock-height` rules are dropped and the panel and the basemap FAB sit on the viewport bottom |
| `src/modules/modal-utils.ts` | `coloring-book` | `src/modules/modal-utils.ts` | 039b6bd | verbatim | `showModal`, the modal stack (`modalStackDepth`/`closeModalsAbove`/`isTopmostModal`/`isOutsideTopModal`), the Tab focus trap, opener-focus restore, and the shared icon builders including `renderWarningIcon`. `notification-system.ts` imports `renderCloseIcon` from here; `sidebar-modal.ts` imports `renderHelpIcon` |
| `src/modules/sidebar-modal.ts` | `test-track` | `src/modules/sidebar-modal.ts` | bf5cc8c | verbatim | The shared sidebar-modal scaffold: a grouped entry list on the left, one rendered pane on the right. `help-modal.ts` renders through it and imports `installGuideButtons` back; the cycle is upstream's and resolves at call time |
| `src/modules/help-modal.ts` | `test-track` | `src/modules/help-modal.ts` | bf5cc8c | verbatim | The help viewer: maps `HELP_PAGES` onto sidebar entries, owns first-run state via `showHelpPageOnce`, and exports the shared `eyebrow`/`lede`/`footnote`/`glyphList` render helpers plus `installGuideButtons` |
| `src/utils/escape-html.ts` | `test-track` | `src/utils/escape-html.ts` | bf5cc8c | verbatim | Regex-based HTML escaping for string-building renderers. Pulled in as a dependency of `help-modal.ts` and `sidebar-modal.ts` |
| `src/modules/nav-icons.ts` | `test-track` | `src/modules/nav-icons.ts` | bf5cc8c | verbatim | The shared navbar/dock icon path map and `renderNavIcon`, plus the filled `renderSunIcon` / `renderMoonIcon` pair. Only `calendar`, `guide` and `load` are drawn here; the rest of the map is coloring-book's editor actions and is kept so the file stays one copy. Born in coloring-book; test-track carries it verbatim |
| `src/modules/navbar-actions.ts` | `coloring-book` | `src/modules/navbar-actions.ts` | dca23b3 | modified | The navbar action row as a descriptor list: one `renderAction` gives every control the same box, tooltip and `aria-label`, so reordering the navbar is a data change. Not vendored through test-track, which took `nav-icons.ts` alone and kept its own markup. See the banner's `@changes`: this repo's own action list, a `link` kind for the account control, `labelId` and `badgeClass`, local `alerts`/`share` icon paths, and no dock |
| `src/modules/calendar-modal.ts` | `coloring-book` | `src/modules/calendar-modal.ts` | dca23b3 | modified | The month grid's cell shape: `min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30 overflow-hidden`, today's `ring-1 ring-primary bg-primary/5`, the day number line, and a `max-h-24 overflow-y-auto` chip stack in place of a fixed count plus `+n more`. See the banner's `@changes`: the chips, the data source and the timeline half are all this repo's own |
| `src/modules/notification-system.ts` | `test-track` | `src/modules/notification-system.ts` | 59e26c4 | verbatim | Toast system; the `notify` singleton needs an explicit `.initialize()`. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-progress-indicator.ts` | `test-track` | `src/modules/feed-progress-indicator.ts` | 59e26c4 | verbatim | Top loading bar, keyed by operation name. The singleton touches `document.body` at import time, so it cannot be imported before the DOM exists. Born in coloring-book; test-track carries it verbatim |
| `src/modules/theme-controller.ts` | `test-track` | `src/modules/theme-controller.ts` | 59e26c4 | verbatim | Applies `data-theme` and persists the choice. Every theme change has to be followed by `clearThemeColorCache()` or MapLibre keeps painting the old accent. Born in coloring-book; test-track carries it verbatim |
| `src/modules/panel-resizer.ts` | `test-track` | `src/modules/panel-resizer.ts` | 59e26c4 | verbatim | Drag handle on the right panel; persists `--panel-width` to localStorage and exposes `restorePanelWidth()`. It takes a structural `PanelResizeTarget` rather than importing `MapController`, so the file carries no app dependency |
| `src/modules/bottom-sheet.ts` | `test-track` | `src/modules/bottom-sheet.ts` | 59e26c4 | verbatim | The panel's mobile form below 768px. Re-activates across the breakpoint; `coveredHeight()`/`onSnapChange()` drive the map's bottom padding. It also drives a `#mobile-dock` and publishes its height as `--dock-height`; there is no dock here, so the constructor's `dockItems` stays empty and neither runs |
| `src/modules/basemap-styles.ts` | `test-track` | `src/modules/basemap-styles.ts` | 59e26c4 | verbatim | Six raster basemaps. All are glyph-less, so no `symbol` layer with text can render over them. Born in coloring-book; test-track carries it verbatim |
| `src/modules/basemap-control.ts` | `test-track` | `src/modules/basemap-control.ts` | bac60b6 | modified | The basemap FAB and the appearance model, injected and persisted by the caller. Globe-only as of `bac60b6`: the projection toggle, `changeProjection` and `MapAppearance.projection` are gone from all three apps, and a `projection` stored by an earlier session is ignored on read. See the banner's `@changes`: `ShapeToggleControl` and `MapAppearance.shapeMode` are kept, since `layer-manager.ts` here still draws a route either from its shape or stop-to-stop |
| `src/modules/layer-manager.ts` | `test-track` | `src/modules/layer-manager.ts` | bac60b6 | adopted | Every map layer: stops, route lines and casings, and the moving dots, fed from `GTFSScheduled`. Re-synced against test-track's `868909e` rewrite, so the shared half is now the vendored `layer-specs.ts` and `stop-layer-style.ts` and what is left is this app's own sources. `adopted` because upstream's remaining manager is the editor's, on `GTFSParser` / IndexedDB, so re-syncing against it has stopped being meaningful; the two spec files carry the contract instead. The banner records the two divergences: a vehicle feature carries `tracker_id` beside the composite `vehicle_id` so a click on a dot resolves to the tracker it is reporting under, and `setShapeMode` stays with `basemap-control.ts`'s toggle |
| `src/modules/layer-specs.ts` | `test-track` | `src/modules/layer-specs.ts` | 868909e | verbatim | The map's layer specification: the stop and route source and layer ids, the stop filters, the two zoom fade bands and the click-area ramp that mirrors them, the route line and casing width ramps, and the spotlight opacity, sort-key and route-match expressions. Pure builders, no DOM, no map handle, no CONFIG: every tunable comes in as an argument. Companion to `stop-layer-style.ts`, which owns how one stop circle looks. Born in coloring-book at `0d38e50`; taken here with the `layer-manager.ts` re-sync |
| `src/modules/map-icons.ts` | `test-track` | `src/modules/map-icons.ts` | 868909e | verbatim | Canvas-drawn map images, registered by `ensureMapIcons(map)` and re-registered on every basemap swap, since `setStyle` drops them. Only `route-arrow`, the chevron laid along the spotlighted route, has a caller here; the seven pathway-mode glyphs are for a screen this app does not have and are kept so the file stays one copy across the three apps. Distinct from `layer-manager`'s own `vehicle-arrow`, which is an SDF so `icon-color` can tint it per route |
| `src/modules/stop-layer-style.ts` | `test-track` | `src/modules/stop-layer-style.ts` | 868909e | verbatim | How a stop circle looks, as pure MapLibre expression builders. Selection is carried by the halo, never by size. Born in coloring-book; test-track carries it verbatim |
| `src/modules/route-sort.ts` | `test-track` | `src/modules/route-sort.ts` | 868909e | verbatim | Paint order for route lines: `route_type` rank blended with a log-scaled trip count. Feeds `line-sort-key`. Born in coloring-book; test-track carries it verbatim |
| `src/utils/route-colors.ts` | `test-track` | `src/utils/route-colors.ts` | 868909e | verbatim | Route fill, casing and badge text color, with an OKLCH hue hashed from `route_id` when the feed omits `route_color` |
| `src/utils/theme-color.ts` | `test-track` | `src/utils/theme-color.ts` | 868909e | verbatim | Resolves a daisyUI theme token to an sRGB hex MapLibre can parse. Cached per token, so `clearThemeColorCache()` must run on every theme change. Born in coloring-book; test-track carries it verbatim |
| `src/modules/search-controller.ts` | `test-track` | `src/modules/search-controller.ts` | e1dbca4 | verbatim | The map search box. Data-source agnostic: entries come from `search-entries.ts`. Needs `#map-search` inside `#map-search-card`. `SearchEntry.priority` (lower sorts first) buckets by type. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-download.ts` | `test-track` | `src/modules/feed-download.ts` | 4350635 | verbatim | `downloadWithProgress` (a `Blob` over a streamed body, with byte progress coalesced to one callback per 100ms and `AbortSignal`-aware), `downloadPercent`, `formatBytes`, `LoadCancelledError`. DOM-free on purpose. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-selection.ts` | `test-track` | `src/modules/feed-selection.ts` | 4350635 | verbatim | The `FeedSelection` model (`scheduled` plus `realtime`) and the error describers. Pulled in as a dependency of `feed-download.ts`; yard-master's own feed picker is not built on it, since a feed here is one of your own rows, not a URL you type. Born in coloring-book; test-track carries it verbatim |
| `src/modules/feed-url-resolve.ts` | `test-track` | `src/modules/feed-url-resolve.ts` | 4350635 | verbatim | `RT_BASE` (re-exported from `CONFIG`), `normalizeFeedUrl`, `validateFeedUrl`, `isLocalUrl`, `splitInnerZipPath`. Born in coloring-book; test-track carries it verbatim |
| `src/modules/about-links.ts` | `test-track` | `src/modules/about-links.ts` | bf5cc8c | verbatim | The About modal's shared blocks: version/source, the sibling-app links, the GTFS resources list, and the feedback list. Born in coloring-book; test-track carries it verbatim |
| `src/modules/help-pages.ts` | `test-track` | `src/modules/help-pages.ts` | 868909e | modified | The help page registry, and this app's help entry point in place of the old standalone `about-modal.ts`. See the banner's `@changes`: `HELP_PAGES` is `[aboutPage]` only (no welcome or map-key page), `AboutApp` is yard-master's own, which says plainly that an uploaded schedule is stored and published, and the Project and Resources blocks are rendered locally rather than through `about-links.ts`, because the shared Project block links manage.rt.gtfs.zone and this app is it |
| `src/gtfs-scheduled.ts` | `test-track` | `src/gtfs-scheduled.ts` | bf5cc8c | verbatim | Downloads and parses a GTFS zip in the browser: stops, routes, trips, stop_times, calendars, shapes, plus the raw row behind every entity. The whole reason the API never has to serve a schedule. Verbatim again since `f54ae79`: it renamed the file and `GTFSStatic` to `GTFSScheduled` and rewrote the two arrow characters that were this row's only divergence |
| `src/gtfs-rt.ts` | `test-track` | `src/gtfs-rt.ts` | e770356 | modified | The `TripUpdate` / `ServiceAlert` / `AlertRecord` types and `presentNumber`, which is what the vendored panel modules read. The decoder and the poller around them were dropped: yard-master never fetches a `.pb`, and while `FeedMessage.decode` was still reachable protobufjs survived tree-shaking at ~190kB of the built JS. `gtfs-realtime-bindings` is a devDependency now, imported for its types alone |
| `src/map-controller.ts` | `test-track` | `src/map-controller.ts` | bac60b6 | modified | MapLibre setup, camera moves and focus. See the banner's `@changes`: the `vehicle` PageState variant became `tracker`, `VehiclePosition` carries a `trackerId`, and follow tracks a tracker rather than one of its vehicles |
| `src/modules/rt-index.ts` | `test-track` | `src/modules/rt-index.ts` | 2076877 | verbatim | Indexes the live payloads by trip and stop, including the derived `current_stop_sequence` `render-utils.ts` marks |
| `src/modules/alerts.ts` | `test-track` | `src/modules/alerts.ts` | f54ae79 | verbatim | Alert lookups by route, stop and trip over the session's alert map |
| `src/modules/feed-time.ts` | `test-track` | `src/modules/feed-time.ts` | f54ae79 | verbatim | `adoptFeedTimezone` and the feed-local clock helpers. Every transit time is rendered against the feed's zone, never the browser's |
| `src/modules/render-utils.ts` | `test-track` | `src/modules/render-utils.ts` | 846e955 | verbatim | Shared page furniture: `escHtml`, `entityLink`, `routeBadge`, `pageHeader`, the raw-column table, the time/delay formatters, and the `schedule_relationship` vocabulary (`TRIP_SCHEDULE_RELATIONSHIP_LABELS`, `tripRelationshipMark` and their stop-time pair). `RenderContext.session` resolves against yard-master's own `feed-session.ts`, which is deliberately shaped like test-track's |
| `src/modules/search-entries.ts` | `test-track` | `src/modules/search-entries.ts` | f54ae79 | modified | Builds `SearchController` entries from the session. See the banner's `@changes`: the vehicle loop became a tracker loop over the API's list (one entry per tracker, whatever it is running), service alerts were added, and the priorities bucket managed objects ahead of GTFS objects |
| `src/types/page-state.ts` | `test-track` | `src/types/page-state.ts` | 4be8cb1 | modified | The union of every page. See the banner's `@changes`: yard-master's six variants replace test-track's five, and there are no list variants |
| `src/modules/page-state-manager.ts` | `test-track` | `src/modules/page-state-manager.ts` | e1dbca4 | modified | Owns the current focus, the navigation history and the hash. See the banner's `@changes`: the hash codec is rewritten around an explicit `type` param |
| `src/modules/breadcrumb-trail.ts` | `coloring-book` | `src/modules/breadcrumb-trail.ts` | dca23b3 | verbatim | The crumb type vocabulary (`STOP_TYPE_LABELS`, `stopTypeLabel`), the `BreadcrumbItem` shape, the two-line crumb render (`renderBreadcrumbTrail`), the header eyebrow, and `pageTitle`. Only the shell: which crumbs a page state has and how their labels are looked up stays in `breadcrumbs.ts`, since the variant set and the label sources are yard-master's own |
| `src/modules/breadcrumbs.ts` | `test-track` | `src/modules/breadcrumbs.ts` | df7813b | modified | The breadcrumb trail build and `validateState`, consuming `breadcrumb-trail.ts`'s shared shell. Every crumb label is capped at 40 characters, since a producer that writes a sentence into an alert's `header_text` would otherwise wrap a crumb over several lines. See the banner's `@changes`: the variant set is yard-master's, trackers resolve against the API list, and a managed object is accepted while its list is still empty |
| `src/modules/app-state.ts` | `test-track` | `src/modules/app-state.ts` | f9d3e2c | modified | Focus changes and feed selection. See the banner's `@changes`: a feed is an API row rather than a `FeedSelection` of URLs, a linked focus is held pending until the zip it names has parsed, and the feed's event stream and live fleet are owned here |
| `src/types/gtfs-flex.ts` | `test-track` | `src/types/gtfs-flex.ts` | 9abe974 | verbatim | `StopTimeRef`, the one-of behind a stop_time's stop / location group / zone. Pulled in as `route-source.ts`'s vocabulary; this repo ingests no flex tables, so every ref it ever sees is `kind: 'stop'`. Born in coloring-book |
| `src/modules/route-source.ts` | `test-track` | `src/modules/route-source.ts` | 9abe974 | verbatim | The storage-agnostic interface `route-sequence.ts` and `route-graph.ts` read, so the same engine runs over `GTFSScheduled` here and the editor's tables in coloring-book. Born in coloring-book |
| `src/modules/gtfs-scheduled-route-source.ts` | `test-track` | `src/modules/gtfs-scheduled-route-source.ts` | f54ae79 | verbatim | `RouteSource` over `GTFSScheduled`. The feed is parsed once and never mutated, so it needs no invalidation |
| `src/modules/scs.ts` | `test-track` | `src/modules/scs.ts` | 9abe974 | verbatim | Shortest common supersequence over stop patterns. The engine behind one strip that shows every pattern on a route. Born in coloring-book |
| `src/modules/route-sequence.ts` | `test-track` | `src/modules/route-sequence.ts` | 9abe974 | verbatim | Merges a route's trips into one ordered stop list per direction, with per-stop trip counts and repeat-visit handling. Born in coloring-book |
| `src/modules/route-graph.ts` | `test-track` | `src/modules/route-graph.ts` | 9abe974 | verbatim | Assigns the strip's rows to lanes so branches and merges can be drawn. Born in coloring-book |
| `src/modules/route-strip.ts` | `test-track` | `src/modules/route-strip.ts` | 9abe974 | verbatim | The strip's SVG rail: lane geometry, row paths, dots and the endpoint heuristics. `STRIP_ROW_CLASS` is what `panel-renderer.ts` delegates stop hovering off. Born in coloring-book |
| `src/modules/pages/alert-page.ts` | `test-track` | `src/modules/pages/alert-page.ts` | 5570228 | modified | `renderAlertList`, which the route, stop and trip pages all embed, plus both alert pages. The header is `pageHeader` and the status, level and active window are properties, both taken from upstream. See the banner's `@changes`: the page renders the managed `Alert` from the API, test-track's decoded-entity page is kept underneath it as the fallback for an alert that is only in the live payload, and the embedded list is drawn on `entity-row.ts` |
| `src/modules/pages/route-page.ts` | `test-track` | `src/modules/pages/route-page.ts` | 3f5d8e2 | modified | The route strip, headed by `pageHeader` with the route badge, with the mode and agency as properties. See the banner's `@changes`: `vehicle` links became `tracker` links, the wording follows, a Trips section lists the direction's trips, and the page's two lists render through `entity-row.ts`. The strip itself is untouched |
| `src/modules/pages/stop-page.ts` | `test-track` | `src/modules/pages/stop-page.ts` | bf5cc8c | modified | The stop and station page, headed by `pageHeader`; the location type is the crumb's eyebrow through `stopTypeLabel` rather than a line of its own. See the banner's `@changes`: `vehicle` links became `tracker` links, a departure's headsign links to its trip page, and every list on the page — departures included, which was a `<table>` — renders through `entity-row.ts` |
| `src/modules/panel-renderer.ts` | `test-track` | `src/modules/panel-renderer.ts` | 5570228 | modified | The panel dispatcher, its scroll/`<details>` restore and the shared ticker. See the banner's `@changes`: yard-master's session events (`change`, `vehicles`, `assignments`, `scheduleloaded`), no status page to hand back to, the six-variant switch, the `meUserId` and `action` hooks the pages emit buttons against, and the breadcrumb trail rendered through the shared `renderBreadcrumbTrail` rather than inline |
| `src/modules/feed-session.ts` | `test-track` | `src/modules/feed-session.ts` | 4be8cb1 | adopted | Not a copy: written here, and deliberately shaped so the vendored modules that read a `FeedSession` compile against it unchanged. test-track's owns a GTFS-RT poller; here the managed objects come from the API and the live half arrives on the SSE channel, so only the `scheduledFeed` / `vehicles` / `alerts` / `tripUpdates` surface is held in common. Listed so the seam is inventoried rather than invisible |
| `src/utils/tooltip-position.ts` | `coloring-book` | `src/utils/tooltip-position.ts` | 3c3f412 | verbatim | The portal behind every spec tooltip: delegated document listeners, `position: fixed` off the trigger's rect, clamped to the viewport. A CSS tooltip is clipped by the scrollable modal body these labels live in, which is what this exists to sidestep. Its doc comment names coloring-book's own paths, which is what verbatim means |
| `src/utils/calendar-input.ts` | `coloring-book` | `src/utils/calendar-input.ts` | 47a4341 | verbatim | The month grid behind every date box: `openCalendar`, `attachCalendarInput` and `ISO_DATE_CODEC`. It imports nothing and holds no value — the codec, the week start and the anchor input are all handed in, which is what lets one component serve a service date and the date half of an alert window. `entity-form.ts` attaches it to every `date` field and to a `datetime`'s date box |
| `scripts/vendor-check.ts` | — | — | — | origin | Not vendored: written here, and the one file the flow runs backwards for. test-track adopted this table's `Source repo`-aware form in its Phase 1 and vendors the script from here `modified` at `5dc61ef`, differing only in its doc comment. Listed so the table is the whole map of what is shared |
| `src/utils/spec-markup.ts` | `coloring-book` | `src/utils/spec-markup.ts` | dca23b3 | modified | Renders a verbatim reference description as HTML: `<br>`, backticks, bold, links, bullets and tables. See the banner's `@changes`: image support removed with the three schedule SVGs it resolved against, `escHtml` from this repo's `render-utils`, and the anchor base pointed at the realtime reference |
