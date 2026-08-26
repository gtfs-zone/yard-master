# yard-master - Claude Guide

## Project Overview

Map-first manager for gtfs.zone feeds, trackers and tracker assignments, served
at `manage.rt.gtfs.zone`. A static Vite/TS/daisyUI SPA against cafe-car's
authenticated JSON API. Replaces cafe-car's SQLAdmin admin interface.

## Commands

```bash
pnpm install
pnpm dev          # :8091, proxies /api to a local cafe-car admin app on :8001
pnpm typecheck    # the gate before any commit
pnpm build
pnpm vendor:check # diff vendored files against test-track
pnpm check-rt-spec     # diff src/gtfs-rt-spec against reference/
pnpm check-alert-enums # hold the alert enums to cafe-car's alert_enums.py
pnpm check             # typecheck plus both of the above

git config core.hooksPath .githooks   # once per clone; runs both checks pre-commit

# Behind the real oauth2-proxy, at music-student's http://localhost:4180. That
# stack bind-mounts this dist/, so a rebuild is the whole deploy step.
VITE_RT_BASE=http://localhost:8000 pnpm build --watch
```

## Architecture

```
Keycloak (brokers GitHub / Google / GitLab)
  └─> oauth2-proxy (ForwardAuth, auth.gtfs.zone)
        └─> Traefik, host manage.rt.gtfs.zone
              ├─> /        nginx serving this SPA
              └─> /api/*   cafe-car admin app (FastAPI)
```

Same host on purpose. Same origin means no CORS, no preflight on writes, and
the existing `X-Auth-Request-*` headers reach the API untouched.

The static GTFS feed is downloaded and parsed **in the browser**, the same way
test-track does it, but from `GET /api/feeds/{id}/schedule.zip` rather than
from the feed's `static_feed_url` directly: same origin for both source kinds,
so there is no CORS refusal on a linked feed's zip and no stale prod URL for a
hosted one. The API serves the managed objects (feeds, trackers, rules, alerts,
members) and never the schedule otherwise.

A feed's schedule is set by one of two buttons on the feed page, *Upload GTFS
schedule* and *Load schedule from URL*, never by a `source_kind` field in a
form; whichever is used decides what the feed is.

## Rules

- Do NOT use Playwright or any browser automation. The user does visual
  verification themselves. Stop at `pnpm typecheck` / `pnpm build` and hand off.
- `Tracker.device_key` is the Traccar provisioning credential. It must never
  appear in the URL hash, in a log line, or in anything shareable. It is served
  by `GET /api/trackers/{id}` alone and belongs in the properties panel only.
  `Tracker.id` is a surrogate and carries nothing: it is the right thing to put
  in navigation state, in the map feature key and in a request body.
- Every write sends the `X-Yard-Master` CSRF header. A fetch helper owns this;
  never call `fetch` for a mutation directly.
- A 302 or non-JSON response to an XHR means the oauth2-proxy session expired.
  Do a full page reload so the browser can follow the redirect chain. Never
  parse it as an error payload.
- Vendored files carry their banner and a `VENDORED.md` row. test-track is the
  upstream; `modal-utils.ts` is the one exception and names coloring-book. Do not
  edit a `verbatim` file: change it upstream and re-vendor, promote it to
  `modified` with an `@changes` list, or promote it to `adopted` if this repo has
  taken it over for good.
- A file taken out of test-track's tree keeps test-track's own banner underneath
  ours. `vendor-check` strips the banner on the local side only, so deleting the
  inner one reports DRIFT.
- A tracker with a fix is a `VehiclePosition` in `FeedSession.vehicles`, keyed by
  `Tracker.id`, on the one vehicle map layer. There is no separate tracker layer:
  an unassigned tracker draws in `CONFIG.VEHICLE_UNMATCHED_COLOR` and is counted
  in `issues.vehiclesUnmatched`. Nickname is the label the map shows, unique
  within a feed but never the key.
- All magic numbers live in `src/config.ts`.
- The calendar's month grid (`src/modules/calendar-modal.ts`) is vendored from
  coloring-book at `modified`: the cell shape and its scrolling chip stack are
  coloring-book's, the chips themselves, the `FeedSession` data source and the
  timeline half are this repo's own. See `VENDORED.md`.
- Anything auth-shaped is verified at music-student's `:4180`, not at vite's
  `:8091`. Session expiry, the cookie, the CSRF header on a write and SSE
  through the proxy only exist behind the real oauth2-proxy; the dev proxy
  forges headers and cannot fail the way production does.

## Related Repos

| Repo | Description | URL |
|---|---|---|
| cafe-car | GTFS-RT HTTP API serving real-time feeds, and this app's API | https://git.kcfam.us/gtfs.zone/cafe-car |
| vehicle-poser | Worker that tracks and posts vehicle positions | https://git.kcfam.us/gtfs.zone/vehicle-poser |
| trip-updogger | Worker that generates trip update predictions | https://git.kcfam.us/gtfs.zone/trip-updogger |
| schedule-foamer | Worker that ingests and processes GTFS schedule data | https://git.kcfam.us/gtfs.zone/schedule-foamer |
| railroad-club | Shared Python library for GTFS types and utilities | https://git.kcfam.us/gtfs.zone/railroad-club |
| music-student | Orchestration repo for deployments and infra | https://git.kcfam.us/gtfs.zone/music-student |
| landing-zone | Static marketing/status site | https://git.kcfam.us/gtfs.zone/landing-zone |
| test-track | GTFS-RT visualizer, and this repo's vendor upstream | https://git.kcfam.us/gtfs.zone/test-track |
| coloring-book | GTFS editor, where most vendored modules were born; reached through test-track, not vendored from directly | https://git.kcfam.us/gtfs.zone/coloring-book |
