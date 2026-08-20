# yard-master: a map-first manager for gtfs.zone

## Summary

Build a new frontend, `yard-master`, served at `manage.rt.gtfs.zone`, that
replaces cafe-car's SQLAdmin interface. It is a static Vite/TypeScript/daisyUI
app in the shape of test-track: MapLibre fills the view, a resizable right panel
browses an object hierarchy, and every object has a properties page. Unlike
test-track those pages are editable, and the feed selector lists only feeds the
signed-in person owns or has been given access to.

Three features drive the design and none of them fit the current admin:

1. Live feed download status, pushed over SSE rather than discovered on refresh.
2. Tracker management that is one panel rather than four pages, including where
   each tracker is right now, on the map.
3. A calendar view assigning trackers to trips by day, recurring or one-off.

The old admin keeps running the whole time. Cutover is a Traefik route swap in
phase 10, after parity, and the SQLAdmin code is deleted only once the swap has
held.

## Relevant Context

### Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Repo / host | `yard-master` at `manage.rt.gtfs.zone` | Reuses the existing admin hostname, so cutover is a route swap and no bookmark breaks |
| Topology | Same host, path-routed: `/` to nginx, `/api/*` to cafe-car | Same origin means no CORS, no credentialed preflight, and `X-Auth-Request-*` arrives untouched |
| API home | New `/api` router inside cafe-car's **admin** app | Reuses `SubjectMiddleware`, `OIDCAuthBackend` and `accessible_feed_ids` as-is, so "who may touch this feed" keeps exactly one definition |
| GTFS data | Downloaded and parsed **in the browser** from `static_feed_url` | Full route geometry on day one, zero backend schedule work, and test-track's `gtfs-static.ts` already does it |
| Recurrence | GTFS-shaped: `start_date`/`end_date` on `TrackerRule` plus a `TrackerRuleException` table | It is `calendar.txt` + `calendar_dates.txt`; queryable in SQL, no new dependency, matches how every worker already thinks |
| Saving | Explicit Save per properties page | Validation errors need somewhere to land, and this admin controls a public feed |
| Live status | SSE, one channel per feed | Plain HTTP through oauth2-proxy, browser reconnect is free, extends to live tracker dots |
| Vendoring | One upstream, test-track, plus an `adopted` tier | test-track had already ported the shell modules from coloring-book's editor model to the `GTFSStatic` model this repo shares, so re-deriving them from coloring-book would reproduce test-track's files by hand |
| Feed picker | Purpose-built small switcher, not vendored `load-modal.ts` | The Load modal is examples, atlas, uploads and CORS proxying, none of which apply to "pick one of your own feeds" |
| Tracker positions | Trackers are `VehiclePosition`s on the existing vehicle layer | A tracker is a superset of a vehicle, and the map already speaks that vocabulary. One with no resolvable trip renders in the unmatched colour, so every tracker with a fix is visible and diagnosable, and `layer-manager` stays verbatim |
| Tracker ids | Never in the URL hash | `Tracker.id` is the Traccar provisioning credential; a pasted link must not leak a device secret |
| `/account` | Stays server-rendered in cafe-car | Rare, security-sensitive flow with an identity-merge confirmation. Porting it buys nothing and risks the takeover primitive |

### What already exists and is reused

- `cafe_car/admin/access.py::accessible_feed_ids` is the single definition of
  "may touch this feed". Every new endpoint scopes through it, unchanged.
- `cafe_car/admin/auth.py` resolves the caller: `request_subject` reads the
  proxy header, `verified_claims` discards any token whose `sub` disagrees with
  it, `request_is_admin` answers group membership from the token every time.
- `cafe_car/admin/context.py` carries the per-request user id and admin flag.
- `cafe_car/traccar.py` provisions devices and builds the QR. Rehomed, not rewritten.
- `cafe_car/routers/catalog.py` shows the shape of a feed-listing endpoint,
  including the rule that `Tracker.id` never appears in a response.
- test-track's `gtfs-static.ts`, `feed-download.ts`, `map-controller.ts`,
  `layer-manager.ts`, `panel-renderer.ts`, `page-state-manager.ts` and
  `search-controller.ts` are the working model for everything the shell does.

### The object hierarchy the panel browses

```
Feed (name, static URL, load status, owner)
├── Trackers        -> Tracker (nickname, credential + QR, live position, assignments)
├── Assignments     -> the calendar; rules and their exceptions
├── Service Alerts  -> Alert (cause, effect, severity, window)
│                      └── Informed Entities
├── Routes (GTFS)   -> Route -> Trips -> Trip (assign a tracker from here)
├── Stops (GTFS)    -> Stop
└── People          -> members and pending invites
```

Managed objects sit above a divider, GTFS objects below it. The GTFS half comes
from the in-browser feed, the managed half from the API, and a Trip page shows
both: its schedule from the zip, its tracker assignments from the API.

### The `FeedSession` contract

`src/modules/feed-session.ts` turned out to be the seam the whole frontend hangs
on: `render-utils`, `search-entries`, `alerts` and `rt-index` all take a
`FeedSession`, so its surface is what lets those modules stay verbatim. It is
yard-master's own file, `adopted` rather than vendored, and the names below are
test-track's on purpose. They do not change as later phases fill them in.

| Member | Filled by | Holds |
|---|---|---|
| `staticFeed`, `staticError`, `staticLoadedAt` | phase 1, done | The parsed zip, or why it could not be parsed |
| the selected feed and its API objects | phase 3 | Trackers, alerts, members, load status |
| `vehicles` | phases 6 and 7 | One `VehiclePosition` per tracker fix, keyed by nickname |
| `alerts`, `tripUpdates` | phase 6 | Live payloads off the event stream |

Anything a phase wants to add goes on this object rather than into a parallel
store, and anything a vendored module reads keeps the name it reads it by.

### API surface

All paths are relative to `/api`, all responses JSON, all scoped through
`accessible_feed_ids`.

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | user id, email, admin flag, account URL |
| GET | `/feeds` | feeds you own or are a member of. `?all=1` for admins only |
| POST | `/feeds` | create, then kick a load |
| GET/PATCH/DELETE | `/feeds/{id}` | delete is owner-only |
| POST | `/feeds/{id}/reload` | re-run the static load |
| POST | `/feeds/{id}/transfer` | owner-only |
| GET | `/feeds/{id}/events` | SSE: load status, tracker liveness |
| GET/POST | `/feeds/{id}/trackers` | never returns another feed's trackers |
| GET/PATCH/DELETE | `/trackers/{id}` | |
| GET | `/trackers/{id}/provisioning` | Traccar URL + QR payload |
| GET | `/feeds/{id}/tracker-positions` | private; maps tracker to current fix |
| GET/POST | `/trackers/{id}/rules` | assignment rules |
| GET/PATCH/DELETE | `/rules/{id}` | |
| POST/DELETE | `/rules/{id}/exceptions` | added/removed service dates |
| GET | `/feeds/{id}/assignments?from=&to=` | expanded per-day view for the calendar |
| GET/POST | `/feeds/{id}/alerts`, GET/PATCH/DELETE `/alerts/{id}` | |
| GET/POST/DELETE | `/alerts/{id}/entities` | informed entities |
| GET/POST/DELETE | `/feeds/{id}/members`, DELETE `/feeds/{id}/invites/{id}` | owner-only |

### Standing gotchas

- **Session expiry.** oauth2-proxy answers an expired session with a 302 to
  Keycloak, which `fetch` cannot usefully follow. The API client must detect a
  redirect or a non-JSON body and do `location.reload()`, not surface a parse
  error. This will be the first production bug if it is not built in phase 2.
- **CSRF.** The session is a cookie, so a cross-site form post would otherwise
  be authenticated. Every mutation carries `X-Yard-Master: 1` and the server
  rejects a mutation without it. A simple cross-site request cannot set a custom
  header, and a preflighted one is blocked by the absence of CORS.
- **The tracker credential.** `Tracker.id` is the Traccar `uniqueId`. It may
  appear in a properties panel and a request body, never in the hash, a log, a
  breadcrumb, or a GTFS-RT feed.
- **Feed size.** The zip is fetched before anything is browsable. Use the
  vendored `feed-download.ts` progress bar and its `AbortSignal`, and make the
  managed half of the tree usable while the zip is still downloading.
- **GTFS times past 24:00.** `start_time`/`end_time` on a rule are feed-local
  and may exceed 24:00 for overnight trips. Do not round-trip them through a
  `Date`.
- **`Feed` relationships.** The old SQLAdmin rule about `form_excluded_columns`
  dies with SQLAdmin, but the underlying trap does not: serializers must select
  explicitly rather than walking relationships on a detached instance.
- **The `verbatim` set shrinks, by design.** Every phase takes another vendored
  file over. `vendor:check` is a contract on the files nobody has claimed yet,
  not a number to preserve: promote a file to `adopted` rather than contorting
  feature work to keep a row green.
- **Two banners, not one.** `vendor-check` strips the banner on the local side
  only, so a file taken out of test-track's tree has to *keep* test-track's own
  banner underneath yard-master's. Deleting it is what makes a row report DRIFT.

---

## Phase 1: repo scaffold and the vendor spine

The scaffold exists (this commit). This phase makes it real: pull the vendored
modules across from both upstreams, port `vendor-check.ts` to resolve a row
against the repo named in its `Source repo` column, and get `pnpm build` green
with a map on screen and an empty panel beside it.

Vendoring first, before any feature, is deliberate. Every later phase renders
into this furniture, and discovering in phase 5 that the panel resizer or the
theme controller needs adapting is far more expensive than finding it now.

The split this phase set out with, written down here as what was assumed rather
than what happened. **From coloring-book**: `styles/main.css`,
`notification-system`, `feed-progress-indicator`, `theme-controller`,
`panel-resizer`, `bottom-sheet`, `basemap-styles`, `basemap-control`,
`layer-manager`, `stop-layer-style`, `route-sort`, `utils/route-colors`,
`utils/theme-color`, `types/page-state`, `page-state-manager`,
`search-controller`, `render-utils`, `modal-utils`, `utils/issue-card`,
`about-links`. **From test-track**: `gtfs-static.ts`, `feed-download`,
`feed-time`, `map-controller`, `gtfs-rt`, `rt-index`, `alerts`,
`search-entries`. Both lists are right about *which* files; see below for where
they actually came from.

`page-state.ts` is `modified` from the start: the variants here are
`home | feed | tracker | assignments | alert | route | stop | trip | people`,
which is a different set from either upstream. Write the `@changes` list as the
file is created, not afterwards.

- [x] `pnpm install`, confirm the scaffold builds and typechecks
- [x] Port `scripts/vendor-check.ts` with per-row source-repo resolution, keeping
      the drift and staleness passes and the skip-if-absent exit 0
- [x] Vendor the coloring-book set, each with a banner and a `VENDORED.md` row
- [x] Vendor the test-track set the same way
- [x] Adapt `types/page-state.ts` to yard-master's variants, `@status modified`
- [x] Wire `map-controller`, `panel-resizer`, `bottom-sheet`, `theme-controller`
      into `index.ts` so the shell renders with an empty panel
- [x] Add a logo to `public/`, port `nginx.conf` health probe expectations
- [x] `pnpm typecheck` and `pnpm build` green

**Gotchas.** `feed-progress-indicator` touches `document.body` at import time, so
it cannot be imported before the DOM exists. `notification-system`'s `notify`
singleton needs an explicit `.initialize()`. `theme-color.ts` caches per token,
so `clearThemeColorCache()` has to run on every theme change or MapLibre keeps
painting the old accent. The basemaps in `basemap-styles.ts` are glyph-less: no
`symbol` layer with text can render over them.

### What the vendor pass turned up

**A row names the sibling whose bytes were taken, not the repo the file was
born in.** The split assumed here, coloring-book for the shell and test-track
for the realtime modules, does not survive contact with the import graph.
`layer-manager`, `basemap-control`, `panel-resizer`, `bottom-sheet`,
`route-colors`, `issue-card`, `page-state-manager` and `main.css` are all files
test-track already records as `modified` from coloring-book, and every one of
those modifications is the adaptation from coloring-book's editor model to the
`GTFSStatic` model yard-master shares. Vendoring coloring-book's copy would
mean re-deriving test-track's file by hand.

The pass first kept the two-upstream story by pointing those eight rows at
test-track and leaving the other twelve on coloring-book. That was retired
immediately after: twelve of the thirteen were verified byte-identical in
test-track at `56f120a`, so the `Source repo` column was a constant dressed as
a variable.
**test-track is now the one upstream**, with `modal-utils.ts` the single
exception, since coloring-book's copy is a superset of test-track's older one
and `notification-system.ts` imports `renderCloseIcon` from the newer form. The
coloring-book origin of a file is recorded in its note rather than in the
column. `VENDORED.md` gained a third status, `adopted`, for files yard-master
owns outright, so `verbatim` stays a contract that is enforced instead of a set
that drains as the phases land.

A file taken out of test-track's tree carries test-track's own vendor banner,
and that banner has to be **kept**, not deleted. `vendor-check` strips the
banner on the local side only, so the local file is yard-master's banner plus
test-track's file entire. Deleting the inner banner is what makes a row report
DRIFT. It also keeps the provenance chain in the file: ours names test-track,
test-track's names coloring-book.

**Three more files had to be modified, not just `page-state.ts`.** Changing the
variant union breaks every consumer that switches on it: `page-state-manager`
(the hash codec), `map-controller` (`applyFocus` and the layer select handler)
and `search-entries`. The hash codec needed rewriting anyway, because `feed`,
`assignments` and `people` name no object and cannot be told apart by the
presence of an object key the way test-track's four pages could; the hash now
carries an explicit `type` param, matching the shape phase 3 assumes. The
LayerManager target kind stays `vehicle`, which is the map layer's own
vocabulary and unrelated to the page variant.

**`feed-session.ts` had to land here rather than in phase 3.** `render-utils`,
`search-entries`, `alerts` and `rt-index` all `import type { FeedSession }`, so
there is no way to vendor them and keep `pnpm typecheck` green without one. The
phase 1 version owns the static half only: it downloads and parses the zip with
progress and cancel, and exposes the `staticFeed` / `vehicles` / `alerts` /
`tripUpdates` shape those four modules read. It is yard-master's own file, carried as the
one `adopted` row so the seam is inventoried rather than invisible, and its
surface is written down as the `FeedSession` contract above. Phase 3 adds the
API objects and the feed switcher; phases 6 and 7 fill the live maps.

**Two dependency notes.** `gtfs-realtime-bindings` is a real dependency of this
repo now, pulled in by `gtfs-rt.ts`; yard-master never polls a `.pb`, but the
`VehiclePosition` / `TripUpdate` / `AlertRecord` types are what the vendored
panel and map modules are written against. `@types/geojson` is an explicit
devDependency: test-track gets the `GeoJSON` namespace transitively through
maplibre's dependency graph, and on a fresh install that resolved differently
here, so `layer-manager` would not compile without it.

**The search priorities were rebucketed now rather than in phase 4b**, since
`search-entries` was being modified anyway: trackers 0, stations 1, routes 2,
plain stops 3.

---

## Phase 2: the authenticated API in cafe-car, read-only

Add `cafe_car/api/` to the **admin** app, registered before `Admin` mounts at
`/` for the same reason `entity_router` already is: the mount swallows anything
registered after it. Read-only to start, so the SPA has something real to render
before any write path exists.

The security work is the whole point of this phase, and it is all reuse. Every
query goes through `accessible_feed_ids`. Every response is built from an
explicit Pydantic model, never by dumping an ORM object, which is what keeps
`Tracker.id` out of a response that should not carry it. The CSRF check and the
session-expiry contract are established here even though nothing mutates yet.

- [x] `cafe_car/api/__init__.py`, `deps.py` (current user, feed access dependency)
- [x] `schemas.py`: explicit response models, with `TrackerOut` split into a
      public form and a credential-bearing form used only by the tracker detail
      and provisioning endpoints
- [x] `GET /api/me`, `GET /api/feeds`, `GET /api/feeds/{id}`
- [x] `GET /api/feeds/{id}/trackers`, `GET /api/trackers/{id}`
- [x] `GET /api/feeds/{id}/alerts`, `GET /api/alerts/{id}`, entities
- [x] `GET /api/feeds/{id}/members`
- [x] CSRF dependency: reject any unsafe method lacking `X-Yard-Master`
- [x] Register the router before the `Admin` mount; confirm the old admin still works
- [x] pytest: a user cannot read another user's feed, tracker, alert, entity or
      member list through any endpoint. One test per endpoint, no exceptions
- [x] pytest: an admin (`gtfs-admins`) can, and a forged `groups` claim cannot
- [x] pytest: `Tracker.id` is absent from every list response

**Gotchas.** `accessible_feed_ids` reads `current_user_is_admin_var`, which
`SubjectMiddleware` sets per request; a test that calls a query function outside
a request has to set the ContextVar itself or it silently gets the non-admin
path. Do not scope by the raw proxy header anywhere, only by resolved `user_id`.
The 404-versus-403 choice matters: return 404 for a feed the caller cannot see,
so the endpoint does not confirm that an id exists.

### What building it turned up

Landed on cafe-car's `feat/yard-master-api`, 29 new tests, whole suite green at
150.

**A tracker needs a second detail route, addressed by nickname.** Keeping
`Tracker.id` out of every list response and addressing trackers by `id` are not
compatible: a client that only ever sees nicknames can never reach
`/trackers/{id}`. The panel navigates through
**`GET /feeds/{id}/trackers/{nickname}`**, which returns the credential-bearing
form; `/trackers/{id}` stays as the resource path for a caller that already
holds the credential, and phase 5's PATCH and DELETE hang off it. Nickname is
not unique in the schema, so the nickname route resolves a collision to the
lowest id, which is deterministic rather than correct. **Phase 5 owes a
uniqueness check on the tracker write path**, and until it lands two trackers
sharing a nickname on one feed are unreachable by the panel.

**`accessible_feed_ids` was the wrong scope for the feed list.** It applies the
admin bypass, so an admin's feed switcher would have listed every feed on the
server and buried their own. Split out `access.py::personal_feed_ids`, the
owned-or-shared query with the bypass deliberately not applied;
`accessible_feed_ids` is now that plus the bypass, so the definition is still
written once. `GET /feeds` uses the personal one and `?all=1` opts an admin in;
`GET /feeds/{id}` keeps the bypass, so an admin following a link still lands.

**Caller resolution now has one definition.** `entity_router._current_user_id`
was the only code that answered "who is calling" for a route SQLAdmin's
`authenticate` never ran for, and the API needed exactly that. It moved to
`auth.py::resolve_request_user_id` and both routers call it, rather than the
API growing a second copy of a security-critical function.

**CSRF is a router dependency, not a route one.** `require_csrf` is mounted on
the whole `/api` router, so every mutation phase 5 adds inherits it without a
route having to remember. Nothing under `/api` mutates yet, so its test drives
the dependency directly.

**The session-expiry contract is the API's half of a frontend promise.** There
is nothing to build server-side: oauth2-proxy answers an expired session before
a request reaches this app. What phase 2 owes is that every answer the API
*does* build is JSON including its errors, which is what makes "not JSON" an
unambiguous reload signal for the client in phase 3.

**Ruff's TC0xx rules are off under `api/`.** FastAPI resolves annotations at
runtime to build dependencies and response models, so moving a type into a
`TYPE_CHECKING` block turns it into a `NameError` at import.

**`FeedOut` carries more than the plan's table implies**, because the shell
needs it in phase 3: the owner's display name, an `is_owner` flag matching what
`owned_feed` would actually permit, the three public GTFS-RT URLs from
`feed_urls.py`, and a nested `load` object mirroring `GtfsStaticFeed`. That
nested shape is deliberate: phase 6 pushes the same object down the SSE
channel, so a client applies an update without a second representation.

**Reading the member list is not owner-only**, though the API table says the
`/members` row is. It matches the SQLAdmin panel this replaces: a member needs
to know who else is on a feed. The *mutations* are owner-only and phase 5 adds
them behind the `OwnedFeed` dependency, which is written and unused for now.

---

## Phase 3: the shell, the feed switcher, and hash state

The app becomes navigable. A feed switcher modal lists your feeds from
`GET /api/feeds`, selecting one downloads and parses its zip in the browser with
a progress bar, and the hash carries both the feed and the focused object so any
page is linkable.

Hash shape: `#feed=<feed_name>&type=tracker&tracker=<nickname>`. Settled in
phase 1: the codec already carries the explicit `type` param, because `feed`,
`assignments` and `people` name no object and cannot be told apart by the
presence of an object key. The feed is named by `feed_name`, not by id, so a
link stays readable. Trackers are named by nickname, never by id, per the
standing gotcha.

- [ ] `api-client.ts`: typed `get`/`post`/`patch`/`del`, the CSRF header on
      every mutation, and the redirect/non-JSON detection that triggers a reload
- [ ] `feed-switcher.ts`: your feeds, a New feed form (name + static URL), and
      an admin-only "show all feeds" toggle, off by default
- [ ] Extend `feed-session.ts` with the selected feed and its API objects; the
      static half and the change-event dispatch landed in phase 1. Follow the
      `FeedSession` contract above rather than adding a parallel store
- [ ] `app-state.ts` + `page-state-manager` wiring, breadcrumbs, hash sync
- [ ] Selecting a feed loads the zip through `feed-download` with progress and
      cancel; the managed half of the tree is usable before it finishes
- [ ] `POST /api/feeds` and `POST /api/feeds/{id}/reload` in cafe-car
- [ ] Map renders the feed's stops and routes; the panel is phase 4a's, pointed
      at a real feed instead of the hardcoded URL

**Gotchas.** Only `PageStateManager` may write the hash, which is what keeps its
`suppressHashUpdate` guard honest. Deleting `CONFIG.DEV_FEED_URL` is part of
this phase, not a later cleanup: two ways to choose a feed is one too many. A newly created feed has no
`gtfs_static_feed` row at all, so every status reader must handle null rather
than assuming `pending`. A feed whose `static_feed_url` is unreachable must
leave the managed half of the app fully usable.

---

## Phase 4a: the browse tree and the GTFS pages

Fill the panel with the half that needs no API. One dispatcher over `PageState`,
one module per page, exactly as test-track's `panel-renderer.ts` does it,
including the scroll-restore and open `<details>` tracking that make a re-render
survivable.

`panel-renderer.ts` is the largest unvendored piece left: phase 1 vendored
`render-utils.ts`, which is the shared furniture, but not the dispatcher above
it. Nothing here talks to cafe-car, so this phase runs against a hardcoded
`static_feed_url` in `config.ts` and can proceed before or alongside phase 2.
Doing it early derisks the whole vendored panel and map stack against a real
feed, months before the backend is in the way.

- [ ] `panel-renderer.ts` dispatcher plus shared furniture (breadcrumbs, headers)
- [ ] `CONFIG.DEV_FEED_URL`: one hardcoded feed, loaded on boot, deleted in phase 3
- [ ] `pages/route-page.ts`, `pages/stop-page.ts`, `pages/trip-page.ts` from the
      in-browser GTFS
- [ ] Tree navigation over the GTFS half: section headers, counts, click to focus
- [ ] Map and panel stay in sync: focusing an object moves the camera, clicking
      the map focuses the object
- [ ] Search box via `search-entries`, GTFS entries only

**Gotchas.** The panel re-renders on every live event, so nothing may hold state
in the DOM that is not also in the model. Escape everything: `trip_id`,
`stop_name` and `route_long_name` are all free text from a stranger's zip.
`map-controller` currently treats `trip` as a variant that clears focus without
moving the camera; rendering a trip's shape is this phase's job and the
`@changes` list has to be updated when it changes.

---

## Phase 4b: the managed pages

The other half of the panel, once phase 3 has a feed and an API to read.

- [ ] `pages/feed-page.ts`: properties, load status, counts, deep links to viz
      and the editor
- [ ] `pages/tracker-page.ts`, `pages/alert-page.ts`, `pages/people-page.ts`
- [ ] The managed/GTFS divider in the tree, managed objects above it
- [ ] Search covers both halves, managed objects bucketed ahead of GTFS objects
      by `priority` (already rebucketed in `search-entries` in phase 1)

**Gotchas.** Escape everything here too, and for a sharper reason: `nickname`
and `header_text` are typed by a person with write access to the feed, and the
old admin has a rule about this because it was a real stored-XSS vector.
`Tracker.id` renders on the tracker page and nowhere else, never in a
breadcrumb, a title or a link.

---

## Phase 5: writes

Every properties page gets an explicit Save. Field-level validation errors come
back from the API and render next to the field that caused them, which is the
main thing the old admin does well and must not be lost.

- [ ] `POST`/`PATCH`/`DELETE` for feeds, trackers, alerts, informed entities
- [ ] Members and invites: add, remove, and the owner-only checks
- [ ] `POST /api/feeds/{id}/transfer`
- [ ] Traccar provisioning rehomed: QR and deep link in the tracker panel
- [ ] A shared form renderer: dirty tracking, Save/Revert, disabled while in
      flight, field errors from a 422
- [ ] Destructive actions behind a typed confirmation
- [ ] pytest for every write path, including the scoping tests from phase 2
      repeated against the mutating verbs
- [ ] Bulk tracker create (a prefix and a count)

**Gotchas.** Deleting a tracker should also retire its Traccar device; confirm
what the current code does before copying it. `feed_name` is unique and is in
the hash, so renaming a feed has to rewrite the hash rather than leave a link
pointing at a name that no longer exists. Invites match on **verified** email
only; that rule is an account-takeover boundary and moves across untouched.

---

## Phase 6: the SSE channel and live load status

`GET /api/feeds/{id}/events` streams events for one feed. First payload is the
current state, so a client never has to poll once to bootstrap. schedule-foamer
publishes to Redis; the endpoint subscribes and forwards.

If schedule-foamer only flips `pending -> running -> success/failed` today, ship
that and treat finer progress as a follow-up in that repo. The channel is worth
building either way, because tracker liveness rides on it in phase 7.

- [ ] Redis pub/sub channel per feed, published by schedule-foamer on status change
- [ ] `GET /api/feeds/{id}/events` SSE endpoint, current state first, heartbeat
      comment every 20s so no proxy idles the connection out
- [ ] Client `event-stream.ts`: subscribe on feed select, reconnect with backoff,
      close on feed change
- [ ] Load status card updates live; the Reload button reflects in-flight state
- [ ] A failed load surfaces `error_message` and the `next_retry_at` countdown
- [ ] Position events on the channel are GTFS-RT-shaped JSON, so they land in
      `FeedSession.vehicles` as `VehiclePosition`s with no translation layer
- [ ] Measure the built bundle: `gtfs-rt.ts` imports `transit_realtime` and
      calls `FeedMessage.decode`, but yard-master never polls a `.pb` and the
      only runtime import from that module anywhere is `presentNumber`. If
      protobufjs survives tree-shaking, split a types-only module and drop the
      `gtfs-realtime-bindings` dependency

**Gotchas.** SSE through oauth2-proxy and Traefik needs response buffering off,
or events arrive in clumps at the end. The session can expire mid-stream: an
`onerror` that reconnects forever against a 302 is an infinite loop, so cap the
retries and fall back to a page reload. One connection per feed, and it must be
closed when the feed changes or a long session accumulates them.

---

## Phase 7: trackers on the map

Answer "where is this thing right now" without leaving the app.

`GET /api/feeds/{id}/tracker-positions` reads the `vehicle:{tracker.id}:*`
keyspace and returns positions keyed by tracker. It is authenticated and scoped;
the public `.pb` deliberately labels vehicles by `nickname` and must stay that
way.

There is no separate tracker layer. A tracker with a fix enters
`FeedSession.vehicles` as a `VehiclePosition` and draws on the existing vehicle
layer, whether or not it resolves to a trip. `LayerManager.buildVehicles` already
falls back to `CONFIG.VEHICLE_UNMATCHED_COLOR` when neither `routeId` nor
`tripId` resolves, and `vehicles-dot` paints `['get', 'color']`, so an
unassigned tracker is already a visually distinct dot. It already counts those
into `issues.vehiclesUnmatched`, which the vendored `issue-card` renders, so
"three trackers are not assigned to anything" is a warning card for free. Every
tracker is on the map all the time, which is the point: seeing which ones are
idle is how you decide what to assign. `layer-manager.ts` and `issue-card.ts`
stay `verbatim` through this phase.

- [ ] The positions endpoint, scoped, with the 60s TTL meaning "present is fresh"
- [ ] Tracker positions pushed on the phase 6 channel, into `FeedSession.vehicles`
- [ ] Reword the unmatched issue-card row: here it means "unassigned", the normal
      state of an idle tracker, not test-track's "the feed is lying to you"
- [ ] Liveness dot in the tracker list: reporting, last seen, never seen. A
      tracker with no fix has no coordinates and so is panel-only, listed and
      correctly absent from the map
- [ ] Tracker page: current position, assigned trip, a Google Maps link, camera
      follow while focused
- [ ] Feed page shows the whole fleet at once

**Gotchas.** `VehiclePosition.key` is the map feature id, the `vehicles` map key
and the click identity, so it must be the **nickname**, never `Tracker.id`, and
`vehicleId` with it. A tracker can report several concurrent vehicles, one Redis
key per `trip_id[:start_date]`; those collide on a bare nickname, so `key` is the
nickname plus the trip discriminator, and `issues.vehiclesDuplicateKeys` will
flag it if that is got wrong. The panel must show all of a tracker's vehicles
rather than the first one the scan returns. Never log a position payload with
its `tracker_id`.

---

## Phase 8: the recurrence model in railroad-club

The data change, on its own, so it can be migrated and deployed before any UI
depends on it. `TrackerRule` becomes a `calendar.txt` row and gains an exception
table that is `calendar_dates.txt`.

```
TrackerRule       + start_date: date, + end_date: date
                  ! start_time, end_time: time -> int (seconds since service midnight)
TrackerRuleException  id, rule_id, date, exception_type (added | removed)
```

### The audit, done before writing this

Nothing in `vehicle-poser` or `trip-updogger` names `TrackerRule`. The only
reader in the fleet is `railroad_club/trip_resolver.py::resolve_tracker_trip`,
and its only caller is `vehicle_poser/main.py::_resolve_trip`, once per Traccar
`/forward` POST. `trip-updogger` never sees a rule: it consumes the redis
`vehicle:*` record vehicle-poser wrote and takes `trip_id` as given.
`schedule-foamer` and `hell-gate-bridge` have no references. Writers are
`cafe_car/admin/views.py::TrackerRuleAdmin` (the view this repo replaces),
`cafe-car/scripts/provision_source.py`, and two cafe-car tests.

So the blast radius is one resolver, one caller, one admin view, one script. But
the audit turned up two things that widen the change itself:

**A midnight-crossing rule is currently inexpressible, not merely mishandled.**
`resolve_tracker_trip` filters `start_time <= now AND end_time > now` against a
single weekday column, so a 23:00-01:00 rule has `start_time > end_time` and
matches on no day at all. The columns are `datetime.time`, so >24:00 cannot be
stored either. Adding dates does not fix this; it is a column-type change plus a
resolver rewrite that also evaluates the previous service day.

**Rule-driven vehicles carry no `start_date`, and the rest of the pipeline is
already built around one.** vehicle-poser's redis record has no `start_date`
key. Downstream, trip-updogger keys `trip_update:{trip_id}:{start_date}` with a
bare-`trip_id` fallback, and cafe-car dedups vehicles and builds
`VehicleDescriptor.id` from the `(trip_id, start_date)` pair. Both tolerate
`None`, so nothing is broken today, but two concurrent instances of one
overnight trip collapse onto a single key. hell-gate-bridge, the other producer
into the same `vehicle:*` namespace, does emit `start_date`. The tracker path is
the odd one out.

### The decision, written down once

**A rule's service date is the date its window *starts* in feed-local time, and
that date is the trip's GTFS-RT `start_date`.** A rule whose window crosses
midnight keeps the earlier date for its whole run. Weekday columns and
`start_date`/`end_date` are therefore tested against the service date, never
against the wall-clock date of the fix. Every consumer agrees on this.

- [ ] Model change and Alembic revision in railroad-club, including the
      `time` -> seconds-since-service-midnight conversion for `start_time` and
      `end_time` (GTFS-shaped, matching `trip_updogger/trip_math.py::parse_gtfs_time`)
- [ ] Backfill: existing rules get a start of today and an open-ended end, so
      nothing silently stops running; existing times convert as `h*3600+m*60+s`
- [ ] Rewrite `resolve_tracker_trip` to return `(trip_id, service_date)`:
      evaluate today's and yesterday's service dates, apply weekday columns,
      the date range, and exceptions, last-created rule still wins
- [ ] `vehicle-poser` puts `start_date` (YYYYMMDD) in the redis record from the
      resolver's service date
- [ ] Update `TrackerRuleAdmin` and `scripts/provision_source.py` in the same
      change, or they write rows with null dates
- [ ] Bump the railroad-club dependency in cafe-car, run `railroad-club-migrate`
- [ ] `GET /api/feeds/{id}/assignments?from=&to=` expanding rules over a range,
      exceptions applied, in feed-local time

**Gotchas.** Expansion is feed-local, from `GtfsStaticFeed.timezone`. A rule
with no `end_date` is open-ended, not expired. `resolve_tracker_trip` returns
`None` when the feed has no loaded `GtfsStaticFeed` or no timezone; keep that,
it is the only safe answer. The two-service-day evaluation can match a rule on
both days at once for a >24h window, so order by service date before rule id.
Ship the railroad-club and vehicle-poser changes together: an old vehicle-poser
against a new resolver signature is a TypeError on every position POST.

---

## Phase 9: the assignments calendar

The feature that motivated all of it. A month grid on the feed's Assignments
page, each day cell listing tracker-to-trip assignments; clicking a day opens an
agenda for editing. Hand-rolled, no calendar library.

Creating an assignment: pick a trip (a picker over the in-browser GTFS, not free
text), pick a tracker, pick days and a date range. Editing one day of a
recurring rule writes an exception rather than splitting the rule.

- [ ] `pages/assignments-page.ts`: month grid, prev/next, today
- [ ] Day agenda: add, edit, delete an assignment
- [ ] Rule editor: trip picker, tracker picker, weekday checkboxes, date range,
      time window
- [ ] Exceptions: skip this day, add just this day
- [ ] Conflict warning when two trackers hold one trip on one day
- [ ] Selecting a day drives the map, showing that day's assigned trips
- [ ] Trip page shows its assignments and can add one in place

**Gotchas.** The trip picker must handle a feed with tens of thousands of trips;
use the fuzzy search that is already vendored rather than a `<select>`. "This
day only" versus "all future days" is the classic recurrence-editing trap: only
offer what the model can express, which is an exception or an edit to the rule.
Assignments for a trip the loaded GTFS does not contain must still render, since
the feed can be reloaded out from under a rule.

---

## Phase 10: deploy and cutover

- [ ] CI in yard-master: typecheck, build, image, matching test-track's pipeline
- [ ] deploy-gtfs-rt / music-student: the nginx deployment, the Traefik router
      for `manage.rt.gtfs.zone`, and the `/api` path rule to cafe-car, both
      behind the same oauth2-proxy middleware
- [ ] Deploy alongside the old admin on a temporary hostname; use it for real work
- [ ] Parity review against this list: feeds, trackers, provisioning, alerts,
      entities, members, invites, transfer, account
- [ ] Swap `manage.rt.gtfs.zone` to yard-master, old admin to a temporary host
- [ ] Let it hold for a week
- [ ] Delete SQLAdmin from cafe-car: `admin/views.py`, `admin/account_view.py`
      (keep `/account` as a Jinja page), the forked `templates/sqladmin/`,
      vendored htmx, the `sqladmin` dependency, and the three workaround rules
      in `CLAUDE.md` that only existed to appease it
- [ ] Update cafe-car's CLAUDE.md and README to describe the two-app split as it
      then is

**Gotchas.** `/account` must keep working through the swap; it is the only path
for linking and merging identities. Confirm the oauth2-proxy middleware is
attached to the `/api` route and not just the SPA route, or the API is exposed
unauthenticated the moment the router splits. Keep the old admin reachable until
the deletion commit, so a cutover problem is a DNS change and not a rollback.

---

## Not in scope

- Porting `/account` into the SPA. It stays server-rendered.
- A position history trail. Positions carry a 60s TTL, so a trail needs new
  storage; revisit after phase 7.
- `GtfsShape` in railroad-club. The browser parses `shapes.txt` from the zip, so
  nothing here needs it.
- RRULE recurrence and `.ics` export. The GTFS-shaped model cannot express
  "every other Tuesday"; add it only if someone actually asks.
