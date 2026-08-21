# yard-master: hosted feeds, one feed page, and a spec-driven editor

## Summary

Everything in `TODO.md`, in the order the dependencies allow. The large item is
first and the rest follow it:

1. **Feed hosting.** A feed's schedule can be *uploaded* rather than *linked*.
   The zip lands in object storage, cafe-car serves it back at a permanent
   public URL, and schedule-foamer loads it from the store. Every upload is
   kept, so a bad one rolls back.
2. **One top-level feed page.** The browse tree and the feed properties page
   become one page; `{ type: 'feed' }` goes away.
3. **Managers.** People becomes Managers, "Add manager", and Transfer ownership
   moves onto that page.
4. **The GTFS-RT spec, imported.** A `src/gtfs-rt-spec/` in the shape of
   coloring-book's `src/gtfs-spec/`, checked against a vendored reference
   snapshot, so every RT field an editor touches carries its spec description.
5. **Spec-driven forms.** The same input-plus-tooltip style coloring-book uses,
   and ID fields that offer a dropdown built from the loaded static feed instead
   of asking somebody to type `route_id` from memory.
6. **The About modal**, vendored from test-track.

`CURRENT_PLAN.md` phase 10 is still open and is not moved here. The two plans
overlap in one place only: phase 10's parity review and the SQLAdmin deletion
should happen *after* phase 1-3 of this plan, because the old admin has no
upload flow to compare against and the parity list would otherwise record a gap
that is about to be filled.

## Relevant Context

### Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Object storage | **Garage**, reached through an S3 client | One small Rust binary in compose and in k3s. Writing against the S3 API rather than Garage's own means a self-hoster points `S3_ENDPOINT` at AWS, R2 or B2 and changes nothing else |
| Upload path | **Multipart POST to cafe-car**, `/api/feeds/{id}/uploads` | One code path, the CSRF header already applies, no bucket CORS, no orphaned objects from an abandoned two-step commit. Feeds are single-digit MB; the cap is the loader's existing 30 MB |
| Public URL | **`https://rt.gtfs.zone/{feed_name}/gtfs.zip`**, served by cafe-car's public app | Sits beside the existing `/{feed_name}/*.pb` routes, is permanent, is unauthenticated, and survives a storage swap. A feed consumer never learns the storage host exists |
| Upload history | **Kept.** A `GtfsUpload` row per zip; `Feed` points at the current one | A bad upload is one click back, and the feed page gets a real record of who replaced the schedule and when |
| RT spec home | **yard-master owns `src/gtfs-rt-spec/`** | This is the only app that edits RT objects. The *shape* is coloring-book's; the content is this repo's, so `VENDORED.md` records the derivation and checks nothing |
| Managers | **Labels only** | `FeedMember` and `/api/feeds/{id}/members` stay. A migration for a noun buys nothing |
| Merged feed page | **Properties on top, tree below**, one page state | Tabs would put the thing somebody wants behind another click, which is the complaint that opened this |

### What already exists and is reused

- `schedule_foamer.gtfs_loader.download_gtfs_zip` already streams with a byte
  cap (`settings.max_gtfs_zip_bytes`, 30 MB) and `load_feed_data` already parses
  the zip from bytes. The hosted path replaces *where the bytes come from* and
  nothing after it.
- `schedule_foamer.tasks.load_feed` already publishes every status transition,
  and yard-master already renders it live over SSE. An upload that enqueues a
  load therefore shows its own progress with no new plumbing.
- `src/gtfs-static.ts` parses a zip in the browser. The upload form uses the
  same parser on the `File` *before* it is sent, so a zip that will fail on the
  server fails in the dialog instead, with counts to confirm it is the right
  feed.
- `src/modules/entity-form.ts` owns every form: dirty tracking, in-flight
  disabling and 422-to-field mapping. The spec tooltips and the new field types
  are added here, not in each page.
- `src/modules/about-links.ts` is already vendored verbatim; only
  `about-modal.ts` and a header button are missing.
- coloring-book's `src/gtfs-spec/` (`types.ts`, `files/*.ts`, `index.ts`,
  `adapter.ts`) and `scripts/check-spec.ts` are the model for the RT spec, and
  its `src/utils/field-component.ts` / `tooltip-position.ts` are the model for
  the tooltip.

### The feed source model

`Feed.static_feed_url` stops being the whole answer:

```
Feed
  source_kind      'url' | 'hosted'
  static_feed_url  str | None      -- required when source_kind = 'url', null when hosted
  current_upload_id -> GtfsUpload | None

GtfsUpload
  id, feed_id, object_key, sha256, size_bytes,
  original_filename, uploaded_by_user_id, uploaded_at
```

A hosted feed's bytes are **never** fetched over HTTP by anything inside the
stack. schedule-foamer reads the object by key, so a load does not depend on the
public app being up, and a rename cannot break a load. The public
`/{feed_name}/gtfs.zip` route exists for feed *consumers* alone.

`object_key` is `feeds/{feed_id}/{upload_id}.zip` — the feed id, never the feed
name, so a rename moves nothing.

### API surface added

```
POST   /api/feeds/{id}/uploads        multipart, field `file`  -> GtfsUploadOut, 201
GET    /api/feeds/{id}/uploads        -> GtfsUploadOut[]
POST   /api/feeds/{id}/uploads/{uid}/activate  -> FeedOut, rollback
DELETE /api/feeds/{id}/uploads/{uid}  -> 204, refuses the current one
PATCH  /api/feeds/{id}                gains source_kind, keeps static_feed_url
```

Public, unauthenticated, on cafe-car's public app:

```
GET  /{feed_name}/gtfs.zip   200 with the bytes, ETag = sha256, 404 if not hosted
HEAD /{feed_name}/gtfs.zip   the same headers, no body
```

### Standing gotchas

- A member may already repoint `static_feed_url`, so upload is the same power
  and needs the same gate: `AccessibleFeed`, not `OwnedFeed`.
- Deleting a feed must delete its objects. So must the retention rule. An object
  store with no owner never tells anybody it is leaking.
- The About modal's shared blurb says "Nothing you load is uploaded anywhere."
  That is true of test-track and, after phase 1, false of this app. yard-master's
  `AboutApp` must say its own thing.
- `PUBLIC_RT_BASE` in `feed_urls.py` is hardcoded to prod on purpose. The
  hosted-feed URL goes through the same helper and inherits that, which means a
  locally created feed shows a prod URL that does not resolve. Keep it: the
  alternative is deploy config in a response body.
- Garage needs its layout applied once before it will accept a write. A compose
  stack that comes up without it fails every upload with a confusing 500, so the
  init has to be part of `scripts/reset.sh`, not a README step.

---

## Phase 1: object storage, the model, and the store seam

The seam first, with nothing using it. `railroad_club` grows an
`object_store.py`: a thin boto3 wrapper with `put`, `get`, `delete`,
`delete_prefix` and `stat`, configured from `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY` and `S3_REGION`. It lives in railroad-club
because cafe-car and schedule-foamer both need the identical client and neither
should own the other's copy.

The model change and its Alembic revision land here too, in railroad-club, where
every migration already lives. `source_kind` defaults to `'url'` for existing
rows, which is exactly what they are.

Garage joins music-student's compose with a one-shot init container that applies
the layout and creates the bucket and key, and joins deploy-gtfs-rt as a
StatefulSet with a PVC, a Service and the secret the two apps read.

- [x] railroad-club: `src/railroad_club/object_store.py` and its settings
- [x] railroad-club: `GtfsUpload` model, `Feed.source_kind`,
      `Feed.current_upload_id`, `static_feed_url` made nullable
- [x] railroad-club: the Alembic revision, backfilling `source_kind = 'url'`
- [x] railroad-club: a `Feed.is_hosted` property, so no caller compares strings
- [x] music-student: the `garage` service, the init one-shot, `.env.example`
      keys, and the layout/bucket step folded into `scripts/reset.sh`
- [x] deploy-gtfs-rt: the Garage StatefulSet, Service, PVC and secret
- [x] Tests in railroad-club against a Garage container or a stub
- [x] railroad-club bumped in cafe-car, schedule-foamer, vehicle-poser and
      trip-updogger

**What the pass turned up.** `GtfsUpload.id` is a uuid4 hex like `Tracker.id`,
not a sequence: the object is written before the row is committed, so the key
has to be known first. That also removes the flush-then-update dance the
`feeds/{feed_id}/{upload_id}.zip` layout would otherwise need, and the layout
itself lives in `object_key_for` / `feed_object_prefix` so the feed-delete sweep
and the writer cannot disagree.

The two tables reference each other, so `feed.current_upload_id` is created with
`use_alter`: as part of either `CREATE TABLE` there is no valid order. The
downgrade refuses to run while any feed is hosted rather than inventing a URL
for it.

The store is sync boto3, which is right for schedule-foamer's Celery tasks and
wrong for cafe-car's handlers, so `AsyncObjectStore` wraps every call in
`asyncio.to_thread`. Phase 2 should use that one and never the bare client: a
blocking put of a 30 MB zip stalls every request in flight.

Garage's image is a single static binary with **no shell**, which decides the
shape of both init paths. In compose it is that binary copied into alpine
(`dev/garage/Dockerfile`). In k3s there is no image to build, so `garage-init`
drives Garage's admin API with curl and jq instead; every endpoint it calls was
checked against a running node first. The image also has no entrypoint, only a
command, so the StatefulSet has to say `command: ["/garage", "server"]` — `args`
alone replaces the binary path and fails to exec.

Garage validates the key format on import: `GK` plus 24 hex, and 64 hex for the
secret. Placeholder strings are rejected with a 400, so the dev key in
`.env.example` is a real-shaped pair.

Adding two relationships to `Feed` broke five cafe-car admin tests. SQLAdmin's
edit form calls `hasattr()` across every attribute of a detached instance, so
`uploads` and `current_upload` joined the `form_excluded_columns` list that
already exists for `members` and `invites` for exactly this reason. Nothing else
in either app noticed `static_feed_url` going nullable, because every existing
row backfills to `'url'` and nothing writes a null until phase 2.

**Gotchas.** `static_feed_url` going nullable makes every existing reader a
possible `None` dereference; grep both apps for it before the revision, not
after. Garage's layout is applied once per cluster and is not idempotent in the
obvious way, so the init has to check before it applies. Pick the bucket name
now and put it in one place: it appears in compose, in k3s, and in two apps.

---

## Phase 2: cafe-car, uploads and public hosting

The upload endpoint reads the multipart body with a hard cap, opens it as a zip
in memory, and rejects it before a single byte is stored if it is not a GTFS
feed: `agency.txt`, `stops.txt`, `routes.txt`, `trips.txt`, `stop_times.txt` and
at least one of `calendar.txt` / `calendar_dates.txt`. It writes the object,
inserts the `GtfsUpload`, points `Feed.current_upload_id` at it, flips
`source_kind` to `'hosted'`, and enqueues the load. The 422s it returns name
`file`, so `entity-form` puts the message under the drop zone.

The public route streams from the store with `ETag` set to the upload's sha256
and `Last-Modified` to its `uploaded_at`, and honours `If-None-Match` so a
consumer polling hourly gets a 304 and Garage serves nothing. Not a redirect to
a presigned URL: the URL stays clean, the storage host stays private, and
conditional GET keeps the cost of the proxy hop near zero.

Retention keeps the newest `KEEP_UPLOADS` (default 10) per feed and the current
one always, sweeping on each successful upload. Feed delete drops the whole
`feeds/{feed_id}/` prefix.

- [ ] `api/schemas.py`: `GtfsUploadOut`, and `FeedOut` gains `source_kind`,
      `hosted_url`, `current_upload`
- [ ] `api/uploads.py`: the four endpoints, gated by `AccessibleFeed`
- [ ] Zip validation, shared with nothing — it is about the request, not the load
- [ ] `feed_urls.py`: `feed_static_url(feed)`, next to `feed_rt_urls`
- [ ] `routers/gtfs_rt.py` or a new `routers/static_feed.py`:
      `GET`/`HEAD /{feed_name}/gtfs.zip` with ETag and 304
- [ ] `create_feed` and `update_feed` accept `source_kind`, and reject a
      `'url'` feed with no URL and a `'hosted'` feed with one
- [ ] `delete_feed` deletes the object prefix
- [ ] Retention sweep, its setting, and a test that the current upload survives it
- [ ] Tests: upload, reject a non-zip, reject an incomplete zip, rollback,
      delete-current refused, the public route's 200/304/404

**Gotchas.** FastAPI's `UploadFile` spools to disk past a threshold, so the cap
has to be enforced while reading, not by trusting `content-length`. The public
app has no auth middleware and this route must stay that way — it is the whole
point. Check the route ordering against the existing `/{feed_name}/...` handlers
so `gtfs.zip` is not swallowed by a catch-all. A rollback re-enqueues the load;
it is not just a pointer move.

---

## Phase 3: schedule-foamer loads a hosted feed

`load_feed` branches on `source_kind` in step 2 alone. Hosted reads
`current_upload.object_key` from the store; url downloads as it does today. A
hosted feed with no current upload is a permanent failure, not a retry: nothing
is coming.

The 24-hour beat sweep should stop re-downloading hosted feeds on a timer. A
hosted feed only changes when somebody uploads, and that upload already enqueues
the load, so `ensure_all_feeds_scheduled` skips hosted feeds unless they have
never loaded or their last load failed.

- [ ] `gtfs_loader.read_gtfs_object(key)` beside `download_gtfs_zip`
- [ ] `tasks.load_feed`: the branch, and the no-upload permanent failure
- [ ] `ensure_all_feeds_scheduled`: hosted feeds excluded from the refresh timer
- [ ] Settings for the store, from railroad-club's shared config
- [ ] Tests for both branches

**Gotchas.** The store client is created per task, not at import: a worker that
starts before Garage is reachable must not die. `max_gtfs_zip_bytes` still
applies to a hosted read, even though phase 2 already enforced it, because an
object can predate a lowered cap.

---

## Phase 4: yard-master, the upload flow

The feed create dialog becomes a source choice: **Link a URL** or **Upload a
zip**. The upload half is a drop zone that parses the file with
`src/gtfs-static.ts` the moment it is chosen and reports what it found — agency,
route count, stop count, service date range — under the zone. That preview is
the feature: somebody uploading the wrong zip finds out in the dialog instead of
three minutes later in a failed load.

`entity-form` grows a `file` field type to make this possible, with the same
dirty tracking and 422 mapping as every other field.

The feed page gains a Schedule source section: which kind it is, the hosted URL
with a copy button when hosted, the current upload's filename, size and time,
and the upload history underneath with Activate and Delete on the ones that are
not current.

- [ ] `types/api.ts`: `GtfsUpload`, and `Feed` gains `source_kind`,
      `hosted_url`, `current_upload`
- [ ] `api-client.ts`: the upload call, multipart, still carrying `X-Yard-Master`
- [ ] `entity-form.ts`: the `file` field type, drop zone, and a preview slot
- [ ] `modules/gtfs-zip-preview.ts`: parse a `File`, return the summary or the
      reason it is not a feed
- [ ] `actions.ts`: the create dialog's source choice, the replace-schedule
      action, activate and delete
- [ ] The feed page's Schedule source section and upload history
- [ ] `CONFIG`: the upload size cap, mirroring cafe-car's, and the history cap

**Gotchas.** Parsing a 30 MB zip on the main thread will jank the panel; do it
off a `requestIdleCallback` or accept the freeze and say so in a spinner —
either is fine, pretending it is instant is not. The upload request is the one
write that is not JSON: the fetch helper must not set `Content-Type` and let the
browser write the multipart boundary. Never log the `File`.

---

## Phase 5: one top-level feed page

`{ type: 'tree' }` and `{ type: 'feed' }` become one. The feed's identity,
schedule source, load status and actions render as the header block of the
existing tree page; the managed and GTFS sections follow as the `<details>` they
already are. `{ type: 'feed' }` is deleted from `page-state.ts`, the panel
renderer, the breadcrumb builder and every link that produced it.

- [ ] Merge `feed-page.ts` into `tree-page.ts`, keeping the two-halves comment
      that explains why server load status and browser counts are separate
- [ ] Delete the `feed` page state and its route
- [ ] Breadcrumbs: one less hop everywhere
- [ ] Any hash carrying `#feed` still lands somewhere sensible

**Gotchas.** The header block renders from the API and the sections below render
from the zip, and the zip may never arrive. The merged page must still be useful
with `session.staticFeed` null — that is the case the old feed page handled by
existing separately.

---

## Phase 6: Managers

- [ ] `people-page.ts` -> `managers-page.ts`, the page state renamed with it
- [ ] "Add manager", and the copy throughout
- [ ] Transfer ownership moves off the feed page onto this one
- [ ] Invites keep their own wording — an invite is to a person, not a role

**Gotchas.** Transfer is `can_manage`-gated and the merged feed page is not, so
the gate moves with the button. The API keeps saying `members`; the type name
stays `Member` so the mirror of `schemas.py` stays honest, and only the label
changes.

---

## Phase 7: the GTFS-RT spec, imported

`reference/gtfs-realtime-reference.md` is a snapshot of the official reference,
committed. `src/gtfs-rt-spec/` mirrors it as typed data: one file per message
(`alert.ts`, `entity-selector.ts`, `time-range.ts`, `translated-string.ts`,
`vehicle-position.ts`, `trip-update.ts`, `trip-descriptor.ts`), each field
carrying name, type, presence (Required / Optional / Conditionally Required),
description, and enum values with their own descriptions.
`scripts/check-rt-spec.ts` diffs the module against the snapshot and runs in the
pre-commit hook, the same way coloring-book's does, so drift blocks a commit.

Only the messages this app can edit or display need to be complete on the first
pass. `Alert` and `EntitySelector` are the ones the forms use.

- [ ] `reference/gtfs-realtime-reference.md` and a `reference/README.md` saying
      where it came from and how to refresh it
- [ ] `src/gtfs-rt-spec/types.ts`, `files/*.ts`, `index.ts`
- [ ] `scripts/check-rt-spec.ts`, wired into `package.json` and pre-commit
- [ ] `VENDORED.md`: a note that the shape is coloring-book's and the content is
      this repo's, so nothing is checked against a sibling
- [ ] `managed-render.ts`'s `ALERT_CAUSES` / `ALERT_EFFECTS` /
      `ALERT_SEVERITIES` are derived from the spec, not hand-listed
- [ ] The derived lists still match cafe-car's `alert_enums.py`, with a test

**Gotchas.** cafe-car's `alert_enums.py` is the server's truth and a value the
spec allows but the API rejects is a 422 somebody will hit. If the two disagree,
the reference wins and cafe-car changes — but they must be *made* to agree, not
left to drift.

---

## Phase 8: spec-driven inputs

`entity-form` renders a label with an info affordance that shows the spec
description on hover and on focus, in coloring-book's style, plus the presence
and the type. A `select` built from a spec enum shows each value's description
in its own row rather than the bare `SIGNIFICANT_DELAYS`.

The informed-entity form stops asking somebody to type identifiers. `route_id`,
`stop_id`, `trip_id` and `agency_id` become combo inputs backed by the loaded
static feed — a searchable list of what is actually in this feed, with free text
still allowed, because a feed can legitimately reference an id the browser's
copy of the zip does not have yet.

- [ ] `modules/spec-field.ts`: the label, tooltip and presence badge
- [ ] `entity-form.ts`: `FormField` gains a spec reference and a `combo` type
- [ ] The combo: filter as you type, keyboard selection, free text allowed
- [ ] `actions.ts`: the alert and entity forms take their fields from the spec
- [ ] Dropdown sources from `session.staticFeed`, and a sane empty state when
      the zip has not loaded

**Gotchas.** The forms live in a modal over a panel that re-renders constantly;
the combo's popup must be inside the modal's DOM or it will be destroyed
underneath the person using it. Tooltip positioning near the viewport edge is
what coloring-book's `tooltip-position.ts` solves — take that, do not re-derive
it. `direction_id` and `route_type` are enums with real spec descriptions and
should get the same treatment as cause and effect.

---

## Phase 9: the About modal

- [ ] Vendor `test-track:src/modules/about-modal.ts`, `@status modified`, with
      yard-master's own `AboutApp`
- [ ] A header button beside the theme toggle
- [ ] The blurb says what this app is, and — because of phase 1 — says plainly
      that an uploaded feed is stored and published
- [ ] `VENDORED.md` row, and `pnpm vendor:check` clean

---

## Phase 10: docs and the cutover, folded back in

- [ ] cafe-car's CLAUDE.md and README: the upload endpoints, the public
      `gtfs.zip` route, the storage dependency
- [ ] schedule-foamer's CLAUDE.md: the two source kinds
- [ ] railroad-club's README: the store seam and the new model
- [ ] music-student and deploy-gtfs-rt READMEs: Garage, and what it holds
- [ ] yard-master's CLAUDE.md: hosted feeds, the RT spec and its check script,
      the merged feed page
- [ ] Then `CURRENT_PLAN.md` phase 10 resumes: the parity review now has the
      upload flow in it, and SQLAdmin's deletion follows

---

## Not in scope

- Mirroring `url`-sourced feeds into the store. Hosting is for feeds somebody
  uploaded; mirroring somebody else's feed is a different product decision.
- Presigned direct-to-browser upload. Revisit if a real feed ever approaches the
  30 MB cap.
- A GTFS validator beyond "is this a feed". MobilityData's validator is a
  service, not a function call, and pretending otherwise would make this phase
  the whole plan.
- Serving unzipped `.txt` files from the store. Consumers want the zip.
- RRULE recurrence and `.ics` export, still.
