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

- [x] `api/schemas.py`: `GtfsUploadOut`, and `FeedOut` gains `source_kind`,
      `hosted_url`, `current_upload`
- [x] `api/uploads.py`: the four endpoints, gated by `AccessibleFeed`
- [x] Zip validation, shared with nothing — it is about the request, not the load
- [x] `feed_urls.py`: `feed_static_url(feed)`, next to `feed_rt_urls`
- [x] `routers/gtfs_rt.py` or a new `routers/static_feed.py`:
      `GET`/`HEAD /{feed_name}/gtfs.zip` with ETag and 304
- [x] `create_feed` and `update_feed` accept `source_kind`, and reject a
      `'url'` feed with no URL and a `'hosted'` feed with one
- [x] `delete_feed` deletes the object prefix
- [x] Retention sweep, its setting, and a test that the current upload survives it
- [x] Tests: upload, reject a non-zip, reject an incomplete zip, rollback,
      delete-current refused, the public route's 200/304/404

**What the pass turned up.** The validator checks the required files at the zip
*root*, not by basename, because `schedule_foamer.gtfs_loader` opens
`"agency.txt"` and nothing else. A feed nested one directory down would load as
*empty* rather than fail, which is the worse of the two outcomes, so a nested
zip is refused with a message that names the directory it found.

Retention and "the current one always" only ever disagree at `KEEP_UPLOADS = 0`:
every ordinary sweep runs straight after an upload, which has just made the
newest one current. That is what the survival test sets, since nothing else
exercises the guard.

`static_feed_url` going nullable reached four readers, not one:
`routers/catalog.py`, `admin/links.py`'s viz and editor deep links, and
`/internal/feed_urls`. All four now go through `feed_static_url`, so a hosted
feed shows its own public URL everywhere the upstream one used to appear, and
`/internal/feed_urls` selects whole rows rather than the one column.

A store failure had to become a JSON answer. An unhandled `ObjectStoreError` is
a plain-text 500, and a non-JSON response is exactly how yard-master recognises
an expired session: it would reload the page instead of showing what went
wrong. Every store call in a request path answers 503 with a JSON body; the
retention sweep suppresses instead, because a store that cannot delete must not
turn a stored zip into an error.

`uploaded_at` comes back timezone-aware from Postgres and naive from SQLite, and
`format_datetime(usegmt=True)` refuses a naive one, so `Last-Modified` is
normalized rather than trusted.

The two tables' foreign-key cycle broke the *test teardown*, not the schema:
SQLite cannot ALTER away the `use_alter` constraint, so `drop_all` failed with
a foreign-key error the moment any test left a hosted feed behind. `conftest`
drops with `PRAGMA foreign_keys=OFF` and turns it back on for the test.

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

- [x] `gtfs_loader.read_gtfs_object(key)` beside `download_gtfs_zip`
- [x] `tasks.load_feed`: the branch, and the no-upload permanent failure
- [x] `ensure_all_feeds_scheduled`: hosted feeds excluded from the refresh timer
- [x] Settings for the store, from railroad-club's shared config
- [x] Tests for both branches

**What the pass turned up.** `ObjectStoreSettings` reads `.env` with
pydantic-settings' default `extra="forbid"`, so it owned the whole file rather
than its slice of it: the first store call in *any* app whose `.env` carries
other keys raised a `ValidationError` naming every one of them. cafe-car had
the same landmine and would have answered 503 on every upload in dev. Fixed in
railroad-club with `extra="ignore"`, and bumped into both apps.
schedule-foamer's own `Settings` needed the same, in the other direction: the
`S3_*` keys in its `.env` are not its to declare.

The store client is reached through `get_object_store()` and nothing else, so
schedule-foamer grew no settings of its own. The env keys are railroad-club's
names, in `.env.example` and in a pointer comment on `Settings`, so the two
apps cannot be aimed at different buckets by accident.

A missing *object* is permanent too, not just a missing upload row: the retry
reads the same absent key. Both go through `_fail_load`, which records and
publishes the failure before the task raises — `permanent` says only that the
Celery retry is pointless, and the row still takes the ordinary 24h
`next_retry_at` so the beat sweep looks once a day rather than on every pass.

The refresh exclusion is narrower than "skip hosted feeds": only the
stale-success clause takes `source_kind != 'hosted'`. Never-loaded, failed and
stuck-running hosted feeds still come through, because those are repairs rather
than refreshes and a hosted feed can be stuck exactly as a url one can.

The repo had no test suite at all, so pytest and moto are new here, with the
sqlite-plus-`StaticPool` and foreign-key-pragma setup cafe-car's `conftest`
already uses. `load_feed` is called directly rather than through Celery;
`get_session` is patched on `schedule_foamer.tasks` because the task module
imported the name at import time.

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

- [x] `types/api.ts`: `GtfsUpload`, and `Feed` gains `source_kind`,
      `hosted_url`, `current_upload`
- [x] `api-client.ts`: the upload call, multipart, still carrying `X-Yard-Master`
- [x] `entity-form.ts`: the `file` field type, drop zone, and a preview slot
- [x] `modules/gtfs-zip-preview.ts`: parse a `File`, return the summary or the
      reason it is not a feed
- [x] `actions.ts`: the create dialog's source choice, the replace-schedule
      action, activate and delete
- [x] The feed page's Schedule source section and upload history
- [x] `CONFIG`: the upload size cap, mirroring cafe-car's, and the history cap

**What the pass turned up.** `static_feed_url` going nullable is the change
that reached furthest. Four call sites downloaded the zip from it directly, and
a hosted feed has none, so `modules/feed-source.ts` now owns the question:
`scheduleFetchUrl` for what *this browser* fetches and `publicScheduleUrl` for
what a *consumer* is told. They are deliberately different values. cafe-car's
`hosted_url` is built from its hardcoded prod `PUBLIC_RT_BASE`, which is right
for the sibling-app links and for the Copy button and useless for a feed
created against a local stack, so the browser's own download resolves
`{RT_BASE}/{feed_name}/gtfs.zip` the way the realtime links already do.
`app-state.reloadStatic()` is the single entry point; nothing calls
`loadStatic` with a URL of its own any more.

A hosted feed between its creation and its first upload has no zip anywhere,
which the old code would have shown as a progress bar that never moves.
`FeedSession.noStatic()` says so instead, and the create dialog re-reads the
feed after the upload so the row carries `current_upload` before the feed is
selected.

The create dialog moved out of `feed-switcher.ts` altogether. Its hand-rolled
`<details>` form had none of `entity-form`'s 422 mapping, and the source choice
needs exactly that — a rejected zip is a 422 naming `file`. The switcher is now
a list and a button, and `schedule-upload.ts` owns both dialogs so the drop
zone and its preview are one thing rather than two copies.

`entity-form` grew two things, not one. The `file` type is the drop zone, the
preview slot and a `submit(values, files)` second argument — a `File` is not a
string and putting it in `values` would break dirty tracking for every other
field. `visibleWhen` is the other: a new feed is really two forms sharing a
header, and the field that does not apply is noise. A hidden field is still
read and still submitted; the caller decides what to do with it.

`gtfs-zip-preview.ts` repeats cafe-car's `REQUIRED_FILES` checks in the same
order and the same wording, including the nested-directory message, so a zip
that passes here and fails there is a bug rather than a difference of opinion.
The name checks run off `JSZip.loadAsync`'s central directory before anything
is decompressed, which is why the double unzip costs almost nothing.

The edit form offers `hosted` only to a feed that already has an upload. That
is the server's rule too — a PATCH carries no bytes, so it cannot be what makes
a feed hosted — and offering it otherwise would be offering a guaranteed 422.

**Gotchas.** Parsing a 30 MB zip on the main thread will jank the panel; do it
off a `requestIdleCallback` or accept the freeze and say so in a spinner —
either is fine, pretending it is instant is not. Taken as the spinner: the
parse yields once before starting so the dialog paints it first, and a second
file chosen while the first is still parsing is guarded by a token, because the
slower answer would otherwise land last and describe the wrong file. The upload
request is the one write that is not JSON: the fetch helper must not set
`Content-Type` and let the browser write the multipart boundary. Never log the
`File`.

---

## Phase 5: one top-level feed page

`{ type: 'tree' }` and `{ type: 'feed' }` become one. The feed's identity,
schedule source, load status and actions render as the header block of the
existing tree page; the managed and GTFS sections follow as the `<details>` they
already are. `{ type: 'feed' }` is deleted from `page-state.ts`, the panel
renderer, the breadcrumb builder and every link that produced it.

- [x] Merge `feed-page.ts` into `tree-page.ts`, keeping the two-halves comment
      that explains why server load status and browser counts are separate
- [x] Delete the `feed` page state and its route
- [x] Breadcrumbs: one less hop everywhere
- [x] Any hash carrying `#feed` still lands somewhere sensible

**What the pass turned up.** The header block is only the four things the plan
names — identity, owner, load status, actions, schedule source. Everything else
the old feed page rendered as a flat `<section>` became a `<details>` in the
tree's own style, because six stacked sections above the tree is the same
complaint the merge was meant to answer. Upload history, the published realtime
URLs with the sibling-app links folded in, the fleet counts and the in-browser
parse counts are all disclosures now; only "Not drawn" stays a card, since it is
already self-hiding when every count is zero.

`treeSection` takes `number | string` for its count so a section with no
meaningful total can pass `''` — Fleet passes `"3 reporting"`, which is the one
number worth reading without opening it.

Two of the old feed page's sections went away rather than moving. "Managed
here" was counts of exactly the lists that are now directly underneath it, and
"Open in" was two buttons that belong with the URLs they are built from.

The `feed` variant's removal was mechanical everywhere except `app-state`'s
`ensurePageData`, where the hosted-feed upload fetch now hangs off `home`: that
is the page the history renders on, and it is also the page every feed
selection lands on, so the request fires on select rather than on a click that
no longer exists. `urlToPageState` keeps a `case 'feed'` that returns home, so
an old link still opens the feed it named — the feed itself is a hash param,
not part of the focus.

**Gotchas.** The header block renders from the API and the sections below render
from the zip, and the zip may never arrive. The merged page must still be useful
with `session.staticFeed` null — that is the case the old feed page handled by
existing separately.

---

## Phase 6: Managers

- [x] `people-page.ts` -> `managers-page.ts`, the page state renamed with it
- [x] "Add manager", and the copy throughout
- [x] Transfer ownership moves off the feed page onto this one
- [x] Invites keep their own wording — an invite is to a person, not a role

**Gotchas.** Transfer is `can_manage`-gated and the merged feed page is not, so
the gate moves with the button. The API keeps saying `members`; the type name
stays `Member` so the mirror of `schemas.py` stays honest, and only the label
changes.

**What the pass turned up.** The rename went further than the page file,
because "people" was the name of a whole layer and not just a label. The
aggregate `People` became `Members`, `getPeople` became `getMembers`,
`session.people` became `session.members` and `refreshPeople` became
`refreshMembers` — all of which now agree with the `/feeds/{id}/members`
endpoint they wrap. `Member` and `Invite` are untouched, so the mirror of
`schemas.py` is still literal.

Transfer did not just move, it landed somewhere better. On the feed page it sat
between Edit and Delete with nothing to say who the feed could go to; on the
managers page it is directly above the list its form is built from, which is
also the list a reader has to consult before pressing it. `renderActions` on the
feed page is down to Edit and Delete, and its header comment now says where
Transfer went.

The action id `person:add` became `manager:add`, but `member:remove` and
`invite:revoke` stayed: those two name API objects rather than the role, and
renaming them would have made the ids disagree with the endpoints they call.

`urlToPageState` keeps a `case 'people'` falling through to `managers`, next to
the `case 'feed'` phase 5 left, so neither rename breaks a saved link.

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

- [x] `reference/gtfs-realtime-reference.md` and a `reference/README.md` saying
      where it came from and how to refresh it
- [x] `src/gtfs-rt-spec/types.ts`, `files/*.ts`, `index.ts`
- [x] `scripts/check-rt-spec.ts`, wired into `package.json` and pre-commit
- [x] `VENDORED.md`: a note that the shape is coloring-book's and the content is
      this repo's, so nothing is checked against a sibling
- [x] `managed-render.ts`'s `ALERT_CAUSES` / `ALERT_EFFECTS` /
      `ALERT_SEVERITIES` are derived from the spec, not hand-listed
- [x] The derived lists still match cafe-car's `alert_enums.py`, with a test

**Gotchas.** cafe-car's `alert_enums.py` is the server's truth and a value the
spec allows but the API rejects is a 422 somebody will hit. If the two disagree,
the reference wins and cafe-car changes — but they must be *made* to agree, not
left to drift.

**What this turned up.**

The reference has a thirteenth alert cause, `SPECIAL_EVENT`, that cafe-car did
not accept. The chain behind that gap was longer than one Literal: cafe-car's
lock had resolved `gtfs-realtime-bindings` at 2.0.0, whose generated
`Alert.Cause` has no `SPECIAL_EVENT`, so simply widening the Literal would have
accepted a value and then thrown inside `Alert.Cause.Value()` while serializing
the public `.pb`. The fix in cafe-car is therefore three things, not one: the
floor moved to `>=2.2.0`, the lock was refreshed, and `SPECIAL_EVENT` was added
to `alert_enums.py` and to the SQLAdmin choice list that phase 10 deletes
anyway. Its 298 tests pass. **This repo cannot check the binding version**, only
the Literal, so the same trap is waiting for the next value the reference adds.

The realtime reference is not shaped like the schedule one, so the checker is
not a port of coloring-book's. Sections are `## _message_ X` / `## _enum_ X`
rather than `### x.txt`; a field carries a Cardinality column the schedule
reference has no equivalent of; enum values live in their own tables, sometimes
with a Comment column and sometimes as bare names; and the heading markup is
inconsistent enough (`## _enum OccupancyStatus_`, `_**EMPTY**_` value cells,
`#### Values` under WheelchairAccessible) that emphasis has to be stripped
positionally rather than globally, or `active_period` parses as `activeperiod`.

Two enums are named `ScheduleRelationship`, one under StopTimeUpdate and one
under TripDescriptor, with different value sets. `RTEnumSpec.referenceOccurrence`
is what disambiguates them for the checker; only the trip one is covered, so the
runtime `rtEnum('ScheduleRelationship')` lookup stays unambiguous.

`Cause`, `Effect` and `SeverityLevel` are listed in the reference as bare values
with no Comment column, so their `description` is empty by construction and the
curated `label` is all a select row has to show. Phase 8's "each value's
description in its own row" therefore only has something to render for
`VehicleStopStatus`, `OccupancyStatus` and `ScheduleRelationship`; for cause and
effect the row is the label alone.

Coverage is deliberately partial and the checker knows it: a reference message
the spec does not declare is not a finding. What is declared must match field
for field, which is what the `--full` dump is for when refreshing.

The repo had no pre-commit hook at all, so one was added at `.githooks/pre-commit`
and has to be turned on per clone with `git config core.hooksPath .githooks`.
`pnpm check` runs the same two checks plus the typecheck for anyone who has not.

The spec adds about 60 kB of raw strings to the bundle, roughly 15 kB gzipped,
because `gtfsRtSpec` references every file and nothing tree-shakes. That is the
price of phase 8's tooltips and is worth paying once, but it is a reason not to
grow the module to messages no form touches.

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
