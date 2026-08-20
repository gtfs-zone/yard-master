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
pnpm dev          # :8090, proxies /api to a local cafe-car admin app on :8001
pnpm typecheck
pnpm build
pnpm vendor:check # diff vendored files against coloring-book / test-track
```

See `CURRENT_PLAN.md` for the build-out plan.
