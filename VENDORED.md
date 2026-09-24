# Vendored files

## The shared half is mostly a dependency now

The files that have moved out of the apps live in **`interlocking`**, a
git dependency shipping raw TypeScript with no build step. They are imported as
`interlocking/ui/...`, `interlocking/gtfs/...`, `interlocking/map/...` and
`interlocking/util/...`, resolved by `tsconfig.json` `paths` and a
`resolve.alias` in `vite.config.ts`, both pointing at
`node_modules/interlocking/src`.

They are **not in the table below and not checked by `vendor:check`**: a package
version is the contract. A shared change there is a commit in interlocking, a
tag, and a bump in each of the three consumers. It is not edited here.

## What is still vendored

Everything below is still a hand-copied file, marked with a banner as the very
first lines of the file:

```ts
/* @vendored-from test-track:src/modules/breadcrumbs.ts
   @sha fdb171c
   @status modified */
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

**test-track is the upstream** for what is left. Everything here resolves
against it, with the exceptions noted below. The rule no longer covers the
shared half that moved to `interlocking`, which is edited there and reaches all
three repos as a version bump; neither test-track nor coloring-book is its
upstream any more. The earlier two-upstream plan, coloring-book for the shell
and test-track for the realtime modules, did not survive the import graph:
test-track has already adapted coloring-book's map and panel modules from the
editor model to the `GTFSScheduled` model yard-master shares, so re-deriving them
from coloring-book would reproduce test-track's files by hand. Where test-track
carries a coloring-book file verbatim the bytes are identical either way, so
those rows resolve against test-track too and the coloring-book origin is
recorded in the note. Nothing ever flows the other way: a change wanted upstream
is made upstream and re-vendored.

The exceptions all name coloring-book, and there are three left now that
`modal-utils.ts`, `tooltip-position.ts` and `breadcrumb-trail.ts` are package
modules. `spec-markup.ts` is one, for the same underlying reason as the RT spec
below — spec-driven form labels are a coloring-book idea that test-track has no
counterpart to, because test-track edits nothing. `calendar-input.ts` is the
second, and the only one test-track does not have at all: it edits nothing, so
it has no date to pick. It is also not in the package's first cut for exactly
that reason, and its row stays until a second wave takes it. `calendar-modal.ts`
is the third, for the same reason as the input: the month grid is
coloring-book's and test-track has no calendar.

`src/modules/pages/feed-page.ts`, `src/modules/pages/tracker-page.ts`,
`src/modules/pages/trip-page.ts`, `src/modules/share-modal.ts`,
`src/modules/alerts-modal.ts`,
`src/modules/managed-render.ts`, `src/modules/service-date.ts`,
`src/modules/entity-row.ts`, `src/modules/trip-picker.ts` and `src/shell.ts`
(this app's options to the shared shell markup: its brand and no dock) are in neither
tier and deliberately absent from the table: they are yard-master's own files
with no upstream at all. test-track browses route, stop, vehicle and alert, and
shows a feed status page when nothing is focused; this repo's hierarchy runs
Feed -> Route -> Trip, its home page is the feed itself with the trackers and
routes hanging off it as scrollboxes rather than as pages, and the managed half
of that hierarchy — feeds, trackers, assignments, alerts and members — has no
counterpart upstream at all, because test-track owns none of those objects.
Sharing and the alert list are navbar modals for the same reason: nothing
upstream has an object to put in them. The calendar is a navbar modal too, but
its month grid does have an upstream now — see the table. `navbar-action-list.ts`
and `shortcut-list.ts` are in neither tier for a third reason: they are the two
descriptor lists the shared renderers are parameterized over, and a list of this
app's own actions and keys is the app itself, not a copy of anything.
`entity-row.ts` is the same
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
| `src/modules/calendar-modal.ts` | `coloring-book` | `src/modules/calendar-modal.ts` | 59ed6d0 | modified | The month grid's cell shape: `min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30 overflow-hidden`, today's `ring-1 ring-primary bg-primary/5`, the day number line, and a `max-h-24 overflow-y-auto` chip stack in place of a fixed count plus `+n more`. See the banner's `@changes`: the chips, the data source and the timeline half are all this repo's own |
| `src/modules/layer-manager.ts` | `test-track` | `src/modules/layer-manager.ts` | bac60b6 | adopted | Every map layer: stops, route lines and casings, and the moving dots, fed from `GTFSScheduled`. Re-synced against test-track's `868909e` rewrite, so the shared half is now `interlocking`'s `layer-specs.ts` and `stop-layer-style.ts` and what is left is this app's own sources. `adopted` because upstream's remaining manager is the editor's, on `GTFSParser` / IndexedDB, so re-syncing against it has stopped being meaningful; the two spec files carry the contract instead. The banner records the one divergence: a vehicle feature carries `tracker_id` beside the composite `vehicle_id` so a click on a dot resolves to the tracker it is reporting under |
| `src/modules/help-pages.ts` | `test-track` | `src/modules/help-pages.ts` | c9dcb42 | modified | The help page registry, and this app's help entry point in place of the old standalone `about-modal.ts`. See the banner's `@changes`: `HELP_PAGES` is `[aboutPage, shortcutsPage]` (no welcome or map-key page), the Keyboard Shortcuts page and `buildShortcutsTable` are upstream's, fed from `shortcut-list.ts` through `describeShortcuts()`, `AboutApp` is yard-master's own, which says plainly that an uploaded schedule is stored and published, and the Project and Resources blocks are rendered locally rather than through `about-links.ts`, because the shared Project block links manage.rt.gtfs.zone and this app is it |
| `src/map-controller.ts` | `test-track` | `src/map-controller.ts` | fdb171c | modified | MapLibre setup, camera moves and focus. Navigation-driven moves go through `auto-zoom.ts` as of `dc25c3a`; `fitFeed` and the follow ease stay ungated, matching upstream. See the banner's `@changes`: the `vehicle` PageState variant became `tracker`, `VehiclePosition` carries a `trackerId`, follow tracks a tracker rather than one of its vehicles, and the two extra gated moves are the `trip` and `showTrips` fits, which are focus kinds upstream does not have |
| `src/modules/search-entries.ts` | `test-track` | `src/modules/search-entries.ts` | fdb171c | modified | Builds `SearchController` entries from the session. See the banner's `@changes`: the vehicle loop became a tracker loop over the API's list (one entry per tracker, whatever it is running), service alerts were added, and the priorities bucket managed objects ahead of GTFS objects |
| `src/types/page-state.ts` | `test-track` | `src/types/page-state.ts` | c24eb5b | modified | The union of every page, the modal that can sit over one, and the two type guards. See the banner's `@changes`: yard-master's seven variants replace test-track's five, there are no list variants, and `MODAL_TYPES` is `alerts` and `help`: the calendar, sharing and the feed switcher stay unrouted. What is generic over the union (`NavigationEvent`, `StateValidator`, `pageStatesEqual`, `sameLocation`) is `interlocking`'s `ui/page-state-manager.ts` |
| `src/modules/page-state-manager.ts` | `test-track` | `src/modules/page-state-manager.ts` | c24eb5b | adopted | This app's hash codec and the factory for the one manager `AppState` owns. The class itself is `interlocking`'s `ui/page-state-manager.ts`, generic over the union, as it is upstream, so what is left is a codec upstream shares no line of: it switches on an explicit `type` param, and the modal dimension rides on top of it in namespaced `modal` / `modal_page` params |
| `src/modules/breadcrumbs.ts` | `test-track` | `src/modules/breadcrumbs.ts` | 96c6144 | modified | The breadcrumb trail build and `validateState`, consuming `interlocking`'s `breadcrumb-trail.ts` shell. Every crumb label is capped at 40 characters, since a producer that writes a sentence into an alert's `header_text` would otherwise wrap a crumb over several lines. See the banner's `@changes`: the variant set is yard-master's, trackers resolve against the API list, and a managed object is accepted while its list is still empty |
| `src/modules/app-state.ts` | `test-track` | `src/modules/app-state.ts` | c24eb5b | modified | Feed selection and the boot sequence, on top of `interlocking`'s `ui/focus-controller.ts`, which owns `setFocus`, the `onFocusChange` / `onStateChange` split and the hrefs. See the banner's `@changes`: a feed is an API row rather than a `FeedSelection` of URLs, a linked focus is held pending until the zip it names has parsed, `emit` is overridden to put `loadPageData` on the focus side of the split, and the feed's event stream and live fleet are owned here |
| `src/modules/pages/alert-page.ts` | `test-track` | `src/modules/pages/alert-page.ts` | fdb171c | modified | `renderAlertList`, which the route, stop and trip pages all embed, plus both alert pages. The header is `pageHeader` and the status, level and active window are properties, both taken from upstream. See the banner's `@changes`: the page renders the managed `Alert` from the API, test-track's decoded-entity page is kept underneath it as the fallback for an alert that is only in the live payload, and the embedded list is drawn on `entity-row.ts` |
| `src/modules/pages/route-page.ts` | `test-track` | `src/modules/pages/route-page.ts` | 968e2de | modified | The route strip, headed by `pageHeader` with the route badge, with the mode and agency as properties. See the banner's `@changes`: `vehicle` links became `tracker` links, the wording follows, a Trips section lists the direction's trips, and the page's two lists render through `entity-row.ts`. The strip itself is untouched |
| `src/modules/pages/stop-page.ts` | `test-track` | `src/modules/pages/stop-page.ts` | fdb171c | modified | The stop and station page, headed by `pageHeader`; the location type is the crumb's eyebrow through `stopTypeLabel` rather than a line of its own. See the banner's `@changes`: `vehicle` links became `tracker` links, a departure's headsign links to its trip page, and every list on the page — departures included, which was a `<table>` — renders through `entity-row.ts` |
| `src/modules/panel-renderer.ts` | `test-track` | `src/modules/panel-renderer.ts` | c24eb5b | modified | The page dispatcher, the realtime index and the route-strip hover, on top of `interlocking`'s `ui/panel-host.ts`, which owns the `data-nav` / `data-action` dispatch, the breadcrumb header, the scroll and `<details>` restore and the ticker. See the banner's `@changes`: yard-master's session events (`change`, `vehicles`, `assignments`, `scheduleloaded`), no status page to hand back to, the seven-variant switch, and the `meUserId` and `action` hooks the pages emit buttons against |
| `src/modules/feed-session.ts` | — | — | — | adopted | Not a copy: written here, against `interlocking`'s `gtfs/feed-session.ts` interface, which is the four members — `scheduledFeed`, `vehicles`, `alerts`, `tripUpdates` — every shared realtime module reads a session through. test-track's session owns a GTFS-RT poller; here the managed objects come from the API and the live half arrives on the SSE channel, so the interface is all the two have in common. Listed so the seam is inventoried rather than invisible |
| `scripts/vendor-check.ts` | — | — | — | origin | Not vendored: written here, and the one file the flow runs backwards for. test-track adopted this table's `Source repo`-aware form in its Phase 1 and vendors the script from here `modified` at `5dc61ef`, differing only in its doc comment. Listed so the table is the whole map of what is shared |
