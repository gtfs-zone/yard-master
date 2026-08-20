# yard-master - Claude Guide

## Project Overview

Map-first manager for gtfs.zone feeds, trackers and tracker assignments, served
at `manage.rt.gtfs.zone`. A static Vite/TS/daisyUI SPA against cafe-car's
authenticated JSON API. Replaces cafe-car's SQLAdmin admin interface.

## Commands

```bash
pnpm install
pnpm dev          # :8090, proxies /api to a local cafe-car admin app on :8001
pnpm typecheck    # the gate before any commit
pnpm build
pnpm vendor:check # diff vendored files against test-track
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

The static GTFS feed is downloaded and parsed **in the browser** from the feed's
`static_feed_url`, the same way test-track does it. The API serves the managed
objects (feeds, trackers, rules, alerts, members) and never the schedule.

## Rules

- Never include `Co-Authored-By: Claude ...` trailers in commit messages.
- Do NOT use Playwright or any browser automation. The user does visual
  verification themselves. Stop at `pnpm typecheck` / `pnpm build` and hand off.
- `Tracker.id` is the Traccar provisioning credential. It must never appear in
  the URL hash, in a log line, or in anything shareable. Address trackers by
  nickname in navigation state; the id belongs in the properties panel and the
  request body only.
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
  nickname, on the one vehicle map layer. There is no separate tracker layer: an
  unassigned tracker draws in `CONFIG.VEHICLE_UNMATCHED_COLOR` and is counted in
  `issues.vehiclesUnmatched`.
- All magic numbers live in `src/config.ts`.

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

## Forgejo Workflow

This project uses an offline-first workflow. Claude reads/writes `CURRENT_PLAN.md`
locally and only touches Forgejo when explicitly asked.

### Making a plan (triggered by "make a plan for issue #N" or "let's plan X")

1. If the user said "fetch issue #N", use `mcp__forgejo__get_issue_by_index` with
   `owner: "gtfs.zone"`, `repo: "yard-master"`; otherwise work from the context provided
2. Explore the codebase as needed
3. Ask clarifying questions inline; wait for answers before writing
4. Write the plan to `CURRENT_PLAN.md` (format: Summary, Relevant Context,
   numbered Phases each with prose + checklist + gotchas)
5. Do not start implementation

### Completing a phase (triggered by "complete phase N" or "do phase N")

1. Read `CURRENT_PLAN.md` directly, do not fetch from Forgejo
2. Implement everything in the phase; commit as you go with conventional commits
3. After completing, update `CURRENT_PLAN.md`: check off completed items, append
   discoveries to that phase's prose
4. Do not update the Forgejo issue; do not start the next phase; stop for review

### Updating Forgejo (triggered by "update issue #N")

1. Use `mcp__forgejo__update_issue` to overwrite the issue body with `CURRENT_PLAN.md`

### Creating a PR (triggered by "make a PR closing #N")

1. Use `mcp__forgejo__create_pull_request` with `owner: "gtfs.zone"`,
   `repo: "yard-master"`, current branch as `head`, `main` as `base`
