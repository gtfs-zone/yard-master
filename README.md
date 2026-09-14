# yard-master

Map-first manager for gtfs.zone feeds, trackers and tracker assignments.
Deployed at `manage.rt.gtfs.zone`, behind oauth2-proxy.

A static Vite/TypeScript/daisyUI app. MapLibre fills the view, a resizable right
panel browses the object hierarchy, and every object has an editable properties
page. It reads and writes cafe-car's authenticated JSON API at `/api/*` on the
same hostname, so there is no CORS and no token handling: the session cookie
oauth2-proxy already set is the whole auth story.

Replaces cafe-car's SQLAdmin interface.

```bash
pnpm install
pnpm dev          # watch build into dist/, which the :4180 stack serves
pnpm typecheck
pnpm build
pnpm vendor:check # diff vendored files against coloring-book / test-track
pnpm check-rt-spec     # diff src/gtfs-rt-spec against reference/
pnpm check-alert-enums # hold the alert enums to cafe-car's alert_enums.py
pnpm check             # typecheck plus both of the above
```

## One local door

The music-student stack's `http://localhost:4180`, where a production build of
this app is served by nginx behind the real oauth2-proxy and `/api` reaches
cafe-car on the same origin. Build into the `dist/` it bind-mounts:

```bash
VITE_RT_BASE=http://localhost:8000 pnpm build --watch
```

There is no vite dev server. Anything auth-shaped is only real behind the
proxy: session expiry, the cookie, the CSRF header on a write, SSE staying open,
signing out. A server forging the `X-Auth-Request-*` headers cannot fail the way
production does, so it would only ever hand out a verdict worth ignoring.

`VITE_RT_BASE` is what points a path-only feed URL at the local feed server. A
watch build is a production build, so `CONFIG.RT_BASE`'s dev branch never fires
and without the variable the app resolves against `rt.gtfs.zone`.

See `CURRENT_PLAN.md` for the build-out plan.
