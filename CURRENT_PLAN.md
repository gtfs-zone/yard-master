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
| Tracker identity | A `uuid4` surrogate `Tracker.id`; the credential moves to `device_key` | The credential was doing double duty as the primary key, which is what forced two detail routes, two response models and `nickname` into a navigation key it was never designed to be |
| Tracker credential | Response and request bodies only, never a URL path or the hash | `device_key` is the Traccar provisioning secret, and a path is a log line in Traefik, oauth2-proxy, nginx and uvicorn |
| `/account` | Stays server-rendered in cafe-car | Rare, security-sensitive flow with an identity-merge confirmation. Porting it buys nothing and risks the takeover primitive |

### What already exists and is reused

- `cafe_car/admin/access.py::accessible_feed_ids` is the single definition of
  "may touch this feed". Every new endpoint scopes through it, unchanged.
- `cafe_car/admin/access.py::personal_feed_ids` is the owned-or-shared query
  with the admin bypass deliberately *not* applied, which is the question a feed
  switcher asks. `accessible_feed_ids` is now that plus the bypass, so the
  definition is still written once.
- `cafe_car/admin/auth.py::resolve_request_user_id` is the one answer to "who is
  calling" for a route SQLAdmin's `authenticate` never runs for, shared by
  `entity_router` and the API.
- `cafe_car/api/deps.py::OwnedFeed` is written and unused, waiting for phase 6's
  owner-only mutations.
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
| the selected feed and its API objects | phase 4 | Trackers, alerts, members, load status |
| `vehicles` | phases 7 and 8 | One `VehiclePosition` per tracker fix, keyed by tracker id |
| `alerts`, `tripUpdates` | phase 7 | Live payloads off the event stream |

Anything a phase wants to add goes on this object rather than into a parallel
store, and anything a vendored module reads keeps the name it reads it by.

### API surface

All paths are relative to `/api`, all responses JSON, all scoped through
`accessible_feed_ids`. Trackers are addressed by the phase 3 surrogate `id`,
which is not a secret; `device_key` appears in a response body and nowhere else.

`FeedOut` carries more than the Notes column implies, because the shell needs it
in phase 4: the owner's display name, `is_owner` (the fact) and `can_manage`
(the permission, which an admin also has), the three public GTFS-RT URLs from
`feed_urls.py`, and a nested `load` object mirroring `GtfsStaticFeed`. That
nested shape is deliberate: phase 7 pushes the same object down the SSE channel,
so a client applies an update without a second representation.

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
| GET/PATCH/DELETE | `/trackers/{id}` | by surrogate; the detail form carries `device_key` |
| GET | `/trackers/{id}/provisioning` | Traccar URL + QR payload, built from `device_key` |
| GET | `/feeds/{id}/tracker-positions` | private; maps tracker to current fix |
| GET/POST | `/trackers/{id}/rules` | assignment rules |
| GET/PATCH/DELETE | `/rules/{id}` | |
| POST/DELETE | `/rules/{id}/exceptions` | added/removed service dates |
| GET | `/feeds/{id}/assignments?from=&to=` | expanded per-day view for the calendar |
| GET/POST | `/feeds/{id}/alerts`, GET/PATCH/DELETE `/alerts/{id}` | |
| GET/POST/DELETE | `/alerts/{id}/entities` | informed entities |
| GET/POST/DELETE | `/feeds/{id}/members`, DELETE `/feeds/{id}/invites/{id}` | mutations owner-only; **reading is open to members** |

### Standing gotchas

- **Session expiry.** oauth2-proxy answers an expired session with a 302 to
  Keycloak, which `fetch` cannot usefully follow. The API client must detect a
  redirect or a non-JSON body and do `location.reload()`, not surface a parse
  error. This will be the first production bug if it is not built in phase 2.
- **CSRF.** The session is a cookie, so a cross-site form post would otherwise
  be authenticated. Every mutation carries `X-Yard-Master: 1` and the server
  rejects a mutation without it. A simple cross-site request cannot set a custom
  header, and a preflighted one is blocked by the absence of CORS.
- **The tracker credential.** After phase 3 it is `Tracker.device_key`, not
  `Tracker.id`. It may appear in a properties panel, a response body and a
  request body, never in a **URL path**, the hash, a log, a breadcrumb, or a
  GTFS-RT feed. The path matters as much as the hash: it is a log line in
  Traefik, oauth2-proxy, nginx and uvicorn alike. Losing that is what the re-key
  buys, so do not reintroduce it by hanging a route off the credential.
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
into this furniture, and discovering in phase 6 that the panel resizer or the
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
carries an explicit `type` param, matching the shape phase 4 assumes. The
LayerManager target kind stays `vehicle`, which is the map layer's own
vocabulary and unrelated to the page variant.

**`feed-session.ts` had to land here rather than in phase 4.** `render-utils`,
`search-entries`, `alerts` and `rt-index` all `import type { FeedSession }`, so
there is no way to vendor them and keep `pnpm typecheck` green without one. The
phase 1 version owns the static half only: it downloads and parses the zip with
progress and cancel, and exposes the `staticFeed` / `vehicles` / `alerts` /
`tripUpdates` shape those four modules read. It is yard-master's own file, carried as the
one `adopted` row so the seam is inventoried rather than invisible, and its
surface is written down as the `FeedSession` contract above. Phase 4 adds the
API objects and the feed switcher; phases 7 and 8 fill the live maps.

**Two dependency notes.** `gtfs-realtime-bindings` is a real dependency of this
repo now, pulled in by `gtfs-rt.ts`; yard-master never polls a `.pb`, but the
`VehiclePosition` / `TripUpdate` / `AlertRecord` types are what the vendored
panel and map modules are written against. `@types/geojson` is an explicit
devDependency: test-track gets the `GeoJSON` namespace transitively through
maplibre's dependency graph, and on a fresh install that resolved differently
here, so `layer-manager` would not compile without it.

**The search priorities were rebucketed now rather than in phase 5b**, since
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

**A tracker needed a second detail route, addressed by nickname.** Keeping
`Tracker.id` out of every list response and addressing trackers by `id` are not
compatible: a client that only ever sees nicknames can never reach
`/trackers/{id}`. So the phase shipped
**`GET /feeds/{id}/trackers/{nickname}`** for the panel to navigate through,
with `/trackers/{id}` kept as the resource path for a caller that already holds
the credential. Nickname is not unique in the schema, so that route resolves a
collision to the lowest id, which is deterministic rather than correct.

**That was the symptom, and phase 3 removes the cause.** The forced choice, the
two response models, the lowest-id tiebreak and the credential sitting in a
logged URL path all follow from `Tracker.id` being the primary key *and* the
Traccar credential at the same time. Rather than pay a uniqueness check on the
write path to prop up nickname-as-key, phase 3 gives the table a non-secret
surrogate `id`, moves the credential to `device_key`, deletes the nickname route
and demotes nickname to a display label. Everything below this line describes
the API as phase 2 left it; phase 3 is where the tracker half of it changes.

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
the whole `/api` router, so every mutation phase 6 adds inherits it without a
route having to remember. Nothing under `/api` mutates yet, so its test drives
the dependency directly.

**The session-expiry contract is the API's half of a frontend promise.** There
is nothing to build server-side: oauth2-proxy answers an expired session before
a request reaches this app. What phase 2 owes is that every answer the API
*does* build is JSON including its errors, which is what makes "not JSON" an
unambiguous reload signal for the client in phase 4.

**Ruff's TC0xx rules are off under `api/`.** FastAPI resolves annotations at
runtime to build dependencies and response models, so moving a type into a
`TYPE_CHECKING` block turns it into a `NameError` at import.

**`FeedOut` carries more than the plan's table implies**, because the shell
needs it in phase 4: the owner's display name, an `is_owner` flag matching what
`owned_feed` would actually permit, the three public GTFS-RT URLs from
`feed_urls.py`, and a nested `load` object mirroring `GtfsStaticFeed`. That
nested shape is deliberate: phase 7 pushes the same object down the SSE
channel, so a client applies an update without a second representation.

That one `is_owner` flag is the one thing here phase 3 revisits. It is
`owner_id == user_id or is_admin()`, so an admin sees `True` on every feed, next
to an `owner_name` that names someone else. It matches what `owned_feed`
permits, but it conflates a fact with a permission, and the people page and the
Transfer button need to tell them apart. Phase 3 splits it into `is_owner` and
`can_manage` while there are still no consumers.

**Reading the member list is not owner-only**, though the API table says the
`/members` row is. It matches the SQLAdmin panel this replaces: a member needs
to know who else is on a feed. The *mutations* are owner-only and phase 6 adds
them behind the `OwnedFeed` dependency, which is written and unused for now.

---

## Phase 3: tracker identity and the recurrence model

The one remaining schema change, done once. It merges what was phase 8 with a
fix to something phase 2 exposed, because the two are the same work: one
railroad-club model change, one Alembic revision, one `resolve_tracker_trip`
rewrite, one cafe-car dependency bump, one coordinated vehicle-poser deploy.

### Why the tracker re-key belongs here

`Tracker.id` does two jobs at once: it is the table's primary key *and* the
Traccar provisioning credential. Every awkward thing phase 2 ran into follows
from that single fact. Two detail routes for one object, because a list that
must not leak the credential cannot hand the client an address. Two response
models. `nickname` promoted to a navigation key it was never designed to be,
with no uniqueness constraint behind it, load-bearing in the URL hash, the map
feature key, the API detail route and the public GTFS-RT vehicle label. A
collision resolved to "lowest id", which is deterministic rather than correct.
And `/api/trackers/{id}`, which puts the credential in a URL path that every
proxy in the chain logs, against this repo's own standing rule.

Giving the table a non-secret primary key dissolves all five at once, so it is
worth doing before any UI addresses a tracker. The full re-key rather than a
second added id: there are no active users, downtime costs nothing, and a table
carrying two identities forever is a worse outcome than one migration now.

### The audit, done before writing this

Nothing in `vehicle-poser` or `trip-updogger` names `TrackerRule`. The only
reader in the fleet is `railroad_club/trip_resolver.py::resolve_tracker_trip`,
and its only caller is `vehicle_poser/main.py::_resolve_trip`, once per Traccar
`/forward` POST. `trip-updogger` never sees a rule: it consumes the redis
`vehicle:*` record vehicle-poser wrote and takes `trip_id` as given.
`schedule-foamer` and `hell-gate-bridge` have no references. Writers are
`cafe_car/admin/views.py::TrackerRuleAdmin` (the view this repo replaces),
`cafe-car/scripts/provision_source.py`, and two cafe-car tests.

The credential's blast radius is just as narrow, and narrower than it looks:

- **Traccar is the only system that speaks it.** `vehicle_poser/main.py:72`
  reads `device.uniqueId` off the forward payload and already does a DB lookup
  per POST, so the credential can be translated to the surrogate once, at that
  one edge, and everything downstream speaks the surrogate.
- **hell-gate-bridge does not touch Redis.** It POSTs to cafe-car's `/ingest/*`
  with `tracker_id` in the body, and those endpoints are already authenticated
  by a separate shared token (`routers/ingest.py::_check_auth`). It holds the
  credential in config (`sources/base.py:56`) for no security reason at all, so
  the re-key removes a secret from that repo rather than moving one.
- **The Redis keyspace is keyed by the credential today.** `vehicle:{id}:*` is
  written by `vehicle_poser/main.py:93` and `cafe_car/routers/ingest.py:193`,
  and read by `routers/gtfs_rt.py:78,197`, `routers/catalog.py:83` and
  `trip_updogger/main.py:192`. Records carry a 60s TTL, so the cutover is a
  flush and a minute of waiting.
- **trip-updogger needs no change.** It scans `vehicle:*` and copies
  `tracker_id` through as an opaque string.

But the audit also turned up two things that widen the recurrence change itself:

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

### The decisions, written down once

**A tracker's identity is not its credential.** `Tracker.id` becomes a
`uuid4().hex` surrogate and the credential moves to `device_key`, unique and
indexed. `generate_tracker_id()` keeps its petname format and becomes the
`device_key` generator: a three-word petname is genuinely nicer than a random
token when someone types it into the Traccar client by hand because the QR flow
failed. After this, the credential lives in exactly two places, its own column
and the Traccar server, and `nickname` is a display label rather than a key.

**A rule's service date is the date its window *starts* in feed-local time, and
that date is the trip's GTFS-RT `start_date`.** A rule whose window crosses
midnight keeps the earlier date for its whole run. Weekday columns and
`start_date`/`end_date` are therefore tested against the service date, never
against the wall-clock date of the fix. Every consumer agrees on this.

### The model

```
Tracker      ! id: str  petname credential, PK  ->  uuid4 hex surrogate, PK
             + device_key: str  unique, indexed, petname, the Traccar uniqueId
             + UniqueConstraint(feed_id, nickname)
TrackerRule  ! tracker_id  FK repoints to the new id
             + start_date: date, + end_date: date | None
             ! start_time, end_time: time -> int (seconds since service midnight)
TrackerRuleException   id, rule_id, date, exception_type (added | removed)
```

The `(feed_id, nickname)` constraint is free in the same migration. Nickname is
no longer an identity key, but it is still the public GTFS-RT vehicle label, and
unambiguous labels are worth having.

- [x] railroad-club model changes and the **single** Alembic revision: the
      tracker re-key, the rule dates, the
      `time` -> seconds-since-service-midnight conversion (GTFS-shaped, matching
      `trip_updogger/trip_math.py::parse_gtfs_time`), and the exception table
- [x] Backfill in the same revision: each tracker gets a fresh uuid `id` with
      its old id copied into `device_key`; existing rules get a start of today
      and an open-ended end, so nothing silently stops running; existing times
      convert as `h*3600+m*60+s`
- [x] Rewrite `resolve_tracker_trip` to look the tracker up by `device_key` and
      return `(tracker_id, trip_id, service_date)`: evaluate today's and
      yesterday's service dates, apply weekday columns, the date range, and
      exceptions, last-created rule still wins
- [x] `vehicle-poser` translates at the edge: `device.uniqueId` to the resolver,
      surrogate and service date back, `vehicle:{surrogate}:{slug}` as the key,
      `start_date` (YYYYMMDD) in the record
- [x] `cafe-car` ingest: the `tracker_id` body field carries the surrogate, so
      `_vehicle_key` keys by it. The alerts path's `session.get(Tracker, ...)`
      stays a PK get and is correct unchanged
- [x] `cafe-car` Traccar call sites take `tracker.device_key`: `traccar.py`,
      `admin/views.py:379`, `admin/entity_router.py:193`
- [x] Update `TrackerRuleAdmin` and `scripts/provision_source.py` in the same
      change, or they write rows with null dates
- [x] `hell-gate-bridge`: config and publisher speak the surrogate, and the
      comments calling it a secret come out
- [x] API: `/trackers/{id}` becomes the one detail route, addressed by the
      surrogate. Delete `/feeds/{id}/trackers/{nickname}`; it was the workaround.
      `TrackerOut` gains `id` and is safe to log; `TrackerDetailOut` carries
      `device_key` and is returned only by the detail and provisioning routes
- [x] Split `FeedOut.is_owner` into `is_owner` (the fact) and `can_manage` (the
      permission), in `api/schemas.py` and `api/feeds.py::_feed_out`
- [x] Bump the railroad-club dependency in cafe-car, vehicle-poser and
      hell-gate-bridge; run `railroad-club-migrate`; flush `vehicle:*`
- [x] pytest: phase 2's scoping tests still pass against the new addressing, and
      `device_key` is absent from every list response
- [x] `GET /api/feeds/{id}/assignments?from=&to=` expanding rules over a range,
      exceptions applied, in feed-local time
- [x] Update this repo's `CLAUDE.md`: the tracker rule still says to address
      trackers by nickname and to keep `Tracker.id` out of navigation state, and
      the vehicle-layer rule still keys `FeedSession.vehicles` by nickname. Both
      become wrong the moment the migration lands

**Gotchas.** **The surrogate keeps the attribute name `id`, so grepping for
`Tracker.id` is not a sufficient audit.** Every existing reference still
compiles and silently changes meaning. Most of them want the surrogate and are
correct untouched, which is exactly what makes the few that want the credential
dangerous. Classify each site rather than pattern-matching it. Must become
`device_key`: `trip_resolver.py`'s lookup, `admin/views.py:379`
(`unique_id=model.id`), `admin/entity_router.py:193` (`build_config_url`), and
`api/trackers.py`'s detail serializer. Must stay `id`: `gtfs_rt.py:78,197`,
`catalog.py:131`, `ingest.py:293`, and every FK join.

Ship the railroad-club, vehicle-poser and hell-gate-bridge changes together: an
old vehicle-poser against the new resolver signature is a TypeError on every
position POST, and an old hell-gate-bridge posts a credential into a field that
now expects a surrogate. The old admin is the only admin until phase 10, so its
tracker, tracker-rule and provisioning panels have to survive the re-key.

Expansion is feed-local, from `GtfsStaticFeed.timezone`. A rule with no
`end_date` is open-ended, not expired. `resolve_tracker_trip` returns `None`
when the feed has no loaded `GtfsStaticFeed` or no timezone; keep that, it is
the only safe answer. The two-service-day evaluation can match a rule on both
days at once for a >24h window, so order by service date before rule id.

### What the pass turned up

**A tracker with a fix but no rule had to stop being an error.** The plan's own
gotcha said `resolve_tracker_trip` returns `None` when the feed has no timezone,
and that is still right about the *trip*. But once vehicle-poser keys its Redis
record by the surrogate, "no answer" means it cannot write a record at all, and
an unassigned tracker vanishes off the map that phase 8 is meant to draw it on.
So the resolver returns `None` only for a device key with no tracker behind it;
a tracker that exists but has no active rule comes back with `trip_id` and
`service_date` both `None`. That keeps the "never guess a trip" property exactly
and makes the unmatched-colour case reachable.

**The re-key removed a credential from a URL rather than moving one.** The admin
provisioning partial is `/tracker/{id}/provisioning-partial`, and that path now
carries the surrogate. The credential is in the rendered body, which is the
distinction the whole change is about.

**`start_time > end_time` rows are left dead on purpose.** The backfill converts
literally, `h*3600+m*60+s`. A rule that already had a start after its end matched
on no day at all, so converting it as written keeps it dead; adding 86400 would
silently start running an overnight trip nobody has run since it was entered.
That is a decision for whoever edits the rule in the phase 9 calendar, not for a
migration.

**The migration was round-tripped against a real Postgres 16**, up and back down
with a midnight-crossing rule and two trackers in the table, and `alembic
revision --autogenerate` against the upgraded schema reports no column or
constraint drift. `tracker_rule.tracker_id` gained `index=True` on the model to
match the index the original migration had already created by hand.

**Two API endpoints came out of the assignments work, not one.**
`/feeds/{id}/assignments` is the expansion the calendar reads;
`/feeds/{id}/rules` is the stored rules with their exceptions, which is what an
editor needs and which the expansion deliberately does not preserve. Expansion
itself is `railroad_club.trip_resolver.expand_rules`, a pure function sharing
`rule_applies_on` with the resolver, so the calendar and the vehicle pipeline
cannot disagree about which day a rule runs.

**Still to do, and blocked on a push.** The three dependency bumps
(`cafe-car`, `vehicle-poser`, `hell-gate-bridge` pin railroad-club by commit),
`railroad-club-migrate` against the real database, and the `vehicle:*` flush all
need the railroad-club commits pushed first. Everything was verified locally
against an editable install instead. Ship the three services together: an old
vehicle-poser against the new resolver signature unpacks a `NamedTuple` where it
expected a string.

**Pushing railroad-club is allowed.** The commits do not need to wait for a
separate approval: push them, then bump the three pins and re-run the bumped
repos' suites against the pinned commit rather than an editable install.

---

## Phase 4: the shell, the feed switcher, and hash state

The app becomes navigable. A feed switcher modal lists your feeds from
`GET /api/feeds`, selecting one downloads and parses its zip in the browser with
a progress bar, and the hash carries both the feed and the focused object so any
page is linkable.

Hash shape: `#feed=<feed_name>&type=tracker&tracker=<id>`. Settled in
phase 1: the codec already carries the explicit `type` param, because `feed`,
`assignments` and `people` name no object and cannot be told apart by the
presence of an object key. The feed is named by `feed_name`, not by id, so a
link stays readable. Trackers are named by the phase 3 surrogate `id`, which is
not a secret and is genuinely unique; `device_key` never enters the hash, and
neither does nickname, which is a label and may repeat.

- [x] `api-client.ts`: typed `get`/`post`/`patch`/`del`, the CSRF header on
      every mutation, and the redirect/non-JSON detection that triggers a reload
- [x] `feed-switcher.ts`: your feeds, a New feed form (name + static URL), and
      an admin-only "show all feeds" toggle, off by default
- [x] Extend `feed-session.ts` with the selected feed and its API objects; the
      static half and the change-event dispatch landed in phase 1. Follow the
      `FeedSession` contract above rather than adding a parallel store
- [x] `app-state.ts` + `page-state-manager` wiring, breadcrumbs, hash sync
- [x] Selecting a feed loads the zip through `feed-download` with progress and
      cancel; the managed half of the tree is usable before it finishes
- [x] `POST /api/feeds` and `POST /api/feeds/{id}/reload` in cafe-car
- [x] Map renders the feed's stops and routes; the panel is phase 5a's, pointed
      at a real feed instead of the hardcoded URL
- [x] Re-key the `tracker` PageState from nickname to `Tracker.id`. Phase 3
      changed the model and this repo's `CLAUDE.md`, but `page-state.ts`,
      `page-state-manager.ts`, `map-controller.ts` and `search-entries.ts` were
      still addressing a tracker by a label that may repeat

**Gotchas.** Only `PageStateManager` may write the hash, which is what keeps its
`suppressHashUpdate` guard honest. Deleting `CONFIG.DEV_FEED_URL` is part of
this phase, not a later cleanup: two ways to choose a feed is one too many. A newly created feed has no
`gtfs_static_feed` row at all, so every status reader must handle null rather
than assuming `pending`. A feed whose `static_feed_url` is unreachable must
leave the managed half of the app fully usable.

### What the pass turned up

**`adoptState` had to gain a companion, because the hash is written in two
halves.** Selecting a feed writes `feed=<feed_name>` through `setFeedParams`,
which happens *before* a focus restored from a link has been adopted, and
`adoptState` is deliberately silent. The link's own `type=` and object params
were therefore erased from the address bar between boot and the first
navigation. `PageStateManager.syncHash()` is the fix: still the only module
that touches the hash, now with a way to say "write what I already hold".

**A pending focus is a state machine, not a decision.** test-track awaits its
load and so can rule on a linked focus once. Here the managed half arrives
before the zip and may never be joined by it, so `route`, `stop` and `trip`
links cannot be judged at the same moment `tracker` and `people` links can.
`applyPendingFocus` therefore runs three times - on selection, after the
tracker list, and on `staticloaded` - and only the last is allowed to call a
link dead. The same asymmetry pushed `validateState` to answer *true* for a
managed object while its list is still empty: an empty map is "not fetched yet"
as often as it is "no such object".

**An empty 202 is indistinguishable from a login page by content type alone.**
`POST /feeds/{id}/reload` answers 202 with no body, so it carries no
`Content-Type` either - and "not JSON" is exactly the signal the client uses to
detect an expired oauth2-proxy session and reload the page. The reload button
would have reloaded the browser on every successful click. The no-body case is
now checked first, narrowed to 202/204/`Content-Length: 0`, none of which
anything in the auth chain serves.

**`CONFIG.DEV_FEED_URL` never existed.** Phase 1 stood the shell up without a
hardcoded feed, so there was nothing to delete; the gotcha was written against
a phase 1 that was later revised. The map's only feed is the selected one.

**The reload button is two reloads and says so.** `POST /feeds/{id}/reload`
queues schedule-foamer for the *pipeline's* copy of the schedule; the browser's
own copy is a separate download this app does itself. Doing only the first
would leave the map showing the old feed with no indication why, so the button
does both and the feed row is re-read in between.

**`request_feed_load` collapsed three copies of the celery dispatch into one.**
The admin's create hook, the admin's reload route and both new API routes all
name the same task; the helper also fixes the two of them that swallowed a
broker failure in slightly different ways.

**Still to do, and unblocked by the same push as phase 3** (which is now
allowed, see above). cafe-car's venv pins
railroad-club by commit, so its test suite could not import `TrackerRuleException`
until railroad-club was installed editable into it. All 172 cafe-car tests pass
that way. `pnpm vendor:check` reports `feed-download.ts` and `gtfs-static.ts` one
commit behind test-track (`fa12a57`, a downloader progress change): unrelated to
this phase, and a re-vendor rather than a fix.

---

## Phase 5a: the browse tree and the GTFS pages

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

- [x] `panel-renderer.ts` dispatcher plus shared furniture (breadcrumbs, headers)
- [x] ~~`CONFIG.DEV_FEED_URL`: one hardcoded feed, loaded on boot, deleted in
      phase 4~~ Dropped: phase 4 found it never existed, and the pages run
      against the selected feed
- [x] `pages/route-page.ts`, `pages/stop-page.ts`, `pages/trip-page.ts` from the
      in-browser GTFS
- [x] Tree navigation over the GTFS half: section headers, counts, click to focus
- [x] Map and panel stay in sync: focusing an object moves the camera, clicking
      the map focuses the object
- [x] Search box via `search-entries`, GTFS entries only

**Gotchas.** The panel re-renders on every live event, so nothing may hold state
in the DOM that is not also in the model. Escape everything: `trip_id`,
`stop_name` and `route_long_name` are all free text from a stranger's zip.
`map-controller` currently treats `trip` as a variant that clears focus without
moving the camera; rendering a trip's shape is this phase's job and the
`@changes` list has to be updated when it changes.

### What the pass turned up

**The route strip is nine files, not one.** `route-page.ts` reaches through
`route-strip` -> `route-graph` -> `route-sequence` -> `scs`, and those read a
`RouteSource` rather than `GTFSStatic` directly, which pulls in `route-source`,
`gtfs-static-route-source` and the `gtfs-flex` types behind `StopTimeRef`. All
seven came across verbatim and the whole chain compiles against yard-master's
`FeedSession` unchanged, which is the clearest evidence so far that the phase 1
decision to shape `feed-session.ts` like test-track's was the right one.

**`modal-utils.ts` is not the superset VENDORED.md claimed.** coloring-book's
copy is bigger than test-track's on every other icon, but it has no
`renderWarningIcon`, and the alert pips on the route and stop pages need it. The
row moved from `verbatim` to `modified` with the icon appended from test-track,
rather than re-pointing the whole file at test-track and losing `renderPencilIcon`
and friends. Worth knowing before phase 5b reaches for another icon.

**`home` became a page, which the bottom sheet had not planned for.** test-track
closes the sheet when nothing is focused, because nothing is focused means
nothing to show. Here home is the browse tree, and a closed sheet hides its own
drag handle, so closing it on a phone strands the reader with no way back to the
only route into an object that has no map feature to tap. The sheet now follows
feed selection rather than focus: open whenever a feed is selected, closed only
when none is. The pre-existing trap is still there, and is not this phase's:
dragging the sheet to `closed` by hand hides the handle the same way.

**The panel re-renders itself, so the trail needed its own entry point.**
`PanelRenderer` listens to the session and re-renders without resetting scroll,
but the breadcrumb trail is built by `AppState`, outside it. Calling `show()` on
every session change would have thrown the reader back to the top of a 60-stop
strip every time a tracker moved. `setBreadcrumbs()` is the fix: replace the
trail, keep the page and the scroll offset.

**`trip` focus is drawn by `map-controller`, not `LayerManager`.** There is no
`trip` focus kind, and adding one would edit a `verbatim` file that the whole
map rests on. The trip's path instead goes on a source `map-controller` owns,
under the stop layers and over the route lines, while the parent route keeps the
ordinary route spotlight. Two consequences worth remembering: the source has to
be re-added on `basemap:changed` like `LayerManager.rebuild()`, because
`setStyle` drops it too, and its line color has to be re-resolved in
`refreshAccentColor` after `LayerManager` has cleared the theme-color cache.

**A trip without `shapes.txt` still draws.** The fallback is the straight line
through its stops in `stop_sequence` order, which is an approximation and is
labelled as one on the page rather than passed off as geometry the feed
supplied.

**Trip times are never round-tripped through a `Date`.** The trip page renders
`arrival_time` / `departure_time` straight from the `stop_times` string, and the
route page's trip list sorts on that string, which works precisely because GTFS
times are zero-padded. An overnight trip's 25:10:00 is a real value and a `Date`
would quietly rewrite it as 01:10 on the wrong day.

**Both long lists are capped, and both say so.** `ROUTE_TRIP_LIST_MAX` and
`TREE_LIST_MAX` are 200. A busy route has thousands of trips and a regional feed
has tens of thousands of stops; the panel is not a paging UI and the search box
already is one. The tree lists only stops with no `parent_station`, so a station's
platforms hang off its own page rather than burying the places under their parts.

**Still open.** `pnpm vendor:check` still reports `feed-download.ts` and
`gtfs-static.ts` one commit behind test-track, unchanged from phase 4 and still
a re-vendor rather than a fix. Every new row this phase added resolves clean at
`fa12a57`.

---

## Phase 5b: the managed pages

The other half of the panel, once phase 4 has a feed and an API to read.

- [x] `pages/feed-page.ts`: properties, load status, counts, deep links to viz
      and the editor
- [x] `pages/tracker-page.ts`, `pages/alert-page.ts`, `pages/people-page.ts`
- [x] The managed/GTFS divider in the tree, managed objects above it
- [x] Search covers both halves, managed objects bucketed ahead of GTFS objects
      by `priority` (already rebucketed in `search-entries` in phase 1)

**Gotchas.** Escape everything here too, and for a sharper reason: `nickname`
and `header_text` are typed by a person with write access to the feed, and the
old admin has a rule about this because it was a real stored-XSS vector.
`Tracker.id` renders on the tracker page and nowhere else, never in a
breadcrumb, a title or a link.

### What the pass turned up

**A published alert's entity id is not its row id.** cafe-car numbers the
entities in the GTFS-RT alert feed positionally — `entity.id = str(i)` over the
alerts active at that moment — so an `AlertRecord.id` and an `Alert.id` are two
id spaces that both look like small integers. The `alert` PageState is the
managed row (`String(Alert.id)`), which is what `page-state.ts` said it was from
phase 1, and `alert-page.ts` renders that, keeping test-track's decoded-entity
page underneath as the fallback for an id only the live payload knows. Nothing
fills `session.alerts` yet, so nothing is wrong today: whatever fills it in
phase 7 has to key it by the managed id, or the alert links the route and stop
pages emit will open the wrong alert. Written into the file's header, not just
here.

**`session.alerts` could not be the managed list.** Four vendored modules read
`alerts` as a map of decoded `AlertRecord`s — `alerts.ts`, `rt-index.ts` and the
route and stop pages — so the managed rows went next to it as `serviceAlerts`
rather than into it. The `FeedSession` contract holds: a name a vendored module
reads keeps the meaning that module expects, and yard-master's own objects get
their own names.

**Only the detail endpoints carry the halves that matter.** `GET /feeds/{id}/
alerts` returns `entity_count` and no entities, and `GET /feeds/{id}/trackers`
returns no `device_key`, both deliberately. Pages are synchronous string
renderers re-run on every session event, so they cannot fetch; `AppState`
grew `loadPageData`, which runs on every focus change, asks for exactly what the
opened page is missing, and writes it into the session. The in-flight set that
guards it is not optional: a focus is announced more than once while a feed is
being adopted, and the panel re-renders on the `change` each response causes.

**The tree's counts forced the lists to be eager.** Trackers, alerts and people
are all fetched in parallel the moment a feed is selected, rather than by the
page that shows them. A count that appears one page visit later is worse than
three small requests, and each is reported by name on failure, so a member who
may read a feed but not its people still gets their trackers.

**The credential lives behind a `<details>`.** `device_key` is fetched only when
its tracker's page opens and is shown only inside a closed disclosure, which
means opening a tracker in front of somebody does not hand them the credential.
`<details>` rather than a toggle button because `PanelRenderer` restores open
disclosures by key across a re-render and a hand-rolled toggle would snap shut
on the next tracker update. The key is per-tracker, so opening one does not open
the next one navigated to. A detail is also dropped when its tracker leaves the
list, so a deleted tracker's credential does not linger in memory.

**The viz and editor links are built from the feed's own URLs.** test-track
reads `static` / `rt_vp` / `rt_tu` / `rt_al` out of its hash and coloring-book
takes a `load=<url>` command, so both deep links are shareable to somebody who
has never opened this app. The realtime three resolve against `RT_BASE` first,
because they are stored as bare paths; the static URL is passed exactly as its
author typed it.

**The feed page reports the two schedules separately.** `Feed.load` is what
cafe-car last made of the zip and is what the published feed is built from; the
counts under it are what this browser parsed a minute ago. They can legitimately
disagree — a failed load leaves the server on an older schedule than the map is
drawing — and that disagreement is the most useful thing the page can show, so
the two are never merged into one status.

**`loadStatusBadge` had already been written twice.** The feed switcher's badge
and the feed page's are the same three-way distinction, including the rule that
a null `load` is "never loaded" and emphatically not "pending", so it moved into
`managed-render.ts` and the switcher now imports it.

---

## Phase 6: writes

Every properties page gets an explicit Save. Field-level validation errors come
back from the API and render next to the field that caused them, which is the
main thing the old admin does well and must not be lost.

- [x] `POST`/`PATCH`/`DELETE` for feeds, trackers, alerts, informed entities
- [x] Members and invites: add, remove, and the owner-only checks
- [x] `POST /api/feeds/{id}/transfer`
- [x] Traccar provisioning rehomed: QR and deep link in the tracker panel
- [x] A shared form renderer: dirty tracking, Save/Revert, disabled while in
      flight, field errors from a 422
- [x] Destructive actions behind a typed confirmation
- [x] pytest for every write path, including the scoping tests from phase 2
      repeated against the mutating verbs
- [x] Bulk tracker create (a prefix and a count), respecting the
      `(feed_id, nickname)` constraint phase 3 added

**Gotchas.** Deleting a tracker should also retire its Traccar device, matched
on `device_key`; confirm what the current code does before copying it.
`feed_name` is unique and is in the hash, so renaming a feed has to rewrite the
hash rather than leave a link pointing at a name that no longer exists.
Renaming a *tracker* does not, which is a property phase 3 bought: the hash
holds the surrogate, so a nickname is free to change under a live link. A
rename can still collide with the `(feed_id, nickname)` constraint, so it needs
the same field-level 422 handling as any other validated write. Invites match on **verified** email
only; that rule is an account-takeover boundary and moves across untouched.

### What the pass turned up

**A form cannot live in the panel.** A properties page is a synchronous string
renderer re-run on every session event, so an `<input>` rendered into it loses
what was typed the moment a tracker updates or a list request lands. Every form
is therefore a modal — `entity-form.ts`, built on the vendored `showModal` —
which owns its own DOM and outlives every re-render underneath it. Save/Revert,
the in-flight disable and the field errors all belong to that one file, and the
pages stayed pure string renderers, which is what phase 5 bought and what phase
7's live pushes would otherwise have broken. Inline editing would have needed a
re-render-suppression mechanism `PanelRenderer` does not have.

**`showModal` already had the in-flight behaviour.** Its `triggerAction`
disables every button for the duration of the action's promise and re-enables
them if the action returns `true`, which is exactly what a save wants: open
with what was typed still in it on a validation error, closed on success. What
it does not know about is the dirty state, so an action that keeps the modal
open leaves Save enabled on a form nobody touched; the fix is a `setTimeout`
re-sync, because the re-enable happens in the continuation of an `await` and
anything queued as a microtask would run before it.

**A 422 names its field and a 409 does not.** FastAPI's 422 `detail` is a list
whose `loc` ends in the field, so `ApiError.fields` maps them and the form puts
each message under the input that caused it — the one thing SQLAdmin did well.
A 409 is a conflict about the whole request, and only the caller knows which
field to blame, so `conflictField` is how "that feed name is taken" ends up
under `feed_name` rather than in a banner.

**`datetime-local` has no timezone, and the server stamps UTC on a naive one.**
An alert's active period would have been read as UTC wherever the browser
actually is. `toLocalInput`/`fromLocalInput` convert both ways, so what leaves
the form is an absolute instant with its offset. The editor deliberately works
in the *reader's* zone while the panel displays these instants in the *feed's*:
a bare `datetime-local` cannot honestly claim any other zone, and the field
says which one it means.

**Deleting a feed is a manual cascade.** `Feed.members` and `Feed.invites`
cascade in the model; trackers, rules, alerts and entities do not, so a delete
that did not clear them would have raised a foreign-key error rather than doing
anything. `DELETE /feeds/{id}` clears them in one transaction, and the same
shape appears twice more: deleting a tracker takes its rules, deleting an alert
takes its entities.

**The Traccar device is retired now, which the old admin never did.** It only
ever created devices, so every deleted tracker left a device answering for a
credential that mapped to nothing. `delete_device` was added to the client and
`provision_device`/`retire_device` wrap both halves best-effort: the row is
already committed (or already gone), and a Traccar outage must not turn a
successful write into a 500. Deleting a feed retires its whole fleet the same
way, after the commit.

**The alert enumerations existed twice.** `routers/ingest.py` had the GTFS-RT
cause/effect/severity `Literal`s and `admin/views.py` had them again as wtforms
choices. A value one writer rejects has to be a value the other rejects, or the
same feed publishes fields only half of it believes in, so they moved to
`alert_enums.py` and ingest imports them. The frontend mirrors the names in
`managed-render.ts`, which is the fourth copy and the only one that cannot be
imported.

**The create response is the detail form, deliberately.** Whoever just made a
tracker is about to provision it, so `POST /feeds/{id}/trackers` answers with
`device_key` and the frontend caches it straight into the session rather than
fetching the detail again a moment later. Bulk create answers with the summary
form instead: nobody provisions forty trackers in one go, and forty credentials
in one response is forty credentials in one place.

**Bulk create numbers past what exists.** `(feed_id, nickname)` is unique and
starting at 1 every time is the easiest way to collide with it, so the highest
existing `{prefix}{n}` is what the numbering continues from. Running the same
bulk create twice extends the fleet rather than failing.

**The buttons follow `can_manage`, not `is_owner`.** Editing a feed and
creating trackers or alerts are open to any member, matching the admin this
replaces; transferring, deleting and managing people are not. Showing a member
a button that answers 403 would be worse than not offering it, and `can_manage`
is the permission (an admin has it on somebody else's feed) rather than the
fact.

**cafe-car's lock was pinning a railroad-club from before phase 3.** The venv
had no `TrackerRuleException` and no `Tracker.device_key`, so the suite could
not import, let alone run. `uv lock --upgrade-package railroad-club` to
`489ee1c` is part of this commit; phase 3 changed the library and never moved
the pin.

---

## Phase 7: the SSE channel and live load status

`GET /api/feeds/{id}/events` streams events for one feed. First payload is the
current state, so a client never has to poll once to bootstrap. schedule-foamer
publishes to Redis; the endpoint subscribes and forwards.

If schedule-foamer only flips `pending -> running -> success/failed` today, ship
that and treat finer progress as a follow-up in that repo. The channel is worth
building either way, because tracker liveness rides on it in phase 8.

- [x] Redis pub/sub channel per feed, published by schedule-foamer on status change
- [x] `GET /api/feeds/{id}/events` SSE endpoint, current state first, heartbeat
      comment every 20s so no proxy idles the connection out
- [x] Client `event-stream.ts`: subscribe on feed select, reconnect with backoff,
      close on feed change
- [x] Load status card updates live; the Reload button reflects in-flight state
- [x] A failed load surfaces `error_message` and the `next_retry_at` countdown
- [x] Position events on the channel are GTFS-RT-shaped JSON, so they land in
      `FeedSession.vehicles` as `VehiclePosition`s with no translation layer
- [x] Measure the built bundle: `gtfs-rt.ts` imports `transit_realtime` and
      calls `FeedMessage.decode`, but yard-master never polls a `.pb` and the
      only runtime import from that module anywhere is `presentNumber`. If
      protobufjs survives tree-shaking, split a types-only module and drop the
      `gtfs-realtime-bindings` dependency

**Gotchas.** SSE through oauth2-proxy and Traefik needs response buffering off,
or events arrive in clumps at the end. The session can expire mid-stream: an
`onerror` that reconnects forever against a 302 is an infinite loop, so cap the
retries and fall back to a page reload. One connection per feed, and it must be
closed when the feed changes or a long session accumulates them.

### What the pass turned up

**The channel name is a three-repo contract, so it went into railroad-club.**
schedule-foamer publishes it, cafe-car subscribes to it and yard-master reads
what comes out; a constant duplicated across two of those is the alert-enum
problem from phase 6 again. `railroad_club/feed_events.py` holds the channel
name, the event-type names and `load_event`, and nothing else: it opens no
connection, because each repo already has its own client and its own settings.
It is a pure module with no Redis import, which is what lets a models-and-
migrations library carry it without growing a dependency.

**The endpoint cannot touch the database while it streams.**
`DBSessionMiddleware` is a `BaseHTTPMiddleware`, so its `async with` around the
request session exits when the route *returns* — which for a streaming response
is before a single body byte is produced. A query inside the generator would
run on a closed session. The load status is therefore read in the route and
handed to the generator as a value, and the generator afterwards only ever
talks to Redis. This is not a detail phase 8 may forget: resolving a position's
feed will be tempting to do inline.

**The forwarder does not parse what it forwards.** What comes off Redis is
written to the wire as-is. Every payload carries a `type`, so an event type
added later is a publisher change and a client change with no server change in
between, and a malformed publish cannot take a stream down. It also means the
one thing the framing depends on is that a payload has no literal newline in
it, which `json.dumps` guarantees.

**`ASGITransport` cannot test a stream at all.** It awaits the application to
completion before it builds a response, so an endless SSE body simply hangs it,
which is what the first version of `test_events.py` did for three minutes.
`tests/test_events.py` drives the app as a raw ASGI callable instead: it runs
it as a task, collects `http.response.body` messages as they are sent, and
cancels once it has the frames it asked for. That also exercises the disconnect
path, which is how the subscription-release test works.

**The browser already handles the failure that is not worth handling.**
`EventSource` reconnects a *dropped* stream by itself; what it will not retry
is a response that was not an event stream, which it closes for good. So
`onerror` ignores anything but a `CLOSED` source, and the capped backoff exists
for exactly one case: oauth2-proxy answering an expired session with a login
page. Four tries and then `window.location.reload()`, the same recovery
`api-client.ts` performs on a non-JSON response, and for the same reason.

**A load status arrives with the feed it belongs to.** A feed switch can land
between an event being published and being delivered, so `onLoad` is handed the
feed id and `AppState` drops anything that is not the current selection.
Applying the old feed's status to the new one is a lie with nothing to give it
away. For the same reason only the *transition* is announced, not the state:
the first frame of every stream carries the current status, which is almost
always what the row already had, so toasting on every frame would toast on
every connect.

**The countdown was already built.** `formatRelative` reads a future timestamp
as "in 4h 12m" and the panel's own one-second ticker refreshes every
`data-since` element, so `next_retry_at` needed `isoWithAge` rather than
`formatIso` and nothing else. `started_at` got the same treatment, which is why
a running load now shows its own elapsed time without the stream saying
anything.

**Positions are shaped here and published in phase 8.** `EVENT_POSITION` and
the `PositionEvent` type are settled — the payload is a camelCase GTFS-RT
vehicle, which is exactly `VehiclePosition`, so there is no translation layer
to write — but nothing publishes one yet. `ingest_position` knows a
`tracker_id` and not a `feed_id`, so publishing costs a lookup per fix, and
phase 8 owns that alongside the map wiring that consumes it. An unrecognised
event type is dropped by the client rather than reported, so the two halves can
land in either order.

**protobufjs did survive tree-shaking, and it was a quarter of the bundle.**
`FeedMessage.decode` was reachable from `gtfs-rt.ts`, so the whole generated
decoder shipped: 1,556kB to 1,362kB raw and 412kB to 380kB gzipped once it went,
25 modules fewer. The file is now `modified` rather than `verbatim` — the
poller and its status types are gone, the `transit_realtime` import is a *type*
import, and `gtfs-realtime-bindings` moved to `devDependencies`. `modified`
rather than `adopted` on purpose: the types still have to track test-track's,
so the staleness check is worth keeping.

**Before this lands anywhere: railroad-club has to be pushed first.**
`feed_events.py` is a new module in a git-pinned dependency, so cafe-car and
schedule-foamer both import something their locks do not have yet. Push
railroad-club, then `uv lock --upgrade-package railroad-club` in both. The
suites here were run with the local checkout on `PYTHONPATH`.

---

## Phase 8: trackers on the map

Answer "where is this thing right now" without leaving the app.

`GET /api/feeds/{id}/tracker-positions` reads the `vehicle:{tracker.id}:*`
keyspace, which phase 3 re-keyed to the surrogate, and returns positions keyed
by tracker. It is authenticated and scoped; the public `.pb` deliberately
*labels* vehicles by `nickname` and must stay that way, which is a display
concern and no longer an identity one.

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

- [x] The positions endpoint, scoped, with the 60s TTL meaning "present is fresh"
- [x] Tracker positions pushed on the phase 7 channel, into `FeedSession.vehicles`
- [x] Reword the unmatched issue-card row: here it means "unassigned", the normal
      state of an idle tracker, not test-track's "the feed is lying to you"
- [x] Liveness dot in the tracker list: reporting, last seen, never seen. A
      tracker with no fix has no coordinates and so is panel-only, listed and
      correctly absent from the map
- [x] Tracker page: current position, assigned trip, a Google Maps link, camera
      follow while focused
- [x] Feed page shows the whole fleet at once

**Gotchas.** `VehiclePosition.key` is the map feature id, the `vehicles` map key
and the click identity, so it must be the **surrogate `id`**, never `device_key`
and no longer the nickname, and `vehicleId` with it. Before phase 3 this had to
be the nickname, which was the trap: nicknames are not unique, so two trackers
sharing one silently collapsed to a single map feature. A tracker can still
report several concurrent vehicles, one Redis key per `trip_id[:start_date]`, so
`key` is the tracker id plus the trip discriminator, and
`issues.vehiclesDuplicateKeys` will flag it if that is got wrong. The panel must
show all of a tracker's vehicles rather than the first one the scan returns.
`nickname` remains what is *displayed* on the dot and in the public feed. Never
log a position payload with its `device_key`.

### What the pass turned up

**The bump from phase 7 landed first.** railroad-club is pushed,
`uv lock --upgrade-package railroad-club` ran in cafe-car and schedule-foamer,
and both lock bumps are committed. cafe-car's 243 tests pass against the locked
version rather than against a `PYTHONPATH` checkout. schedule-foamer has no
suite at all, so what was verified there is that `schedule_foamer.events`
imports and resolves `feed_channel` off the locked dependency.

**One function builds the payload, and that is the whole design.**
`cafe_car/vehicle_payload.py` owns the `vehicle:*` key derivation, the public
vehicle id, the keyspace walk and `vehicle_view`. The endpoint and the pushed
event both go through `vehicle_view`, so a client cannot tell which route a
vehicle arrived by, and `test_positions.py` asserts exactly that by comparing
the published payload against the endpoint's response. Two of those pieces
already existed in two places: `_public_vehicle_id` was private to `gtfs_rt.py`
and `_live_vehicle_keys` private to `catalog.py`, and both moved here.

**`key` could not be the tracker id, because `layer-manager.ts` had to stay
verbatim.** The layer is keyed by `VehiclePosition.key`, and a tracker running
several concurrent vehicles needs one key each, so `key` is the Redis key
without its prefix — tracker plus trip instance. That leaves nothing saying
*which tracker*, so `VehiclePosition` grew a `trackerId`, and every panel
lookup that was `vehicles.get(tracker.id)` became `session.vehiclesFor(id)`.
Focus and follow moved with it: `MapController` keeps the last positions array
so a `tracker` focus can resolve the tracker's newest fix, and `following`
holds a tracker id rather than a vehicle key, so a tracker whose trip instance
ends is still followed onto the next one.

**Nothing tells a client a vehicle went away.** A record expires out of Redis
after 60s and an expiry is not an event, so a vehicle that is only ever added
sits on the map forever, in its last known place, looking exactly like one that
is still moving. `FeedSession.pruneVehicles` is what makes presence mean the
same thing in the browser as on the server, swept every
`CONFIG.TRACKER_PRUNE_MS` by `AppState` — which is the one module that knows a
feed is selected *and* can hold a timer. It counts from when a fix *arrived*,
not from the timestamp inside it: that is the producer's clock, and a phone
with a skewed one would otherwise be immortal or invisible.

**Liveness has three states and they are not symmetrical.** The server can only
answer "reporting" or "not reporting"; there is no last-seen column anywhere,
because an expired fix is simply gone. So "went quiet" is something only the
open session knows — a tracker this browser watched report and then stop — and
a tracker that went quiet before the app was opened is indistinguishable from
one that has never reported. Both are "no fix", worded as a statement about
right now rather than a claim about the past. `trackerLiveness` and
`livenessBadge` live in `managed-render.ts` so the tree, the tracker page and
the feed page's fleet counts cannot disagree.

**The panel needed a third session event.** A fix per tracker per poll is a
lot of `change` events, and `change` is what every managed list and every
detail fetch already fires. `vehicles` is separate: the map listens to it
alone, and `panel-renderer.ts` listens to all three. `renderIssueCard` needed
no change at all — every label and note is the caller's, so the feed page
rewords the unmatched row itself.

**A pushed fix can name a tracker the list has not got.** Somebody creating a
tracker in another tab is enough. Dropping the fix would make it invisible
until something happened to re-read the list, so the vehicle is drawn and the
tracker list is re-read once per unknown id, guarded by a set so a tracker that
stays unknown cannot fire a request per fix.

**`ingest_position` costs a lookup per fix now, as phase 7 predicted.** It
needed a DB session it did not have. A `tracker_id` that resolves to nothing is
stored and not published rather than rejected: the token is what authorises
ingest, the serving side only ever scans trackers it knows, and a producer
configured with a stale id has always been allowed to write into a namespace
nobody reads.

---

## Phase 9: the assignments calendar

The feature that motivated all of it. A month grid on the feed's Assignments
page, each day cell listing tracker-to-trip assignments; clicking a day opens an
agenda for editing. Hand-rolled, no calendar library.

Creating an assignment: pick a trip (a picker over the in-browser GTFS, not free
text), pick a tracker, pick days and a date range. Editing one day of a
recurring rule writes an exception rather than splitting the rule.

- [x] The rule writes phase 3 left unbuilt: `POST /trackers/{id}/rules`,
      `GET/PATCH/DELETE /rules/{id}`, and the two exception routes
- [x] `pages/assignments-page.ts`: month grid, prev/next, today
- [x] Day agenda: add, edit, delete an assignment
- [x] Rule editor: trip picker, tracker picker, weekday checkboxes, date range,
      time window
- [x] Exceptions: skip this day, add just this day
- [x] Conflict warning when two trackers hold one trip on one day
- [x] Selecting a day drives the map, showing that day's assigned trips
- [x] Trip page shows its assignments and can add one in place
- [x] Tracker page shows what it is assigned to run

**Gotchas.** The trip picker must handle a feed with tens of thousands of trips;
use the fuzzy search that is already vendored rather than a `<select>`. "This
day only" versus "all future days" is the classic recurrence-editing trap: only
offer what the model can express, which is an exception or an edit to the rule.
Assignments for a trip the loaded GTFS does not contain must still render, since
the feed can be reloaded out from under a rule.

### What the pass turned up

**Phase 3 shipped the two read endpoints and none of the writes.**
`/feeds/{id}/rules` and `/feeds/{id}/assignments` existed; nothing could create
a rule outside SQLAdmin. So the phase started in cafe-car: `TrackerRuleWrite`
and `RuleExceptionWrite`, five routes, and `_accessible_rule`, which is the
piece worth naming — a rule has no feed column, so every route scopes through
the join to its tracker rather than trusting a small integer in a path. There
is a stranger-cannot test per route for exactly that reason.

**A one-off assignment is a rule with no weekday plus one `added` exception.**
That is the model's own way of saying "just this day", so the write is two
calls the client makes rather than a mode the server infers, and a one-off and
a skipped recurrence stay the same kind of object. It is why the create
endpoint deliberately does not require a weekday to be set: a rule that matches
no day on its own is not a broken rule.

**Skip and un-skip are one call.** `POST /rules/{id}/exceptions` upserts on
`(rule_id, date)`, because `(rule_id, date)` is unique and a date can only be
added or removed. A 409 there would force a calendar to delete before it could
change its mind, which is a round trip and a race for no gain.

**A PATCH cannot move a rule to another tracker.** `tracker_id` is not in the
write model at all, so a body carrying one is ignored rather than obeyed —
tested, because that field is the only way a rule could cross a feed boundary.

**The prefilled create form could not be submitted.** `entity-form` disables
Save until something is dirty, which is right for an edit and wrong for a form
whose every field is already the answer: the rule editor opens with the
tracker, the day, the trip and its window filled in, and the common case is
pressing Assign immediately. Hence `allowPristine`, opted into by that one
form.

**The window defaults to the trip's own schedule.** First departure to last
arrival, straight out of `stop_times` with `parseGtfsClock`, so an overnight
trip prefills as 23:00 to 25:10 and needs no thought. The times are typed and
displayed in service-day hours throughout; there is no "next day" checkbox,
because that would be a second representation of a number the column already
holds.

**The picker runs before the form on a create, and not at all on an edit.** A
modal that opens a modal to change one field is worse than a text input, and an
edit is nearly always about the days or the times. So creation goes
picker-then-form, and the form's `trip_id` stays a plain field for the rare
repoint.

**Service dates are strings end to end.** `service-date.ts` does the
arithmetic on `YYYY-MM-DD` and only ever builds a `Date` at **UTC noon**: a
date built at UTC midnight is the previous day everywhere west of Greenwich the
moment anything reads it locally, which is how a calendar grid ends up a day
out for half the world. `today()` is the only function that asks what time it
is, and it asks in the feed's zone.

**The map needed a list, not a shape.** `MapController.tripShape` became
`tripShapes`, and `showTrips` draws a whole day's assigned trips on the source
the trip page already uses. It refits the camera only when the *set* of trip
ids changes, because the calendar re-reads its window after every write and a
refit on each one would fight whoever is looking at the map. It runs after
`focus`, which is what clears the previous page's geometry.

**Phase 8 left a dead link on the trip page.** "Trackers on this trip" built a
`tracker` PageState from `VehiclePosition.key`, which stopped being the tracker
id when `key` became tracker-plus-trip-instance. Every one of those links
opened a "not found" tracker page. It is `trackerId` now, and the section is
retitled "Reporting this trip" so it reads as the opposite of the assignments
section below it.

**Rules are fetched lazily and feed-wide.** Not on selection like the trackers:
only the calendar, a trip page and a tracker page want them, and `rules: null`
is deliberately distinguishable from an empty map, so a trip page never says
"no tracker is assigned to this" while the request is still out. The expansion
is fetched per visible grid, padding days included, and re-fetched only when
the grid moves outside the window already held, so stepping between days in one
month costs nothing.

**`GET /trackers/{id}/rules` is built and unused.** The client reads the
feed-wide list everywhere, because the calendar, the trip page and the tracker
page all want the same rows and the session holds one copy. The per-tracker
route stays: it is in the planned API surface, it is the natural read next to
the create route it shares a path with, and it is scoped and tested like the
rest.

---

## Phase 10: deploy and cutover

The local half landed first, and turned out to be a prerequisite rather than a
convenience: none of the parity review below can be judged from vite's :8091,
because the dev proxy forges the headers and so cannot reproduce a single
auth-shaped failure. music-student now runs the SPA behind its real
oauth2-proxy at `http://localhost:4180`, with `OAUTH2_PROXY_UPSTREAMS` standing
in for Traefik's path rules: `/` to an nginx serving a bind-mounted `dist/`,
`/api/`, `/account` and SQLAdmin's five model prefixes to cafe-car. The old
admin's index page is the only thing lost, and `/feed/list` still reaches it for
a side-by-side comparison.

Two things only showed up once a *production* build was the thing being served.
`CONFIG.RT_BASE` picked its value off `import.meta.env.DEV`, so the copy behind
the local proxy resolved path-only feed URLs against the deployed feed server
while everything around it was local; it reads `VITE_RT_BASE` now. And the vite
proxy claimed `X-Auth-Request-User: 'alice'`, a literal where Keycloak's subject
is a UUID, so :8091 had been quietly working against a second `User` row this
whole time (the local DB has it: user 4, `alice@example.com`, owning a feed the
real alice cannot see). The proxy resolves the real subject from Keycloak now,
and forges the same debug JWT `reset.sh` does, so both doors reach one account.

- [x] music-student: an nginx service for the SPA, and split the oauth2-proxy
      upstreams so `/api` stays inside the authenticated proxy
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
  storage; revisit after phase 8.
- `GtfsShape` in railroad-club. The browser parses `shapes.txt` from the zip, so
  nothing here needs it.
- RRULE recurrence and `.ics` export. The GTFS-shaped model cannot express
  "every other Tuesday"; add it only if someone actually asks.
