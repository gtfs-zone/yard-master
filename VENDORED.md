# Vendored files

Files copied from a sibling repo are marked with a banner as the very first lines
of the file:

```ts
/* @vendored-from coloring-book:src/modules/basemap-control.ts
   @sha f9c718c
   @status verbatim */
```

`@status` is one of:
- `verbatim`: byte-identical apart from the banner. Re-sync = overwrite + re-add banner.
- `modified`: adapted. Must be followed by an `@changes` line listing what diverged,
  one bullet per change, so a re-sync knows what to re-apply.

Unlike test-track, which has a single upstream, yard-master vendors from **two**
repos: `coloring-book` (the canonical source for map, panel and shell modules)
and `test-track` (the realtime modules, which have no coloring-book equivalent).
The `Source repo` column names which sibling a row resolves against. Nothing
here ever flows the other way: a change wanted upstream is made upstream and
re-vendored.

A row names the sibling whose bytes were actually taken, which is not always the
repo the file originated in. Several modules pass through test-track on the way
here: test-track has already adapted them from coloring-book's editor model to
the `GTFSStatic` model yard-master shares, so re-doing that adaptation against
coloring-book would produce test-track's file a second time. Where test-track
records a file as `verbatim` from coloring-book the bytes are identical either
way, so those rows name coloring-book and carry test-track's recorded SHA.

Run `pnpm vendor:check` to diff every `verbatim` entry against its recorded SHA
in the repo its `Source repo` column names (rows whose sibling is not checked out
are skipped, so CI is never blocked by it).

| Local path | Source repo | Source path | SHA | Status | Note |
|---|---|---|---|---|---|
| `src/styles/main.css` | `test-track` | `src/styles/main.css` | 56f120a | verbatim | The whole stylesheet: daisyUI theme block, the panel/map grid and its 768px collapse, the bottom-sheet transforms, and the MapLibre control overrides. test-track's copy is already the no-editor form of coloring-book's, so it is taken from there rather than re-stripped |
| `src/modules/modal-utils.ts` | `coloring-book` | `src/modules/modal-utils.ts` | 52baec7 | verbatim | `showModal` plus the shared icon builders. Taken from coloring-book, which is a superset of test-track's older copy; `notification-system.ts` imports `renderCloseIcon` from here |
| `src/modules/notification-system.ts` | `coloring-book` | `src/modules/notification-system.ts` | 51e8536 | verbatim | Toast system; the `notify` singleton needs an explicit `.initialize()` |
| `src/modules/feed-progress-indicator.ts` | `coloring-book` | `src/modules/feed-progress-indicator.ts` | c6199c5 | verbatim | Top loading bar, keyed by operation name. The singleton touches `document.body` at import time, so it cannot be imported before the DOM exists |
| `src/modules/theme-controller.ts` | `coloring-book` | `src/modules/theme-controller.ts` | a4b5ee1 | verbatim | Applies `data-theme` and persists the choice. Every theme change has to be followed by `clearThemeColorCache()` or MapLibre keeps painting the old accent |
| `src/modules/panel-resizer.ts` | `test-track` | `src/modules/panel-resizer.ts` | 56f120a | verbatim | Drag handle on the right panel; persists `--panel-width` to localStorage and exposes `restorePanelWidth()` |
| `src/modules/bottom-sheet.ts` | `test-track` | `src/modules/bottom-sheet.ts` | 56f120a | verbatim | The panel's mobile form below 768px. Re-activates across the breakpoint; `coveredHeight()`/`onSnapChange()` drive the map's bottom padding |
| `src/modules/basemap-styles.ts` | `coloring-book` | `src/modules/basemap-styles.ts` | f9c718c | verbatim | Six raster basemaps. All are glyph-less, so no `symbol` layer with text can render over them |
| `src/modules/basemap-control.ts` | `test-track` | `src/modules/basemap-control.ts` | 56f120a | verbatim | The basemap FAB and the appearance model, injected and persisted by the caller |
| `src/modules/layer-manager.ts` | `test-track` | `src/modules/layer-manager.ts` | 56f120a | verbatim | Every map layer: stops, route lines and casings, and the moving dots. Fed from `GTFSStatic`, which is why this row resolves against test-track rather than coloring-book, whose copy reads the editor's IndexedDB model |
| `src/modules/stop-layer-style.ts` | `coloring-book` | `src/modules/stop-layer-style.ts` | cfecd04 | verbatim | How a stop circle looks, as pure MapLibre expression builders. Selection is carried by the halo, never by size |
| `src/modules/route-sort.ts` | `coloring-book` | `src/modules/route-sort.ts` | a4b5ee1 | verbatim | Paint order for route lines: `route_type` rank blended with a log-scaled trip count. Feeds `line-sort-key` |
| `src/utils/route-colors.ts` | `test-track` | `src/utils/route-colors.ts` | 56f120a | verbatim | Route fill, casing and badge text color, with an OKLCH hue hashed from `route_id` when the feed omits `route_color` |
| `src/utils/theme-color.ts` | `coloring-book` | `src/utils/theme-color.ts` | a4b5ee1 | verbatim | Resolves a daisyUI theme token to an sRGB hex MapLibre can parse. Cached per token, so `clearThemeColorCache()` must run on every theme change |
| `src/utils/issue-card.ts` | `test-track` | `src/utils/issue-card.ts` | 56f120a | verbatim | `renderIssueCard(title, rows)`: the warning card of label/count/note rows, empty when every count is zero |
| `src/modules/search-controller.ts` | `coloring-book` | `src/modules/search-controller.ts` | a4b5ee1 | verbatim | The map search box. Data-source agnostic: entries come from `search-entries.ts`. Needs `#map-search` inside `#map-search-card`. `SearchEntry.priority` (lower sorts first) buckets by type |
| `src/modules/feed-download.ts` | `coloring-book` | `src/modules/feed-download.ts` | e7d7fe0 | verbatim | `downloadWithProgress` (byte progress over a streamed body, `AbortSignal`-aware), `downloadPercent`, `formatBytes`, `LoadCancelledError`. DOM-free on purpose |
| `src/modules/feed-selection.ts` | `coloring-book` | `src/modules/feed-selection.ts` | e328ab1 | verbatim | The `FeedSelection` model and the error describers. Pulled in as a dependency of `feed-download.ts` and `gtfs-rt.ts`; yard-master's own feed picker is not built on it, since a feed here is one of your own rows, not a URL you type |
| `src/modules/feed-url-resolve.ts` | `coloring-book` | `src/modules/feed-url-resolve.ts` | e328ab1 | verbatim | `RT_BASE` (re-exported from `CONFIG`), `normalizeFeedUrl`, `validateFeedUrl`, `isLocalUrl`, `splitInnerZipPath` |
| `src/modules/about-links.ts` | `coloring-book` | `src/modules/about-links.ts` | 2c858bf | verbatim | The About modal's shared blocks: version/source, the sibling-app links, the GTFS resources list, and the feedback list |
| `src/gtfs-static.ts` | `test-track` | `src/gtfs-static.ts` | 56f120a | verbatim | Downloads and parses a GTFS zip in the browser: stops, routes, trips, stop_times, calendars, shapes, plus the raw row behind every entity. The whole reason the API never has to serve a schedule |
| `src/gtfs-rt.ts` | `test-track` | `src/gtfs-rt.ts` | 56f120a | verbatim | The GTFS-RT decoder and its `VehiclePosition` / `TripUpdate` / `AlertRecord` types. yard-master does not poll a `.pb`; the types are what the vendored panel and map modules are written against |
| `src/map-controller.ts` | `test-track` | `src/map-controller.ts` | 56f120a | modified | MapLibre setup, camera moves and focus. See the banner's `@changes`: the `vehicle` PageState variant became `tracker`, keyed by nickname |
| `src/modules/rt-index.ts` | `test-track` | `src/modules/rt-index.ts` | 56f120a | verbatim | Indexes the live payloads by trip and stop, including the derived `current_stop_sequence` `render-utils.ts` marks |
| `src/modules/alerts.ts` | `test-track` | `src/modules/alerts.ts` | 56f120a | verbatim | Alert lookups by route, stop and trip over the session's alert map |
| `src/modules/feed-time.ts` | `test-track` | `src/modules/feed-time.ts` | 56f120a | verbatim | `adoptFeedTimezone` and the feed-local clock helpers. Every transit time is rendered against the feed's zone, never the browser's |
| `src/modules/render-utils.ts` | `test-track` | `src/modules/render-utils.ts` | 56f120a | verbatim | Shared page furniture: `escHtml`, `entityLink`, `routeBadge`, the raw-column table, and the time/delay formatters. `RenderContext.session` resolves against yard-master's own `feed-session.ts`, which is deliberately shaped like test-track's |
| `src/modules/search-entries.ts` | `test-track` | `src/modules/search-entries.ts` | 56f120a | modified | Builds `SearchController` entries from the session. See the banner's `@changes`: the vehicle loop became a tracker loop and the priorities bucket managed objects ahead of GTFS objects |
| `src/types/page-state.ts` | `test-track` | `src/types/page-state.ts` | 56f120a | modified | The union of every page. See the banner's `@changes`: yard-master's nine variants replace test-track's five |
| `src/modules/page-state-manager.ts` | `test-track` | `src/modules/page-state-manager.ts` | 56f120a | modified | Owns the current focus, the navigation history and the hash. See the banner's `@changes`: the hash codec is rewritten around an explicit `type` param |
