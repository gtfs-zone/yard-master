# yard-master: the schedule source, the calendar, and eight bugs

## Summary

Eight things found in use, plus the cutover work that never closed. Nothing
here is a new feature: every item is either a bug, a word that lies, or a
control that asks the reader a question the app should not be asking.

1. **The schedule source stops being a model field.** `source_kind` disappears
   from every form. A feed's schedule is set by one of two buttons — *Upload
   GTFS schedule* and *Load schedule from URL* — and whichever is used decides
   what the feed is. `GTFS Scheduled` becomes the only place the schedule is
   discussed.
2. **The browser stops guessing where the zip is.** A new same-origin
   `GET /api/feeds/{id}/schedule.zip` in cafe-car serves the current upload for
   a hosted feed and proxies the upstream for a linked one. That is one fix for
   two bugs: the CORS refusal on Amtrak's zip, and the 404 against
   `https://rt.gtfs.zone/amtrak/gtfs.zip` after an upload.
3. **The route lists stop scrolling sideways.**
4. **A one-off assignment is asked for as one.** `Repeats: Once / Weekly`,
   and the forever/until radio goes away.
5. **Unassigned is a thing the app says.** A trip nothing runs is badged
   `Unassigned` rather than badged nothing, and four places count them.
6. **The calendar defaults to the timeline, wears coloring-book's tabs, and
   its month cells scroll** instead of saying `+3 more`.
7. **The cutover.** `CURRENT_PLAN.md` phase 10 and the doc bullets left open by
   the three finished plans, carried forward here so there is one plan file.

`NEXT_PLAN.md`, `NEXT_PLAN2.md` and `NEXT_PLAN3.md` are deleted with this plan:
everything in them is checked off apart from the doc lines, which phase 7 below
now owns.

## Relevant Context

### Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Where the browser downloads a zip from | **`GET /api/feeds/{id}/schedule.zip`**, same origin, both source kinds | `CONFIG.RT_BASE` deciding where a *download* goes is the bug: at `:4180` and in a build with no `VITE_RT_BASE` it points at prod, so an upload to the local stack 404s against `rt.gtfs.zone`. Same-origin also ends the CORS problem for a linked feed without handing a third-party proxy every feed URL |
| Whether `cors.kcfam.us` is used | **No.** test-track proxies because it fetches URLs a stranger typed; this app only ever fetches feeds cafe-car already holds a row for, and cafe-car can fetch them itself | The proxy cannot reach a localhost feed, and it would put a public relay in the path of a private agency's schedule |
| `source_kind` in the UI | **Gone.** Two buttons set it; nothing asks | It is a storage detail. "Where does the schedule come from" is answered by doing one of the two things, not by choosing a word first |
| A feed with no schedule | **A normal state**, with the two buttons on it | Already true for a hosted feed created before its first upload. Making it the only new-feed state means one path instead of two |
| One-off assignments | **`Repeats: Once / Weekly`**, and no forever/until radio | The model already writes a one-off (no weekdays, `start_date == end_date`, one `added` exception). The form just never said so. `Until` becomes a plain optional date, empty meaning forever |
| The calendar's month grid | **Vendored from coloring-book as `modified`** | Its cell is a scrollbox of chips with no `+n more`, which is exactly the ask. The chips differ (this app stacks assignments under services) so it cannot be `verbatim`; the `@changes` list records the difference |
| The calendar's default tab | **Timeline** | The question this app is for is "who is covering what", and that is the waterfall. "Does this run today" is the second question |
| Tab markup | **`tabs tabs-border`**, coloring-book's | `tabs-boxed` in the calendar and `tabs-box` on the route page are two more shapes for the same control |

### What already exists and is reused

- `cafe_car/routers/static_feed.py` already streams a hosted feed's current
  upload with a sha256 ETag and a conditional GET. Phase 2's endpoint is that
  code path behind `AccessibleFeed` rather than a second implementation.
- `cafe_car/api/deps.py::AccessibleFeed` is the gate every other `/api/feeds`
  route uses, and `settings.max_gtfs_zip_bytes` is the cap both the uploader
  and schedule-foamer's downloader already enforce.
- `src/modules/feed-source.ts::scheduleFetchUrl` is the one function that
  decides where the browser downloads from. It is the whole surface of bug 2.
- `src/modules/actions.ts::ruleFields`, `validateRule`, `ruleBody` and
  `isOneOff` already express a one-off; phase 4 changes what the form asks,
  not what it writes.
- `src/modules/entity-form.ts` already renders `radio`, `weekdays`, `date`,
  `select`, `combo` and `file` fields with `visibleWhen` on any of them.
- `src/modules/entity-row.ts::entityRow` takes `badge` and `badgeHtml`;
  `Unassigned` is a badge, not new markup.
- `src/modules/timeline-chart.ts` is unchanged by all of this. Only the tab
  that opens on it moves.
- coloring-book's `src/modules/calendar-modal.ts::renderMonthGrid` is the
  source for phase 6's cell.

### What is actually wrong, per bug

- **Sideways scroll.** `feed-page.ts::scrollbox` is `max-h-96 overflow-y-auto`
  and `entityRowList` emits `<ul class="-mx-2">`. A box with `overflow-y: auto`
  and `overflow-x: visible` computes its `overflow-x` to `auto`, so the negative
  margin is a horizontal scrollbar. Same shape on `route-page.ts`'s Trips box.
- **The 404.** `scheduleFetchUrl` builds `${CONFIG.RT_BASE}/${feed_name}/gtfs.zip`.
  `RT_BASE` is prod unless `import.meta.env.DEV`, and the copy served at
  `:4180` is a production build.
- **`Loading upload history…` forever.** `feed-page.ts::renderHistory` prints it
  whenever `session.uploads === null`, and `app-state.ts` only fetches uploads
  from the `home` page's `ensureLoaded`, guarded by `loadingPages`. When
  `refreshUploads` fails — which it does when the request 500s or the feed was
  linked at the moment the page loaded — `fetchInto` notifies and leaves
  `uploads` at `null`, and nothing retries. The null needs a third state.

---

## Phase 1 — The schedule source, in the UI

`source_kind` stops being a question. The new-feed dialog asks for a name and
nothing else and creates a feed with no schedule; the feed page it lands on
carries the two buttons that give it one. The edit dialog loses its
`Schedule source` select and its `Static feed URL` field, because both are now
what the buttons write.

`GTFS Scheduled` absorbs the rest: `Source` (`Uploaded zip` / `Linked URL`),
then either `Published at` + `Serving` or `Downloaded from`, then the load
rows, then the two buttons, `Reload` (linked only), `Copy URL`, `Open in
editor`, then the upload history disclosure. There is no second place in the
app that mentions where a schedule comes from.

`POST /feeds` must accept `source_kind: "hosted"` with no upload, which it
already does — that is how the current two-request create works.

- [x] `schedule-upload.ts::showNewFeedForm`: name only. Drop `SOURCE_OPTIONS`,
      the `static_feed_url` field and the conditional zip field; create with
      `source_kind: 'hosted'` and no upload, and return the created feed
- [x] `actions.ts::editFeed`: drop the `source_kind` and `static_feed_url`
      fields and the `validate` that pairs them. It edits the name
- [x] New action `feed:link-schedule`: one dialog, one `url` field, prefilled
      from `feed.static_feed_url`, submitting
      `PATCH {source_kind: 'url', static_feed_url}`. On success
      `adoptFeedRow`, then `reloadStatic`
- [x] `feed:replace-schedule` is relabelled `Upload GTFS schedule` and is shown
      for both source kinds. On success it already re-reads the row the upload
      flipped to hosted
- [x] `feed-page.ts::renderScheduled`: the two buttons first, in that order,
      then the existing ones. A feed with no schedule at all gets a one-line
      explanation above them instead of the "never been handed to the loader"
      paragraph
- [x] `feed-source.ts::sourceLabel` keeps its two words; nothing else reads
      `source_kind` in a page

**Gotchas.** `adoptFeedRow` owns the hash rewrite on a rename and must still be
what a name edit calls. A linked feed that is switched to an upload keeps its
`static_feed_url` server-side; the page must stop showing it once
`source_kind` is `hosted`, which `isHosted` already decides.

**Discoveries.** The upload-failure branch in `showNewFeedForm`'s old
`submit` (create, then upload, then re-read via `getFeed`) is gone entirely
now that create carries no file — `createFeed` alone is the whole submit.
The "never been handed to the loader" paragraph is now keyed off `published`
(no schedule at all) rather than `load` (never loaded): a linked feed that
has a URL but hasn't loaded yet still shows its `Downloaded from` row instead
of the empty-state text; only a feed with neither an upload nor a URL sees it.
`isHttpUrl` moved from a private helper in `schedule-upload.ts` to an export,
since `linkSchedule` needed the same http/https check `showNewFeedForm` used
to do inline.

---

## Phase 2 — One same-origin URL for the zip

**cafe-car**, in `api/feeds.py` beside the upload routes:

`GET /api/feeds/{feed_id}/schedule.zip`, gated by `AccessibleFeed`. A hosted
feed streams its current upload out of the object store, reusing
`routers/static_feed.py`'s body-and-headers helper rather than re-writing it —
same sha256 ETag, same `Cache-Control`, same 304. A linked feed is fetched
server-side from `feed.static_feed_url` with `settings.max_gtfs_zip_bytes` as
the cap and streamed back with no ETag. A feed with neither is a 404 whose
detail says so, which is what the panel prints.

This is the only new endpoint in the plan and it is a read, so the CSRF header
does not apply and `X-Yard-Master` is untouched.

**yard-master:** `scheduleFetchUrl` returns
`${CONFIG.API_BASE}/feeds/${feed.id}/schedule.zip` for every feed that has a
schedule, and null for one that has none. `CONFIG.RT_BASE` keeps its job — the
realtime `.pb` links and `publicScheduleUrl` — and loses this one.

- [x] cafe-car: factor `static_feed.py`'s response builder so both routers use
      one copy
- [x] cafe-car: the new route, hosted branch, with the conditional GET intact
- [x] cafe-car: the linked branch — a capped streaming fetch, a 502 with the
      upstream's status in the detail when it refuses, a 504 on timeout
- [x] cafe-car: tests for hosted, linked, no-schedule, oversize upstream, and a
      feed the caller may not see (404, not 403 — `AccessibleFeed`'s existing
      shape)
- [x] yard-master: `feed-source.ts::scheduleFetchUrl` rewritten, its doc
      comment rewritten with it
- [x] yard-master: the `feed-download`/`gtfs-static` path is unchanged — it
      fetches a URL and this is a URL
- [x] cafe-car `CLAUDE.md` / `README`: the endpoint, and why the browser does
      not fetch the public URL

**Discoveries.** `static_feed.py`'s `_headers`/`_not_modified` were private
functions in that module; they are now exported as `upload_headers` and
`not_modified` and imported by `feeds.py` rather than duplicated. Neither
`Feed` model nor `FeedCreate` allows a `url`-sourced feed with no
`static_feed_url`, so the "linked feed with no URL" case in the plan's test
list can't occur through the API; the linked branch's 404 covers only a feed
with neither an upload nor a URL, which the hosted branch's own no-upload 404
already exercises the same code path for. Timeout and oversize-upstream tests
mock the outbound `httpx.AsyncClient` via `httpx.MockTransport`, monkeypatched
onto `cafe_car.api.feeds.httpx.AsyncClient`.

**Gotchas.** The linked branch is a proxy and must not become an open one: the
URL comes from the feed row, never from a query parameter. `publicScheduleUrl`
stays exactly as it is — it is what a *consumer* is told, and it is right to be
an absolute prod URL. The `Open in editor` link keeps using it for the same
reason. Do not send the CSRF header on this GET; `api.get` already does not.

---

## Phase 3 — The horizontal scrollbar

- [x] `feed-page.ts::scrollbox`: add `overflow-x-hidden`
- [x] `route-page.ts::renderTrips`: the same box, same fix
- [x] Check the other `overflow-y-auto` boxes in `pages/` for the same pairing
      with `entityRowList`'s `-mx-2` and fix them together

**Gotcha.** `overflow-x-hidden` on the scrollbox, not on the `<ul>`: hiding it
on the list would clip the hover background the negative margin exists to
widen.

**Discoveries.** `feed-page.ts::scrollbox` and `route-page.ts`'s Trips box were
the only two `overflow-y-auto` boxes under `pages/`; no third site needed the
fix.

---

## Phase 4 — A one-off is asked for as a one-off

The rule form's second field becomes:

```
Repeats   ( ) Once      ( ) Weekly
```

`Once` hides `Runs on`, hides `Until`, and writes what `ruleBody` already
writes for a one-off: every weekday false, `end_date = start_date`, and an
`added` exception on the date. `Weekly` shows the day pills and an optional
`Until` date — empty is forever, which is what a null `end_date` has always
meant. The `end_mode` radio is deleted; a radio pair whose only job was to say
"leave this empty" is one control too many.

`Starting` keeps its label under `Weekly` and reads `On` under `Once`, because
a one-off has no range to start.

- [ ] `actions.ts::ruleFields`: the `repeats` radio, `visibleWhen` on
      `weekdays` and `end_date`, `end_mode` deleted
- [ ] `ruleFields` opening an *existing* rule picks `Once` when the rule has no
      weekday set and `Weekly` otherwise, so an edit opens on what it is
- [ ] `isOneOff` reads `values.repeats === 'once'` rather than inferring from
      the weekday bits
- [ ] `ruleBody`: `end_date` is `start_date` for a one-off, the trimmed
      `end_date` or null otherwise
- [ ] `validateRule`: the "pick a last service date" error goes; a `Weekly`
      rule with no weekday selected is now an error, since `Once` is where that
      used to land
- [ ] `managed-render.ts::describeRecurrence`: a one-off reads `Once on
      2026-08-26`, not `1 date only · 2026-08-26 to 2026-08-26`

**Gotchas.** The one-off's `added` exception is still written by the second
request in `newAssignment.submit`, after `createRule`. Editing a rule from
`Weekly` to `Once` has to add that exception too, and editing the other way has
to remove it, or a rule flips to weekly and keeps a stray exception on its
start date. `assign:day` and the calendar's cell menu write exceptions on
existing rules and are not touched.

---

## Phase 5 — Unassigned, said out loud

A trip with no rule gets a badge reading `Unassigned` in
`badge-ghost opacity-60`, so an assigned trip's tracker nickname still reads as
the loud thing on the row. Four counts, all off one helper.

`assignedTrackers` moves out of `route-page.ts` into `service-catalog.ts` as
`assignedTripIds(session): Set<string>` plus
`assignmentCounts(session, tripIds): {assigned, total}`, because four callers
now want it and it walks every rule each time it is asked.

- [ ] The helper, memoised per rules-revision if the profile asks for it
- [ ] `route-page.ts::renderTrips`: `Unassigned` badge, and the section heading
      carries `N unassigned` beside its count, per direction
- [ ] `feed-page.ts::renderRoutes`: the row badge becomes
      `12/40 assigned` in place of the bare trip count
- [ ] `feed-page.ts::renderScheduled`: a `Trips assigned` prop reading
      `N of M`
- [ ] `calendar-modal.ts`, timeline tab: a line under the chart saying how many
      of the feed's trips no rule touches
- [ ] `trip-page.ts` already says "No tracker is assigned to this trip"; leave it

**Gotchas.** All four counts need `session.rules`, which is fetched on the trip
page and by the calendar. The feed page must ask for it too, or its counts read
zero on first paint — extend `ensureLoaded`'s `home` branch the way phase 6
extends it for uploads. Until the rules land, the count renders as `—`, never
as `0`: the same rule the calendar badge already follows.

---

## Phase 6 — The calendar

Three changes and a vendor row.

**Timeline first.** `tab` initialises to `'timeline'`.

**coloring-book's tabs.** `tabs tabs-border`, `tab`, `tab-active`, in the
calendar and on the route page's direction tabs, so the app has one tab.

**The month cell, vendored.** coloring-book's `renderMonthGrid` cell shape
comes across: `min-h-16 p-1 rounded bg-base-200/20 border border-base-300/30
overflow-hidden`, the day number line, and the chips inside
`max-h-24 overflow-y-auto` → `flex flex-col gap-0.5`. `CALENDAR_CELL_CHIPS`,
`shown`/`hidden` and the `+n more` chip are deleted from both
`calendar-modal.ts` and `config.ts`.

`calendar-modal.ts` is currently in neither vendor tier. It gains a
coloring-book banner at `modified` with an `@changes` list — the chips are this
repo's (services *and* assignment links, coloured by route, navigating), the
data comes from `FeedSession` rather than an IndexedDB, the leading/trailing
cells are real neighbouring-month days from `monthGrid` rather than blanks, and
the timeline half has no counterpart upstream — plus a `VENDORED.md` row, and
the paragraph there listing it as having no upstream is corrected.

- [ ] `tab` defaults to `'timeline'`
- [ ] `renderHeader`: `tabs tabs-border`
- [ ] `route-page.ts`: the same tab classes
- [ ] `renderDayCell`: coloring-book's cell, scrolling chips, no `+n more`
- [ ] `CONFIG.CALENDAR_CELL_CHIPS` deleted
- [ ] The banner, the `@changes` list, the `VENDORED.md` row, and the
      correction to the "no upstream at all" paragraph
- [ ] `pnpm vendor:check` still passes

**Gotchas.** The month nav and the tab bar sit in one header row here and in
two places in coloring-book; keep this app's header. The chip class is shared
with the assignment chip and both must keep `truncate`, or a long nickname
widens the cell and the seven columns stop being equal. A scrolling cell inside
a modal that also scrolls needs `overscroll-contain` or a flick past the end of
the chips scrolls the modal.

---

## Phase 7 — Upload history, and the leftovers

**The stuck spinner.** `session.uploads` needs three states, not two:
`undefined` for never asked, `null` for asked and failed, an array for loaded.
`renderHistory` prints `Loading…` only for the first, and for the second prints
a one-line failure with a `Retry` button. `app-state.ts::ensureLoaded` asks
whenever the value is `undefined`, for any feed with an upload history rather
than for a hosted one only — a feed linked *now* still has the uploads it had,
and hiding them hides the way back.

**The carried-forward work**, from the three plans this one replaces and from
`CURRENT_PLAN.md` phase 10.

- [ ] `feed-session.ts`: the three-state `uploads`, and `setUploads` / a new
      `failedUploads()`
- [ ] `app-state.ts`: `ensureLoaded` asks on `undefined`; `refreshUploads`
      records the failure rather than only notifying
- [ ] `feed-page.ts::renderHistory`: the three states and the retry button
- [ ] `TODO.md`: close every line this plan lands, and the Amtrak/CORS line
- [ ] `CLAUDE.md`: the schedule.zip endpoint as the one download path, the two
      schedule buttons, and the calendar's vendor status
- [ ] `VENDORED.md`: the `calendar-modal.ts` row
- [ ] cafe-car `CLAUDE.md` / `README`: the upload endpoints, the public
      schedule URL and the new `/api` download (phase 2 writes the endpoint
      half; this closes `NEXT_PLAN.md`'s open doc line)
- [ ] schedule-foamer `CLAUDE.md`: the two source kinds
- [ ] railroad-club `README`: the store seam and the `GtfsUpload` model
- [ ] music-student / deploy-gtfs-rt `README`s: Garage, and what it holds
- [ ] CI in yard-master: typecheck, build, image, matching test-track's
- [ ] deploy-gtfs-rt / music-student: the nginx deployment and the Traefik
      router
- [ ] Deploy alongside the old admin on a temporary hostname and use it for
      real work
- [ ] Parity review: feeds, trackers, provisioning, alerts, members, uploads
- [ ] Swap `manage.rt.gtfs.zone` to yard-master, old admin to a temporary host
- [ ] Let it hold for a week
- [ ] Delete SQLAdmin from cafe-car: `admin/views.py`, `admin/account_view.py`
- [ ] cafe-car's `CLAUDE.md` and `README`: the two-app split as it then is
- [ ] Adopt the shared crumb shell from coloring-book, queued by test-track's
      breadcrumb work (`NEXT_PLAN3.md`'s last open line)

---

## Not in scope

- `CONFIG.WEEK_START` is 0 and `timeline-chart.ts` is Monday-first through
  `service-date.ts`. `TODO.md` asks for Sunday everywhere; it is a change to
  every chart in the app and belongs on its own.
- `Tracker columbia-county:SHOPPING_WK_758:20260821 is not in the loaded feed.`
  Still open, still `TODO.md`'s.
- Any change to how `schedule-foamer` gets its bytes. Phase 2's endpoint is for
  browsers; the loader keeps reading the object by key.

## Verification

`pnpm check` in yard-master, `make test` in cafe-car, then by hand at
music-student's `:4180` — not at `:8091` — because the schedule download, the
session and the CSRF header are all things the dev proxy forges. Specifically:
create a feed with no schedule, upload Amtrak's zip to it, confirm the map
draws; then point a second feed at Amtrak's URL and confirm the same zip
arrives without a CORS error in the console. No browser automation.
