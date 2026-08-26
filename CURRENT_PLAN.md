# yard-master: the cutover

## Summary

The eight-bug plan is done. What is left is the cutover itself: docs in the
other repos, the deploy, the parity check, and retiring SQLAdmin.

## Phase 1 — Cutover

- [x] schedule-foamer `CLAUDE.md`: the two source kinds
- [x] railroad-club `CLAUDE.md`: the store seam and the `GtfsUpload` model
- [x] music-student / deploy-gtfs-rt `README`s: Garage, and what it holds
- [x] deploy-gtfs-rt / music-student: the nginx deployment and the Traefik
      router — `sites/yard-master.yaml`, on the temporary
      `manage-next.rt.gtfs.zone`, and the CI digest-bump step in yard-master's
      own `build.yml`
- [ ] Deploy alongside the old admin on a temporary hostname and use it for
      real work
- [ ] Parity review: feeds, trackers, provisioning, alerts, members, uploads
- [ ] Swap `manage.rt.gtfs.zone` to yard-master, old admin to a temporary host
- [ ] Let it hold for a week
- [ ] Delete SQLAdmin from cafe-car: `admin/views.py`, `admin/account_view.py`
- [ ] cafe-car's `CLAUDE.md` and `README`: the two-app split as it then is

## Not in scope

- `CONFIG.WEEK_START` is 0 and `timeline-chart.ts` is Monday-first through
  `service-date.ts`. `TODO.md` asks for Sunday everywhere; it is a change to
  every chart in the app and belongs on its own.
- `Tracker columbia-county:SHOPPING_WK_758:20260821 is not in the loaded feed.`
  Still open, still `TODO.md`'s.
- Any change to how `schedule-foamer` gets its bytes. It keeps reading the
  object by key.
