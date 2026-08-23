# NEXT_PLAN3 — back to viz and edit

## Summary

The last two rounds of work read "make it like viz and edit" as "mimic their
pages". It is not. What has to be copied is the *mentality*: a shallow
hierarchy where every crumb is a real ancestor, every click leads forward, and
a page is either an object or the shell around one. Everything else in those
apps is a navbar modal.

This app has drifted to fourteen `PageState` variants, five list pages, two
different renderings of the same timeline chart, a feed page of eight stacked
sections, and a form system that invented its own inputs, its own helper text
and its own weekday picker rather than using the ones edit already has.

This plan cuts that back. The hierarchy drops to **six** page variants and a
maximum depth of three. Five pages are deleted outright, two become navbar
modals, and every form field in the app is re-rendered with coloring-book's own
markup — fieldset, tooltip-trigger label, `input input-bordered input-sm`,
`type="date"`, day-toggle pills.

The one deliberate divergence from edit stays: **writes happen in a modal, as
one batched save**, not inline in the sidebar. The reason is in
test-track's `status-page.ts`, which deleted exactly the machinery an inline
form would need here — *"a draft-based editor per URL, with Apply/Revert,
per-field errors and caret restoration to survive a poll landing mid-edit — a
lot of machinery to change a URL in a panel that repaints itself every fifteen
seconds"*. Upstream's fix was to move the edit into the modal the object was
chosen in. edit gets away with inline editing because nothing pushes into its
panel; this app has SSE pushing vehicle positions every few seconds. The reuse
argument survives anyway: the modal body renders edit's exact field components,
just in a different container.

**No new custom UI components.** Everything below is `entity-row.ts`,
`render-utils.ts`'s `section`/`prop`/`propList`, `modal-utils.ts`,
`spec-field.ts`'s tooltip trigger, `timeline-chart.ts` and daisyUI. If a phase
seems to want a new component, that is the signal the page is wrong.

---

## Relevant Context

### The hierarchy (decided)

```
Feed                          home. The feed itself.
├── Trackers                  a scrollbox on the feed page, NOT a page
│   └── Tracker               Feed > Hell Gate 3
└── Routes                    a scrollbox on the feed page, NOT a page
    └── Route                 Feed > Bx12
        └── Trip              Feed > Bx12 > 07:15 Pelham Bay

reached by map click and map search only, no list anywhere:
    Stop                      Feed > Penn Station
                              Feed > Penn Station > Track 4  (parent_station)

reached from the alerts modal or from the object it names:
    Alert                     Feed > Bx12 > Bronx branch suspended
                              Feed > Bronx branch suspended   (feed-wide)

Navbar — top level, independent of the panel, each a modal:
    Calendar    the assignment timeline and the month grid
    Share       managers and invites          (was a page)
    Alerts      every alert, with a badge     (was a page)
    theme, about, user, feed switcher
```

Rules the hierarchy is held to:

1. **Feed is always crumb zero**, labelled with the feed name. It is the only
   root, because a feed is selection and everything else is focus.
2. **No list crumb ever appears.** `Feed > Routes > Bx12` is dead. Routes is a
   scrollbox on the feed page, so Bx12's parent is the feed.
3. **Max depth three.** `Feed > Route > Trip` is the deepest path in the app.
4. **A crumb is an ancestor, never a category.** A stop's crumbs are its
   `parent_station` chain. An alert's parent is the entity it informs.
5. **Buttons to unrelated pages do not exist.** The two exceptions, both
   marked as such: "Open in editor" and "Open in visualizer" leave the app
   entirely, and a trip row's tracker badge links sideways to that tracker.

### What dies

| Thing | Fate |
|---|---|
| `pages/list-pages.ts` | deleted. Routes/Trackers become feed-page scrollboxes; Stops, Services and Alerts lists go entirely |
| `pages/service-page.ts` | deleted. A trip's service becomes three read-only lines on the trip page |
| `pages/assignments-page.ts` | deleted. Its `weekData`/`weekRows` move into `calendar-modal.ts`, which already drew the same chart |
| `pages/managers-page.ts` | becomes `share-modal.ts`, off the navbar |
| `PageState` `routes`/`stops`/`trackers`/`alerts`/`services`/`service`/`assignments`/`managers` | deleted, eight variants gone |
| feed page's `renderContents`, `renderFleet`, `renderIssues`, `renderScheduleLinks`, `renderManagedLinks`, `renderOpenIn` | folded into three sections, see Phase 3 |
| `service-catalog.ts` chart half (`renderServiceChart`, `serviceChartLegend`, `sortServices`) | deleted. The data half (`serviceIds`, `serviceCatalog`, `weekdaysLabel`, `isServiceOn`) stays, for the trip page's three lines |
| every `help:` string in `actions.ts` | becomes a tooltip on the field label |

### Reference points in the upstreams

- Navbar order: `coloring-book:src/index.html` 84-400 and
  `test-track:src/index.html` 42-140. Both run *icon tools, theme, about,
  primary button last*. This app puts its primary button first, which is the
  single biggest reason the shell reads differently.
- Calendar icon: `coloring-book:src/index.html` ~111, the heroicons
  `calendar-days` path with the day dots. This app uses an older, plainer
  calendar path.
- Day toggles: `coloring-book:src/modules/service-days-controller.ts`
  `renderWeeklyPattern` — `btn btn-xs` pills, `btn-primary` when on and
  `btn-outline` when off.
- Date inputs: same file, `renderDateRange` — `<input type="date"
  class="input input-bordered input-sm">`, never a text field with a
  `YYYY-MM-DD` placeholder.
- Field labels with tooltips: `coloring-book:src/utils/field-component.ts`, and
  this repo already has the portal half vendored at
  `src/utils/tooltip-position.ts` plus a working trigger in
  `src/modules/spec-field.ts:93` (`specLabelContent`).
- Scrollbox precedent: `coloring-book:src/modules/page-content-renderer.ts:916`
  uses `max-h-96 overflow-y-auto`. **There is no precedent in either upstream
  for a filter input inside a panel list** — the map-search card is how both
  apps find an object, and `src/modules/search-entries.ts` already indexes
  routes, stops and trackers into ours. So: scrollboxes yes, per-list search
  inputs no.

---

## Phase 1 — The hierarchy

Collapse `PageState` to six variants and rewrite `breadcrumbs.ts` against them.
Do this first and alone: every later phase is easier once the tree is real, and
doing it last would mean rewriting pages twice.

The deletions are the work. `page-state-manager.ts` validates and restores from
the hash, so a stale hash pointing at `#type=services` has to fall back to home
rather than throw — `isPageState` already returns false for an unknown type and
the manager already falls back, so this is a matter of deleting cases, not of
adding a migration.

- [x] `types/page-state.ts`: variants become `home`, `tracker`, `route`,
      `trip`, `stop`, `alert`. Delete the other eight from the union, from
      `isPageState` and from `StateValidator`'s doc comment.
- [x] `breadcrumbs.ts`: delete the list cases and the `service`/`assignments`/
      `managers` cases. Keep `home`, `tracker`, `route`, `trip` (route as
      parent), `stop` (`stopAncestors` chain), `alert` (`alertParent`).
- [x] Delete `pages/list-pages.ts`, `pages/service-page.ts`,
      `pages/assignments-page.ts`.
- [x] `panel-renderer.ts`: drop the deleted cases from its dispatch.
- [x] `service-catalog.ts`: delete `renderServiceChart`, `serviceChartLegend`,
      `sortServices` and the `timeline-chart` import.
- [x] Grep for every `{ type: 'routes' }` / `'stops'` / `'services'` /
      `'trackers'` / `'alerts'` / `'assignments'` / `'managers'` literal and
      remove or repoint it. `calendar-modal.ts:104` and
      `service-catalog.ts:221` link to `service` and must stop.
- [x] `search-entries.ts`: keep routes, stops and trackers. This is now the
      only way to reach a stop by name, so it matters more than it did.

**Gotchas.**
`validateState` currently answers true for the list variants because they name
no object. Once they are gone the function is six real checks, and the
tracker/alert leniency (an empty API map means "not fetched yet") must survive
— dropping it would discard a good deep link on a slow request.
`assignments-page.ts` exports `gridRange` and `anchorDate`, which
`index.ts` uses to decide the fetch window; move those two into
`calendar-modal.ts` rather than deleting them.

**What was found doing it.**

`gridRange` and `anchorDate` were deleted rather than moved. `index.ts` does
not use them: it prefetches this week for the navbar badge with `startOfWeek`
and `addDays` directly, and the calendar modal asks for whatever month it is
showing. The only caller was `app-state.ts`'s `assignments` branch of
`loadPageData`, which went with the variant. `ensureAssignments` still widens
rather than replaces, so the badge's week and the modal's month stay covered
together.

`sortServices` came back as `sortByCascade`, still exported. It is data, not
chart: `servicesForTrips` needs cascade order and so does the calendar grid.
`serviceTimelineRow` went with the chart half — it is what needed the
`timeline-chart` import — and `tripsForService` went with the service page, its
only caller.

Three pages had to give up their services waterfall in this phase rather than in
their own, because `renderServiceChart` is gone: the route page and the stop
page now list each service as an `entityRow` (id, weekdays, window) and the trip
page has Phase 6's three read-only lines already. None of them links to a
service, because there is no page to link to.

Deleting the `service` and `assignments` targets left the calendar's month grid
with three dead links. The service chip and the "+N more" chip are now plain
spans, and so is the day number: a day is not an object either. The timeline tab
lost its Services chart and is the rule chart alone.

The feed page lost `renderManagedLinks`, `renderScheduleLinks` and `browseRow`
outright — every row pointed at a deleted page. Until Phase 3 puts the Trackers
and Routes scrollboxes there, a tracker or a route is reached by map click or
map search. The tracker page's two "Assignments" links went the same way; the
calendar is on the navbar.

`assign:new`, `assign:day`, `assign:skip`, `assign:add-day` and `assign:unexcept`
in `actions.ts` have no emitter now that the assignments page is gone. They are
the write layer rather than UI and Phase 5 rebuilds the form around them, so
they were left alone. `map-controller.ts`'s `showTrips` is unemitted for the
same reason: nothing draws a day's trips now that a day has no page.

## Phase 2 — The shell

Reorder the navbar to the upstreams' order, replace the calendar icon, name the
logged-in user, and move managers and alerts off the panel and into modals.

Target order after the logo, left to right:

```
[calendar] [share] [alerts (3)]   [theme] [? about]   [max@kcfam.us]   [ Columbia County ]
                                                                        ^ btn-primary, last
```

The feed switcher keeps its current behaviour and modal; only its position and
label change. It is this app's `[Load]`, and in both upstreams `[Load]` is the
last thing in the navbar.

- [x] `index.html`: move `#feed-switcher-btn` to the end of `.navbar-end`.
      Label it with the selected feed's name, "Select feed" when none.
- [x] Replace `#calendar-btn`'s SVG path with coloring-book's `calendar-days`
      path. Keep the count badge.
- [x] Add `#share-btn` with a share icon (heroicons `share`), left of alerts.
- [x] Add `#alerts-btn` with `#alerts-badge`, copying test-track's markup at
      `index.html:71-83` including the `indicator` wrapper.
- [x] `#account-link` becomes `#user-btn`, labelled with the identity from
      `/api/me` rather than the word "Account". Keep the `target="_blank"`
      and the comment about Keycloak being another origin.
- [x] New `modules/share-modal.ts`: `pages/managers-page.ts`'s renderers moved
      into a `showModal` body, keeping the manager/invite split and the
      `can_manage` gating on every button.
- [x] New `modules/alerts-modal.ts`: every managed alert as an `entityRow`
      linking to `{ type: 'alert' }`, plus the New alert button. Vendor
      test-track's `alerts-modal` markup where it fits.
- [x] `index.ts`: wire the two new buttons, close the modal before navigating
      exactly as `calendar-modal.ts` already does (the modal is on
      `document.body`, outside the panel host, so the panel's `data-nav`
      handler never sees these clicks).

**Gotchas.**
Both new modals navigate into the panel, so both need `calendar-modal.ts`'s
delegation pattern: a real `<a href>` with the target hash so middle-click
works, and a plain click that closes first. Do not invent a third way.
The alerts badge counts alerts, and `feed-session` already holds
`serviceAlerts`; do not add a second source of truth.

**What was found doing it.**

The calendar button moved into an `indicator` wrapper too, which is how both
upstreams hang a count off a navbar icon and what the alerts button needed
anyway. `#calendar-count` became the `indicator-item`, so `index.ts`'s badge
sync did not change; `btn-circle` became `btn-square`, which is what every icon
button in either upstream uses.

`personLabel` was widened from `Member` to a structural `Pick`. A `Me` carries
the same three fields under another name, and the navbar chip asks the same
question the managers list does.

The user chip still hides itself when the deployment has no Keycloak Account
Console, which is the behaviour `#account-link` had: without a console there is
nowhere for it to go, and a name that is not a link is furniture. Naming the
person is the change; when to show them is not.

Only the alerts modal delegates `data-nav`. Nothing in the share modal is a
link — a manager is not an object this app browses — so it delegates
`data-action` alone. Neither modal closes on a write: the form opens over it
and the list underneath redraws on the session's `change`, which is what a
write ends in.

Opening Share is not a round trip. Phase 1 moved the members fetch into
`loadManagedObjects`, so the rows are in the session from the moment a feed is
selected, and the modal's loading line is only ever seen on a slow selection.

The alerts badge counts `serviceAlerts`, the managed rows, rather than
`alerts`, the ones parsed out of the RT feed. They are different things: the
badge is a count of what this feed's managers have written, and the button
opens exactly that list.

---

## Phase 3 — The feed page

Rebuild `pages/feed-page.ts` as: identity, children, then facts. Nothing else.
This is the page the whole complaint is about, and the test is that it should
be readable in one screen with no horizontal noise.

```
Columbia County
[loaded]  Owned by you

  > Trackers                                11
    (max-h-96 scrollbox of tracker rows,
     liveness badge on each, [+ New tracker])

  > Routes                                  42
    (max-h-96 scrollbox of route rows,
     route badge on each)

── GTFS Scheduled  (?)
   Source          hosted zip
   Published at    https://…
   Serving         columbia.zip · 4.1 MB · 2h ago · you
   Last loaded     2h ago
   Feed timezone   America/New_York
   [ Replace schedule ]  [ Reload ]  [ Copy URL ]  [ Open in editor ]

── GTFS Realtime Endpoints  (?)
   Vehicle positions   /feeds/…/vp
   Trip updates        /feeds/…/tu
   Service alerts      /feeds/…/sa
   [ Open in visualizer ]

── Feed
   [ Edit ]  [ Delete ]
```

`Static load` and `Schedule source` merge into **GTFS Scheduled**, which is one
section with the docs link and a tooltip carrying the reference's own words.
`URLs` becomes **GTFS Realtime Endpoints**. "Open in editor" moves into GTFS
Scheduled, because the editor edits the schedule; "Open in visualizer" stays
with the realtime endpoints, because that is what viz consumes.

- [x] Merge `renderLoad` and `renderSource` into one `renderScheduled`.
      Keep the error alert and `next_retry_at`, drop the rest of the load
      section's separate framing.
- [x] Section headings get a `(?)` tooltip trigger using `spec-field.ts`'s
      `.field-tooltip-trigger` markup, with `gtfs.org/reference/` as the link
      and the reference's own description as the content.
- [x] `renderOpenIn` splits: the editor button into GTFS Scheduled, the viz
      button into GTFS Realtime Endpoints. The section itself goes.
- [x] `renderActions` becomes the last section, "Feed", not a button row above
      everything.
- [x] `renderManagedLinks` and `renderScheduleLinks` become two scrollboxes:
      Trackers and Routes, `max-h-96 overflow-y-auto`, `entityRowList` rows.
- [x] Delete `renderContents` (the "In this browser" counts), `renderFleet`
      and `renderIssues`. The fleet summary becomes the count badge on the
      Trackers scrollbox plus the liveness badge already on each row; the
      unparsed-schedule facts become the one-line `renderStaticStatus` that is
      already there.
- [x] `renderHistory` stays but moves inside GTFS Scheduled as a `<details>`,
      since upload history is a fact about the schedule source.

**Gotchas.**
The two halves of a feed genuinely disagree — cafe-car's load is what the
published RT feed is built from, this browser's parse is what the map draws —
and the existing file's comment says so. Deleting "In this browser" is
acceptable because a reader who needs that comparison has the map and the load
status; do not merge the two into one number that hides the disagreement.
`renderScheduleLinks` computes a places count by filtering out
`parent_station`; that logic dies with the stops row and should not be left
orphaned.

---

**What was found doing it.**

`renderFeedPage` lost its `issues` argument, which took the `mapIssues` hook,
its `index.ts` wiring and `src/utils/issue-card.ts` with it — the feed page was
the card's only caller. `panel-renderer.ts`'s `@changes` bullet about the hook
was rewritten to say why the page has no counts rather than why it had them,
and the vendored row for `issue-card.ts` is out of `VENDORED.md` already rather
than waiting for Phase 7. `LayerManager.issues` and `MapController.issues` are
untouched: both are vendored, and the counts are still what the map itself
reasons about.

The load section did not survive as its own thing at all. `Last loaded`,
`Started`, `Next retry` and `Feed timezone` are four more rows in GTFS
Scheduled's one `propList`, under the source rows, and the "never handed to the
loader" line is a sentence above them rather than a section body. The error
alert stays at the top of the section, where it is the first thing read.

Upload history is a `<details data-detail="feed:uploads">`, so the panel's open
tracking keeps it open across the fifteen-second repaint the way it does a raw
column table. The count moved into the summary, since a disclosure has no
`rowSection` heading to hang a badge off.

The Routes scrollbox caps at a new `CONFIG.ROUTE_LIST_MAX` of 200 with the
existing `cappedNote`. The deleted routes page had no cap because it was a whole
page; a scrollbox on a panel that rebuilds every row on each realtime poll is
not the place to render a thousand of them. Trackers is uncapped — a feed's
fleet is tens, not thousands — and carries the New tracker button under the
list.

Routes is also where `renderStaticStatus` lives now: routes come out of the zip,
so "downloading the schedule" is that section's empty state rather than a line
floating between sections. `CONFIG.STOP_LIST_MAX` and `CONFIG.RULE_LIST_MAX` are
left orphaned by Phases 1 and 3 and are Phase 7's to remove.

"Open in editor" takes the *published* URL, not `static_feed_url`. It is the one
URL that works for whoever the link is sent to, and it is what `renderOpenIn`
already passed — a linked feed whose upstream zip is reachable is the accident,
not the contract.



## Phase 4 — Fields

Make every form field in the app render the way edit renders one. This is one
module and then a sweep, not a per-form fix.

- [x] `entity-form.ts`: `FieldConfig.help` is **deleted**. Its replacement is
      `tooltip?: string`, rendered through the same
      `.field-tooltip-trigger` + `data-tooltip-content` markup
      `spec-field.ts:93` already emits, so the portal in
      `utils/tooltip-position.ts` picks it up with no new code.
- [x] Move every existing `help:` string in `actions.ts` to `tooltip:`.
      Delete the `label-text-alt` branch at `entity-form.ts:304`.
- [x] Inputs adopt edit's classes: `input input-bordered input-sm` for text,
      `select select-bordered select-sm` for selects. Compare against
      `service-days-controller.ts:644` before changing anything.
- [x] New field type `'date'` rendering `<input type="date">`. `start_date`
      and `end_date` on the rule form switch to it, and their
      `YYYY-MM-DD` placeholders and format validators go — the browser owns
      that now, and `isServiceDate` only guards the parse.
- [x] New field type `'weekdays'` rendering coloring-book's day pills:
      seven `btn btn-xs`, `btn-primary` on and `btn-outline` off, one hidden
      input carrying the seven booleans. Replaces the seven separate
      `type: 'checkbox'` fields.
- [x] Weeks start on **Sunday**. `config.ts` gains `WEEK_START: 0`.

**Gotchas.**
The Sunday change is not cosmetic and touches four files.
`service-date.ts:22` `WEEKDAY_KEYS` is Monday-first *because it mirrors the
API's rule columns* — leave that array alone, it is a list of field names, not
a display order. What flips is display: `WEEKDAY_LABELS`, `weekdayIndex`,
`startOfWeek` and `monthGrid`. Introduce a separate display index and keep the
rule mapping (`weekdayKey`) on the API order, or `rule.monday` will be written
into `rule.sunday`. `timeline-chart.ts` (`weekdayFlags`, `weekdayDots`, the
week columns at line 209) and `calendar-modal.ts` both consume the display
order and must be checked after the flip.
The weekday pills are the first interactive control the form system has that is
not a native input. Its state must live in a hidden input so
`entity-form.ts`'s existing dirty-tracking and `FormData` read keep working
unchanged.

---

**What was found doing it.**

`CONFIG.WEEK_START` is read in `Date.getUTCDay()` numbering, so 0 is Sunday.
`weekdayIndex` is now the display slot and a new `ruleWeekdayIndex` is the
Monday-first one; `weekdayKey` is the only caller of the second, plus
`serviceRunsOn`, whose `service.days` comes straight out of `calendar.txt` and
is Monday-first for the same reason the rule columns are.

The bridge between the two orders is one exported array, `WEEKDAY_DISPLAY`:
for each display slot, the index into `WEEKDAY_KEYS` it shows. `WEEKDAY_LABELS`
is derived from it, so anything that draws a week iterates the labels and reads
the flag `WEEKDAY_DISPLAY` points at. That is `weekdaysLabel`,
`describeRecurrence` and `timeline-chart`'s `weekdayFlags`, which now returns
its seven booleans in display order because the dots and their tooltip are the
only things that read it.

`service-date.ts` importing `CONFIG` put `config.ts` into the import graph of
`scripts/check-alert-enums.ts`, which runs under tsx where `import.meta.env`
does not exist at all. `RT_BASE` reads it through `?.` now; the alternative was
a second copy of the week start somewhere the scripts cannot reach.

A `weekdays` field's value is a seven-character string of `0` and `1` in
`WEEKDAY_KEYS` order, in a hidden input, with `weekdayBits`/`weekdayValue`
exported from `entity-form.ts` for the caller that has to write a rule body.
The pills carry the index they write rather than the slot they sit in, so the
display order and the column order never have to line up at click time. The
field renders as a `div` rather than a `label` for the same reason `file` and
`combo` do: a label would forward its own clicks into the first button.

`repeats` and its weekly/once branch are untouched, and so is the `once`
handling in `ruleBody`; both are Phase 5's. What changed under them is only
that the seven booleans arrive as one value instead of seven.

`validateRule` lost both date-format branches. `start_date` still has to be
answered — a rule with no first service date is not a rule — but its shape is
the date input's problem now, and `end_date` empty is what open-ended has
always meant to the API.

## Phase 5 — Assigning

Fold the trip picker into the rule form and rebuild the form around the
question it actually asks.

Today `assign:new` calls `pickTrip()`, which is a modal, and *then* opens the
rule form, which is a second modal. That is two dialogs to make one object, and
the first one exists only because the second had a bare `trip_id` text field.

```
Assign a trip
  Tracker      [ Hell Gate 3                v ]
  Trip         [ 07:15  Bx12  Pelham Bay    v ]
  Runs on      (S)(M)(T)(W)(T)(F)(S)
  Starting     [ 2026-08-24 ]
  Repeats      (o) forever
               ( ) until  [          ]
  Window       [ 07:15 ]  ->  [ 09:40 ]
                                [ Cancel ]  [ Assign ]
```

- [ ] `trip-picker.ts` stops being a modal and becomes the option source for a
      `trip_id` select. Keep `tripName`.
- [ ] Delete the `repeats` weekly/once select. A one-off is every pill off,
      which the existing `ruleBody` already encodes as an `added` exception;
      the select was a second way to say the same thing.
- [ ] "First service date" becomes **Starting**, a `type: 'date'` field. The
      radio that prompted the question goes.
- [ ] "Last service date" becomes a **Repeats** radio pair: *forever* (empty
      `end_date`) or *until* plus a date input. Empty means forever, which is
      what the API already means by null.
- [ ] `assign:new-for-trip` from a trip page preselects the trip in the select
      rather than skipping the picker.
- [ ] Keep `tripWindow` prefilling Starts/Ends from the trip's own stop times,
      and keep `allowPristine` — opening the form and pressing Assign is the
      common case and must stay one click.
- [ ] `validateRule` loses its date-format branches, keeps the
      window-ends-before-it-starts check and the tracker check.

**Gotchas.**
A feed has tens of thousands of trips and a `<select>` with all of them is
unusable. Scope the options to the route when the form was opened from a route
or trip page, and to *trips a rule already touches plus the trips of routes
with trackers* otherwise; fall back to a searchable `datalist`-backed combobox
(`entity-form.ts:242` already renders one with `role="combobox"`) when the
count is over `CONFIG`'s cap. Do not build a new picker component.
The one-off path writes an `added` exception after the rule; that second
request must stay inside the same `submit` so a failure leaves nothing half
made.

---

## Phase 6 — The object pages

Bring the five surviving object pages in line. Each one is a header, the
sections that describe it, and the children beneath it. Nothing more.

**Tracker** (`Feed > Hell Gate 3`) — nickname, liveness, current fix,
`device_key` behind its closed disclosure, then its assignments as rows with
the trip as the link and edit/delete as row actions.

**Route** (`Feed > Bx12`) — viz's transit strip kept exactly as vendored,
then inline alerts, then a `max-h-96` Trips scrollbox with the assigned
tracker as each row's badge.

**Trip** (`Feed > Bx12 > 07:15 Pelham Bay`) — stop times, then three
read-only lines for the service (`Service`, `Runs`, `Window`) replacing the
deleted service page, then its assignments, then `[ Assign a tracker ]`.

**Stop** (`Feed > Penn Station`) — unchanged apart from crumbs. Reachable only
by map click and map search.

**Alert** (`Feed > Bx12 > …`) — the alert, plus an **Affects** section listing
its informed entities as links. That is the back-reference: the route page
lists the alert, the alert page lists the route.

- [ ] `tracker-page.ts`: drop anything that is not identity, liveness, fix,
      credential or assignments.
- [ ] `route-page.ts`: add the Trips scrollbox; the strip is vendored and is
      not to be touched.
- [ ] `trip-page.ts`: add the three service lines using `service-catalog.ts`'s
      surviving data half, and the assignments block.
- [ ] `alert-page.ts`: add the Affects section from `AlertDetail.entities`.
- [ ] Every one of them uses `entityRow`/`entityRowList`/`rowSection` for
      lists and `section`/`prop`/`propList` for facts. No page defines its own
      row.

**Gotchas.**
`device_key` rules are unchanged and absolute: `GET /trackers/{id}` only, the
properties panel only, never in the hash, a breadcrumb, a link or a log line.
The trip page's tracker badge is one of the two sanctioned sideways links; do
not let it grow into a general cross-linking habit.

---

## Phase 7 — Settle

- [ ] `pnpm typecheck` clean, then `pnpm build`.
- [ ] `pnpm vendor:check`, `pnpm check-rt-spec`, `pnpm check-alert-enums`.
- [ ] `VENDORED.md`: remove the rows for the deleted files, and update the
      prose paragraph that lists yard-master's own pages — it currently names
      `list-pages.ts`, `assignments-page.ts` and `managers-page.ts`.
- [ ] Any file that has drifted far enough in this refactor moves from
      `verbatim` to `modified` with an `@changes` list, or to `adopted`.
      `page-state.ts` and `breadcrumbs.ts` are already `modified` and their
      `@changes` lists are now wrong in almost every bullet; rewrite both.
- [ ] Hand off for visual verification. No browser automation.

**Gotchas.**
Anything auth-shaped — the user chip reading `/api/me`, the CSRF header on the
new modal writes, session expiry behind the share modal — is verified at
music-student's `:4180`, not at vite's `:8091`. The dev proxy forges headers
and cannot fail the way production does.
