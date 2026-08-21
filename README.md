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
pnpm dev          # :8091, proxies /api to a local cafe-car admin app on :8001
pnpm typecheck
pnpm build
pnpm vendor:check # diff vendored files against coloring-book / test-track
```

## Two local doors

`pnpm dev` on :8091 is the fast one: HMR, and vite forges the proxy headers
oauth2-proxy would set. It looks alice's real Keycloak subject up from the
music-student stack so it lands on the same account a real login does; without
that stack running it falls back to a literal and says so.

The honest one is the music-student stack's `http://localhost:4180`, where a
production build of this app is served by nginx behind the real oauth2-proxy and
`/api` reaches cafe-car on the same origin. Build into the `dist/` it
bind-mounts:

```bash
VITE_RT_BASE=http://localhost:8000 pnpm build --watch
```

Anything auth-shaped is only real there: session expiry, the cookie, the CSRF
header on a write, SSE staying open through the proxy. Take :8091's verdict on
those with suspicion.

See `CURRENT_PLAN.md` for the build-out plan.
