# yard-master: one UI vocabulary, and the bugs in the way

## Summary

`NEXT_PLAN.md` phases 1-9 are done and only its phase 10 is open. What those
phases built works, but it does not *look* like test-track or coloring-book,
and moving between the three apps costs the reader a re-orientation each time.
This plan closes that gap, and clears four bugs first so the UI work is judged
against an app that is not visibly broken.

1. **The four bugs.** A tracker clicked on the map opens a dead page; a queued
   reload sits at "running" until a refresh; creating a feed from a zip 422s
   with nothing on the form; and three buttons are in the wrong place or should
   not exist.
2. **One list-row vocabulary.** Every list in the app renders its own `<li>`.
   coloring-book has one row shape used everywhere.
3. **The feed page becomes the feed.** Its properties, flat, with no
   disclosures. Trackers, Alerts, Routes and Stops become their own pages.
4. **The timeline chart.** The services waterfall, one row per object and one
   column per week. Written here, in coloring-book's visual language.
5. **The service view**, on that chart.
6. **Assignments rebuilt on that chart**: a list of weeks, each openable, each
   a grid of trips against days.
7. **The calendar modal**, off the nav, showing services and assignments.

This plan runs **before** `NEXT_PLAN.md` phase 10. The parity review and the
SQLAdmin deletion should judge the UI as it will actually ship, not as it is
halfway through being unified.

## Relevant Context

### What is wrong with the UI today

- The feed page (`pages/tree-page.ts`) is an accordion of `<details>`, and
  `renderManaged` mixes two idioms in one block: Trackers and Alerts *open*,
  Assignments and Managers *navigate*. Nothing else in the family hides content
  behind a disclosure.
- The assignments page invents a month grid with its own selection styling and
  its own conflict highlighting, neither of which appears anywhere else. The
  grid also cannot show much: `CONFIG.CALENDAR_DAY_CHIPS` is 3, and then `+n`.
- Routes, Stops, Trackers, Alerts, Managers and Trips are each listed with
  hand-written `<li>` markup.
- Lists are capped at `TREE_LIST_MAX` (200) with a "use the search box" note,
  because they are sections of a page rather than pages.

### Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Assignments chart rows | **Trips a rule already touches**, plus an "Assign a trip" picker | A feed has tens of thousands of trips and almost none of them are assigned. Filtering by route is done by going to the route page |
| Where the chart comes from | **Written fresh in yard-master**, keeping coloring-book's visual language exactly | Not vendored, not generalized upstream. The look is shared; the code is this repo's |
| How far the feed page flattens | **Feed object plus sub-pages** | Nothing hidden. That is not what the other apps do |
| Calendar modal contents | **Month grid plus waterfall, services and assignments** | One place to answer both "does this run today" and "who is covering it" |
| Recurrence model | **Unchanged.** No migration | `TrackerRule` already expresses multi-week continuation |

### What already exists and is reused

- `src/modules/render-utils.ts` owns `prop`, `propList`, `section`,
  `entityLink`, `routeBadge`. `entityLink` emits a real `<a href>` carrying the
  target hash plus a `data-nav` payload, so middle-click and copy-link-address
  work. That is better than coloring-book's imperative
  `navigation-actions.ts` and is kept.
- `src/modules/service-date.ts` is the date substrate the chart needs:
  `ServiceDate` as a `YYYY-MM-DD` string, `monthGrid`, `addDays`, `addMonths`,
  `today()` in the feed's zone, and every `Date` built at UTC noon.
- `src/utils/tooltip-position.ts` is already vendored and is what the chart's
  tooltips have to use. daisyUI's `.tooltip` sets `display:inline-block`, which
  pulls a cell out of the table layout.
- `src/modules/trip-picker.ts` already answers "which of these fifty thousand
  trips", with the route and first departure that tell two runs apart.
- `actions.ts` already holds every `assign:*` write. Phase 6 adds no endpoints.
- `src/modules/panel-renderer.ts` restores open `<details>` by `data-detail`
  across a re-render, and runs a shared 1s ticker over `[data-since]`.

### The reference the chart is drawn from

coloring-book's `src/modules/service-timeline.ts`. Read it before phase 4; it
is the specification, not a dependency. What matters in it:

- An HTML `<table>`. No SVG, no canvas, no measurement pass. One fixed-width
  `<td class="w-5 min-w-5 h-7">` per week, `overflow-x-auto` on the wrapper.
- Label column `sticky left-0 z-10 bg-base-200`, width clamped 80-300px off the
  longest key.
- Month header cells span their weeks, accumulated by label.
- The today marker is a `background-image: linear-gradient(...)` hairline, not
  an element, so it can sit inside both a `<td>` and the month `<th>` and read
  as one continuous line.
- A 3-year cap, with a `text-warning` line when the range truncates.
- Exception ticks: added is a `-rotate-90` triangle in `text-success`, removed
  is `+90` in `text-error`.

### Standing gotchas

- `render-utils.ts` is `verbatim` from test-track. New shared markup goes in a
  new file beside it, never inside it, or `pnpm vendor:check` goes red.
- `modal-utils.ts` is `modified` from coloring-book and is missing
  `renderPencilIcon`. Anything the chart needs from it is an addition to the
  `@changes` list, not a silent edit.
- Everything auth-shaped is verified at music-student's `:4180`, never at
  vite's `:8091`.
- No browser automation. Stop at `pnpm check` and hand off.

---

## Phase 1: the four bugs

Independent of everything below, and small.

### 1a. The map hands over the wrong tracker id

`layer-manager.ts` writes `vehicle_id: v.key` as the feature property and reads
it back as `{ kind: 'vehicle', id }`. `map-controller.ts` then puts that
straight into `{ type: 'tracker', tracker_id }`. But `key` is cafe-car's
composite, `f"{tracker_id}:{trip_id}:{start_date}"` from `vehicle_payload.py`,
and `VehiclePosition` carries `trackerId` separately.

So `GET /api/trackers/{key}` 404s, which is the "Could not load this tracker"
toast, and `session.trackers.get(key)` misses, which is the "Tracker ... is not
in the loaded feed" page. Browse works because `tree-page.ts` uses `tracker.id`.
`trip-page.ts` is the one call site that got it right.

- [x] `layer-manager.ts`: carry `tracker_id` as a second feature property, so
      the resolution happens where the key was minted
- [x] `map-controller.ts`: navigate off that, and arm follow mode off it too
- [x] `route-page.ts` (two sites) and `stop-page.ts`: `vehicle.key` becomes
      `vehicle.trackerId`
- [x] Grep for `.key` reaching a `tracker_id` anywhere else

`layer-manager.ts` was `verbatim`, so this promoted it to `modified` with an
`@changes` list and a rewritten `VENDORED.md` row. `map-controller.ts`'s own
banner said in two places that LayerManager stays verbatim; both lines were
corrected. `FocusTarget`'s vehicle variant now carries `trackerId` beside `id`,
which keeps `setFocus` keyed by the composite (the layer is) while `onSelect`
navigates by the surrogate. A hit with an empty `tracker_id` navigates nowhere
rather than to a page for the empty id.

### 1b. Load status stuck on "running"

It is SSE, not websockets, and the client is correct end to end:
`event-stream.ts` dispatches `type: 'load'`, `app-state.applyLoadStatus` writes
it, `feed-session` fires `change`, and the panel and the button both re-render.

`schedule_foamer.events.publish_load` publishes to `settings.redis_url`,
default `redis://localhost:6379/1`, inside `contextlib.suppress(Exception)`.
Neither deployment sets `REDIS_URL` on the worker: music-student's
`celery-worker` and `celery-beat` set only `CELERY_BROKER_URL` and
`CELERY_RESULT_BACKEND`, and `deploy-gtfs-rt/gtfs/celery.yaml` has no `REDIS`
line at all. cafe-car subscribes on `redis://redis:6379/1`.

So no `load` frame is ever published. The only status the UI sees is the
stream's first frame, read from the DB at connect, plus the `GET /feeds/{id}`
fired right after Reload. Both say `running`. A refresh reconnects and reads
`success`.

- [x] music-student `docker-compose.yml`: `REDIS_URL: redis://redis:6379/1` on
      `celery-worker` and `celery-beat`
- [x] deploy-gtfs-rt `gtfs/celery.yaml`: the same on both Deployments
- [x] schedule-foamer: a `log.warning` inside `publish_load`'s suppress. A
      publish that silently does nothing is what made this invisible

Committed in each of the three repos, not here. `publish_load` traded
`contextlib.suppress` for a `try`/`except` that logs the feed id and the
`redis_url` it failed against, with `exc_info`, so the next misconfiguration
names itself.

### 1c. The 422 on creating a feed with a zip

`FeedCreate` accepts `{feed_name, source_kind: 'hosted'}`, so the payload shape
is right. What 422s is `_FEED_NAME_RE`, `^[a-z][a-z0-9_-]{2,63}$`: the server
also requires a leading lowercase *letter* and 3-64 characters, and
`schedule-upload.ts`'s `validate` checks neither. The dialog's help text says
only "Lowercase letters, digits, - and _".

The message then goes nowhere, which is the other half. `api-client.fieldErrors`
skips any `loc` shorter than two elements, and a `model_validator(mode="after")`
failure has `loc: ["body"]`. `describeDetail` flattens it into the thrown
message, but `entity-form` renders per-field errors only, so a whole-object 422
shows as a blank form.

("Promised response from onMessage listener went out of scope" is a browser
extension talking to itself. Not ours.)

- [x] `schedule-upload.ts`: mirror the name regex in `validate`, and reword the
      help text to say it starts with a letter and is 3-64 characters
- [x] `schedule-upload.ts`: check `static_feed_url` parses as http(s), which is
      what `AnyHttpUrl` enforces server-side
- [x] `entity-form.ts`: a form-level error slot above the fields, fed by any
      422 whose `loc` stops at `body`. No 422 may be invisible

The banner slot already existed (`[data-form-error]`), used for unknown fields
and for anything that is not a 422. What was missing is that a 422 carrying
*both* a field error and a whole-object error dropped the second one on the
floor: the branch tested `err.fields` alone. `ApiError` grew `formErrors`, the
messages whose `loc` is `["body"]` or shorter, and the form now shows both.
`describeDetail` also stopped printing `body:` as if it were a field name.

### 1d. The chrome

- [x] Delete `tracker:bulk` and its "Add several" button: the button in
      `tree-page.ts`, the case in `actions.ts`, `newTrackers`,
      `api-client.createTrackers` and the `TrackerBulkCreate` type. cafe-car's
      route stays; only the client stops offering it
- [x] Delete "Revert" from `entity-form.ts` and its `revert()` implementation.
      Dirty tracking and `allowPristine` stay
- [x] Move `#reload-feed-btn` out of the navbar into the feed page's Schedule
      source block, rendered only when `source_kind === 'url'`. A hosted feed
      has no upstream to re-download; Replace schedule is its equivalent. The
      disabled/"Reloading..." logic moves with it, off the same `change` event
- [x] Restyle `#feed-switcher-btn` as test-track's Load button: the
      cloud-upload SVG plus `<span class="hidden md:inline">` around the label
- [x] `tracker-page.ts`: tell "the list has not arrived yet" from "no such
      tracker". `breadcrumbs.validateState` already accepts a tracker id while
      `session.trackers` is empty, and the page contradicts it for one round
      trip

Removing Revert reindexed the modal's actions, so `escapeAction` went from 1 to
0 — Escape had otherwise become Save. The reload button became a `feed:reload`
action in `actions.ts` rendered in the Schedule source block, which meant
`actionButton` grew a `disabled` flag to carry the "Reloading…" state the
navbar button held imperatively. The switcher's label moved into
`#feed-switcher-label` so the icon survives a feed change.

---

## Phase 2: one list-row vocabulary

A new `src/modules/entity-row.ts`, this repo's own, with coloring-book's
`utils/entity-references.ts` as the visual model: a colour dot, a label over a
sublabel, a right-aligned outline badge, `hover:bg-base-200`. Built on
`entityLink`, so the row is a real anchor and middle-click still works.

- [x] `entity-row.ts`: the row, and a section header of title plus count badge
- [x] Every list re-rendered through it: routes, stops, trackers, alerts, trips
      on the route page, departures and platforms on the stop page, the trip
      page, the tracker page, the managers page, and `renderAlertList`
- [x] An explicit empty state per list

**Gotcha.** New file beside `render-utils.ts`, never inside it.

A row has three shapes, not one. The whole row is the anchor where it can be;
a row carrying buttons links only its label, because an `<a>` may not contain a
`<button>`; a row naming nothing navigable is plain text. That is why the
anchor is built in `entity-row.ts` against `ctx.href` plus `data-nav` rather
than through `entityLink`, which takes a plain label and could not wrap a dot,
two lines and a badge. `entityLink` is still what the label-only shape uses.

The stop page's departures were a six-column `<table>`, not a list, so
converting them meant choosing what stops being a column: the scheduled time
and the platform became the sublabel, and the predicted time and delay became
the right-hand badge. The zone moved out of two column headers into one line
under the list.

`cappedNote` moved out of `tree-page.ts` into the new module, since three pages
now cut a list. `treeSection`'s hand-rolled count became `countBadge`, so the
disclosure headers and the flat `rowSection` headers count the same way — which
is what phase 3 needs when the disclosures go.

Not converted, deliberately: the assignments page's own `<li>` markup, which
phase 6 deletes; the alert page's informed-entity rows, which are a flat list
of one object's fields rather than references to other objects; and
`trip-picker.ts`'s result list, which is a picker, not a page's list.

---

## Phase 3: the feed page becomes the feed, and lists become pages

The feed page renders the feed's own properties flat: name, owner, source,
published URL, load status, timezone, upload history, URLs. Then a flat block of
links to what hangs off it. The `<details>` go, and so does the
`treeSection`/`treeLink` split that made half the rows open and half navigate.

Each list becomes a page with its own breadcrumb, which is also what lets it be
complete rather than capped.

- [x] `page-state.ts`: `trackers`, `alerts`, `routes`, `stops`. `home` stays
      the feed itself
- [x] `panel-renderer.ts` and `breadcrumbs.ts`: the four new cases
- [x] `pages/tree-page.ts` becomes `pages/feed-page.ts`, flat
- [x] Four list pages on phase 2's row, each carrying the create button that
      used to live in its accordion
- [x] `TREE_LIST_MAX` retired from the list pages; keep a cap only where a page
      genuinely cannot render fifty thousand rows, and say so
- [x] `urlToPageState` keeps a `tree` alias to home, beside `feed` and `people`

The four list pages are one file, `pages/list-pages.ts`: they are the same page
four times, and the only thing that differs is where the rows come from. Only
Stops kept a cap, as `CONFIG.STOP_LIST_MAX` (1000) — the panel rebuilds every
row on each realtime poll, so a regional feed's tens of thousands of places is
the one list that genuinely cannot be rendered whole. `TREE_LIST_MAX` was left
with a single caller, the assignments page's rule list, and renamed
`RULE_LIST_MAX` since there is no tree any more.

Object pages keep their own parents rather than hanging off their list page: a
trip under its route reads better in a narrow panel than a four-crumb trail
through Routes. Only the list pages themselves are one hop off the feed.

The feed page counts the managers on its link out to them, so `home` now
prefetches `members` alongside the upload history rather than leaving the badge
blank until somebody opens the managers page. A count that has not arrived
renders no badge at all, since a `0` for "not fetched" is the one that gets
believed.

**Gotcha.** The feed page renders from the API and the list pages render from
the zip. A routes or stops page opened before the zip has parsed says
"downloading the schedule", not "not in the loaded feed".

---

## Phase 4: the timeline chart

`src/modules/timeline-chart.ts`, written here against the reference above.
The input is generic because two callers want it: a row carries a key, a label,
a colour, shaded spans, per-day ticks and an optional cell renderer.
`renderTimelineChart(rows, options)` returns a string;
`attachTimelineListeners(root, onRowClick, onCellClick)` wires it.

- [x] `timeline-chart.ts` and its types
- [x] `CONFIG`: the week cell width, the row height, the range cap
- [x] The weekday-dot column and the tick glyphs
- [x] Its date arithmetic goes through `service-date.ts`, not a second set of
      helpers

**Gotcha.** `service-date.ts` is Monday-first; coloring-book's timeline is
Sunday-first. Monday-first wins here, to agree with what already ships, and the
module doc says so. The two must not disagree inside one chart.

The chart draws columns, not weeks: `unit` is `'week'` over a range or `'day'`
over one week, which is what phase 6 needs and is one branch rather than a
second module. A column is a `{ start, end }` pair either way, so the shading,
the ticks, the today marker and the cell renderer are written once; the only
things that read `unit` are the column step, the cell width and whether a
second header row of weekday names is emitted.

Shading is `color-mix(in srgb, <color> 22%, transparent)` rather than
coloring-book's `hexToRgba`, so a row can carry any CSS colour — a route colour
out of the feed is a hex, but a tracker's status colour is a daisyUI variable.

A removed tick does not widen the derived range. It marks a day the row does
*not* run, so a service ending in June with a removed date in December would
otherwise draw six empty months to reach a mark that says "nothing here".

`CONFIG.TIMELINE_MAX_DAYS` is 1096, the reference's three years, but measured
from the first drawn column rather than in milliseconds, since every date in
this repo is a string. The truncation line names the last date drawn instead of
just saying the range was cut.

`monthShortLabel` was added to `service-date.ts` — `monthLabel` is `August
2026`, which is too wide for a header cell sitting over four week columns.
`weekdayFlags` is exported from the chart itself: both callers hold
`monday`..`sunday` on an object (a `calendar.txt` row as `'1'`, a `TrackerRule`
as a boolean) and the chart wants seven Monday-first booleans.

Nothing renders it yet. Phase 5 is its first caller.

---

## Phase 5: the service view

A `{ type: 'service'; service_id }` page over the loaded zip's `calendar.txt`
and `calendar_dates.txt`, rendering the chart with one row per service. This is
the reference use, and the thing the assignments page is being made to match.

- [x] `pages/service-page.ts` and the page state
- [x] Services reachable from the phase 3 hierarchy
- [x] Route and stop pages embed the chart filtered to their own services, the
      way coloring-book's do
- [x] `trip-page.ts`'s hand-rolled service block is replaced by it

Two page states, not one: `service` needed somewhere to be reached from, and a
list of bare `service_id`s says nothing about a service, so `services` is a
fifth list page that *is* the chart — one row per service, the label the link.
It is the only list page whose rows are not `entity-row.ts` rows, for that
reason. It sorts by window start rather than by id so the chart cascades, and
caps at `CONFIG.SERVICE_LIST_MAX` (200) because a chart row is a whole table
row of cells.

`src/modules/service-catalog.ts` is where the two calendar files are put back
together, since four pages now ask the same question. It is seeded from both
files: a service named only by `calendar_dates.txt` is real and runs on exactly
the dates it lists. It deliberately does not walk trips — the panel rebuilds on
every realtime poll and a feed has tens of thousands of them — so the service
page, the one page that needs them, asks with `tripsForService` and derives its
route list from the same pass.

A window is only shaded where the service runs on at least one weekday. A
`calendar.txt` row with every day off runs on its added dates alone, and
shading its window would claim a year of service that is not there.

The chart grew `TimelineRow.labelHtml`, which is how a row navigates: a `<tr>`
is not something an `<a>` can wrap, so the label carries `entityLink`'s anchor
and the panel's existing `data-nav` delegation does the rest, with no
per-render listener. `cursor-pointer` moved out of the rendered row class and
into `attachTimelineListeners`, so a chart nobody wired up stops advertising a
click that does nothing.

A service has no colour of its own, so the accent is the default and a caller
with a better one passes it: the route page shades its services in the route's
own colour. The stop page aggregates over its platforms' trips, the same way
its routes and departures do.

`service` is one hop off the services list rather than off the feed — it is the
only parent a service has. `validateState` checks it against both calendar
files, so it answers false until the zip is in, like every other GTFS variant.

---

## Phase 6: assignments on the chart

The month grid goes. The page becomes a list of weeks, each an openable object,
and an open week is the chart with one row per trip and seven day columns, each
cell carrying the tracker assigned to that trip that day.

Rows are the trips a rule already touches in that week, plus an "Assign a trip"
button running `trip-picker.ts`.

**The data model already supports multi-week continuation and needs no
migration.** `TrackerRule` is `start_date` plus a nullable open-ended
`end_date`, seven weekday booleans, and a `start_time`/`end_time` window in
seconds since service midnight, with `TrackerRuleException` rows for per-date
departures, unique on `(rule_id, date)`. A rule spanning ten weeks is one row.
What the model cannot express is "every other week": that is one exception per
skipped date, and the editor should say so rather than offer a control that
silently writes forty rows.

Editing a cell is therefore one of exactly three writes, and only those three
are offered: edit the rule, which changes every week; add a `removed`
exception, which skips one day; add an `added` exception, which runs one day.

- [x] `pages/assignments-page.ts` rebuilt on `timeline-chart.ts`; the
      `grid grid-cols-7` and `CONFIG.CALENDAR_DAY_CHIPS` deleted
- [x] Weeks as openable objects, keyed by `data-detail` so the panel's open
      state survives a re-render
- [x] Cell click into the three writes, through the existing `assign:*`
      actions. No new endpoints
- [x] Conflict marking carried on the cell, in the chart's own visual language
      rather than the page's `bg-warning/30` invention
- [x] `{ type: 'assignments'; date? }` keeps its `date` and now anchors a week;
      `gridRange` widens to the visible weeks
- [x] `AppState`'s assignment window still bounds what is fetched
- [x] The map still draws the selected day's assigned trips

**Gotcha.** An assignment can name a `trip_id` the loaded zip no longer has, as
a feed can be reloaded out from under a rule. That row still renders, as its
bare id, exactly as the page does today.

There is no `MAX_ASSIGNMENT_DAYS`: the window has only ever been whatever
`gridRange` asked for, which is now `CONFIG.ASSIGNMENT_WEEKS` (6) weeks from the
anchor's Monday rather than a padded month. `startOfWeek` and `shortDayLabel`
were added to `service-date.ts`, and `TIMELINE_DAY_CELL_PX` went 40 to 64,
because a day cell now has to hold a tracker nickname rather than a date.

The anchored week is a plain always-open `section`, not a forced-open
`<details>`. The panel restores open disclosures from its own set on every
re-render, so a page that rendered `open` would reopen a week the reader had
just closed, fifteen seconds later. Every other week is a `<details>` keyed
`assign:week:<monday>` and is the reader's to open; picking a day inside one
re-anchors it, which is what makes it the open section.

A row draws no spans. The shading is the cell renderer's alone — the trip's
route colour where a tracker runs it, nothing where none does — because a span
across the week would claim seven days of service the recurrence may not have.
The exception ticks are drawn inside the cell button rather than through
`TimelineRow.ticks`: the chart appends its ticks after the cell's html, and a
full-width button leaves them nowhere to sit on a 28px row.

`assign:day` is the one new action, on `date:trip_id` — date first and ten
characters wide, since a `trip_id` may contain a colon. It opens a menu of
exactly the writes that cell can take (undo the exception it already carries, or
skip it, or run it; edit the rule; assign a tracker where there is none), each
with a line saying what it stores. `chooseAndRun` runs the choice after the
modal closes, so a choice that opens its own dialog does not stack.

Conflicts are counted on the second *distinct* tracker: one tracker held by two
overlapping rules is redundant, not contradictory, and the cell says its
nickname once rather than "2 trackers". The week summary carries the count as a
`badge-warning`; the cell carries the chart's `ring-warning`.

The day agenda and the "rules not running this day" disclosure are gone. Their
two jobs — reading a day, and running a rule on a day it skips — are the day
picker strip and the cell menu. "All rules" survives, converted to
`entity-row.ts` rows with the edit and delete buttons on them, since deleting a
rule is deliberately not offered from a cell.

---

## Phase 7: the calendar modal

A nav button beside About, opening one modal with a month grid and the
waterfall, showing GTFS services and the tracker assignments on each day.

- [x] The nav button and its count badge
- [x] `src/modules/calendar-modal.ts`: tabs for Month grid and Timeline, the
      grid built from `service-date.monthGrid`
- [x] Day cells stack a chip per active service and per assignment; a chip
      click closes the modal and navigates

The modal is mounted on `document.body`, outside the panel host, so
`PanelRenderer`'s `data-nav` delegation never sees a click inside it. The modal
delegates `[data-nav]` itself, closing before it navigates: the chips and both
charts stay ordinary `entityLink` anchors, so middle-click and
copy-link-address work exactly as they do in the panel, and nothing needed a
second link vocabulary.

The badge counts today's assignments, and is hidden while the answer is not
known — no feed, or an expansion window that does not reach today — because a
0 would claim nothing runs when nothing was asked. Selecting a feed now expands
today's week for that reason alone.

`AppState.ensureAssignments` is the one new method: it **widens** the held
window rather than replacing it. The modal asks for whatever month it shows
while the assignments page may be sitting behind it on other weeks, and a
narrower window would leave that page with empty cells and no request out to
fill them. The focus path still fetches its own narrow window, which is what
shrinks the union again once the reader navigates out of it. An in-flight
promise is held so two widenings cannot race and land in the wrong order.

`serviceRunsOn` was added to `service-catalog.ts`: `calendar_dates.txt` wins
outright and the weekly pattern inside its window only answers where the
exceptions say nothing, so a `calendar_dates`-only service runs on its added
dates and nowhere else. The Timeline tab draws two charts in the week unit —
the services, and one row per `TrackerRule` — since a rule is already the chart
row's shape: a date range as the span, seven weekday booleans as the dots, its
exceptions as the ticks. An open-ended rule is drawn to
`CONFIG.CALENDAR_OPEN_END_DAYS` (180) past today and says so in its tooltip,
because a span has to name a last date. `CONFIG.CALENDAR_CELL_CHIPS` (4) caps
a month cell, with the overflow as a `+n more` link into that day's
assignments — the same idea as the deleted `CALENDAR_DAY_CHIPS`, which a month
grid genuinely needs and a waterfall does not.

The modal redraws on `change`, `assignments` and `staticloaded` the way the
panel does, so an expansion that arrives after it opened fills the grid in
place, and drops those listeners when it closes.

---

## Phase 8: docs

- [ ] `CLAUDE.md`: the page hierarchy as it then is, the chart module, and the
      rule that every list goes through `entity-row.ts`
- [ ] `VENDORED.md`: `timeline-chart.ts`, `calendar-modal.ts` and
      `entity-row.ts` named as this repo's own, with coloring-book recorded as
      the visual origin and nothing checked
- [ ] `NEXT_PLAN.md` phase 10: a line saying the parity review runs after this
      plan
- [ ] `TODO.md`: the hell-gate tracker line closes with phase 1a

---

## Not in scope

- Vendoring coloring-book's `editable-table.ts`, `inline-editable-field.ts` or
  `option-picker-modal.ts`. `trip-picker.ts` and `entity-form.ts` cover what
  this app does with them.
- "Every other week" as a first-class recurrence field. It is exceptions, and
  RRULE is still out.
- Virtualizing any list. Say what was cut and let the search box do the rest.
- A shared `escape-html.ts` re-export. Nothing is vendored from coloring-book
  in this plan, so the `escapeHtml`/`escHtml` tax is not paid.

---

## Verification

`pnpm check` and `pnpm vendor:check` clean after every phase. Auth-shaped
behaviour at music-student's `:4180`, with
`VITE_RT_BASE=http://localhost:8000 pnpm build --watch` as the whole deploy
loop, since the stack bind-mounts `dist/`.

- Phase 1a: click a hell-gate tracker dot on the map. The tracker page opens
  with its properties, and follow mode arms
- Phase 1b: press Reload on a linked feed. The badge goes running to success
  with no page refresh, and one toast fires
- Phase 1c: a feed named `ab` and one named `9foo` are both refused in the
  dialog before any request. A real name with a zip succeeds. A forced
  whole-object 422 appears on the form
- Phases 2-7: build and hand off. Visual verification is the user's
