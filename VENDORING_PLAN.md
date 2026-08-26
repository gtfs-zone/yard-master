# Reconsider vendoring: extract a shared library for verbatim modules

## Summary

`VENDORED.md` tracks 47 copy-pasted files (~12k lines) from `test-track` and
`coloring-book`, checked for drift by `scripts/vendor-check.ts` against
sibling checkouts on disk. This plan pulls the 30 files that are never
modified for yard-master's needs into a new shared repo, consumed as a plain
pnpm git dependency (no registry, no build step). The 16 intentionally
`modified` files and the 1 `adopted` file stay vendored as-is: their
divergence is deliberate per-app behavior, and a shared dependency can't
absorb that without recreating the fork problem it's meant to solve.

## Relevant Context

### Decisions already made

| Decision | Choice | Why |
|---|---|---|
| Registry vs. git dependency | **Git dependency**, no registry | pnpm installs `git+https://...#tag` directly; no Verdaccio/npm-registry account, no publish job to run |
| Build step in the shared repo | **None.** Ships raw `.ts` source | Mirrors how these files already move today (hand-copied `.ts`, never built); nothing new to maintain |
| Versioning | **Changesets**, git-tag releases only | Turns "what changed since last tag" into a changelog/version bump without needing a registry; skip its npm-publish step |
| Scope of the modified files | **Left vendored, untouched** | Their divergence is intentional; forcing them into a shared package either bloats it with per-app conditionals or gets forked again, which is today's setup with extra ceremony |
| New repo name | **`interlocking`** (placeholder) | Railway term for shared trackage/signaling infrastructure multiple lines run through; trivial to rename before creating the repo |

### What already exists and is reused

- `scripts/vendor-check.ts` resolves each vendored file's source repo as a
  literal sibling directory (`resolve(repoRoot, '..', sourceRepo)`) and diffs
  `verbatim` rows via `git -C <sibling> show <sha>:<path>`. This logic is
  untouched by this plan — it just ends up with fewer rows (16 `modified` + 1
  `adopted`) once the 30 `verbatim` rows move out.
- `VENDORED.md`'s existing banner convention
  (`@vendored-from repo:path`, `@sha`, `@status`) is the source of truth for
  which 30 files qualify — see the full inventory below.
- Both `test-track` and `coloring-book` are already checked out as siblings
  of `yard-master` on this machine, which is how `vendor-check.ts` finds them
  today.

### The CI gap (separate, not part of this plan's phases)

`vendor-check.ts` silently skips every row and exits 0 when a sibling repo
isn't checked out, which is always true in CI. So today's vendored files,
verbatim or modified, are never actually drift-checked anywhere but a
developer's own machine. Extracting the 30 verbatim files into a real
dependency removes them from this blind spot entirely (a stale git tag pin is
visible in `package.json`, not silently invisible like a stale copy). The
remaining 17 vendored rows keep the existing gap; fixing it (shallow-cloning
`test-track`/`coloring-book` at pinned SHAs in CI) is flagged as follow-up
work, not part of this plan.

### The 30 verbatim files being extracted

`main.css`, `notification-system.ts`, `feed-progress-indicator.ts`,
`theme-controller.ts`, `panel-resizer.ts`, `bottom-sheet.ts`,
`basemap-styles.ts`, `basemap-control.ts`, `stop-layer-style.ts`,
`route-sort.ts`, `route-colors.ts`, `theme-color.ts`, `search-controller.ts`,
`feed-download.ts`, `feed-selection.ts`, `feed-url-resolve.ts`,
`about-links.ts`, `gtfs-static.ts`, `rt-index.ts`, `alerts.ts`,
`feed-time.ts`, `render-utils.ts`, `gtfs-flex.ts`, `route-source.ts`,
`gtfs-static-route-source.ts`, `scs.ts`, `route-sequence.ts`,
`route-graph.ts`, `route-strip.ts`, `tooltip-position.ts`.

## Not in scope

- Migrating `test-track` (today's de facto origin for most of these files) or
  `coloring-book` to also consume `interlocking`. They keep their own copies
  for now; that's a change to those repos and their own release process, on
  its own schedule.
- Any monorepo merger, private registry, or change to the 16 `modified` /
  1 `adopted` files.
- Fixing `vendor-check.ts`'s CI blind spot for the files that remain vendored.

---

## Phase 1 — Spike: prove the git-dependency mechanism works

Vite/esbuild pre-bundles `node_modules` deps and generally handles raw `.ts`
entries fine, but a package whose `main`/`exports` point straight at `.ts`
(not `.d.ts` + `.js`) outside a pnpm workspace is not the common case, and
`tsc`'s type-checking of a `node_modules` package depends on `tsconfig`
settings (`skipLibCheck`, `moduleResolution`). Prove this works before moving
all 30 files.

- [ ] Create the `interlocking` repo: `package.json` (`name`, `version`,
      `main`/`exports` and `types` pointing at a `.ts` entry point), and one
      file to start: `src/utils/route-colors.ts` (169 lines, no internal
      deps — lowest-risk candidate)
- [ ] Tag it `v0.0.1`
- [ ] In `yard-master`: `pnpm add "interlocking@git+https://git.kcfam.us/gtfs.zone/interlocking.git#v0.0.1"`
- [ ] Replace the vendored `src/utils/route-colors.ts` import with the
      package import; delete the local copy
- [ ] Confirm `pnpm dev`, `pnpm build`, and `pnpm typecheck` all succeed with
      no special tsconfig changes

**Gotcha.** If `tsc` chokes on the `node_modules/.../*.ts` file or Vite
refuses to pre-bundle it, the fallback is a minimal build step in
`interlocking` (`tsc` to `dist/` with a `.d.ts` + `.js` pair) — not abandoning
the git-dependency approach. Resolve this here before Phase 2 moves anything
else.

---

## Phase 2 — Migrate the remaining 29 verbatim files

- [ ] Move the rest of the inventory above into `interlocking/src/`,
      preserving relative import paths where they reference each other
- [ ] Update `yard-master` to import all of them from `interlocking`; delete
      the local copies
- [ ] Remove their rows from `VENDORED.md` — `vendor-check.ts` itself needs
      no logic change, just fewer rows to check
- [ ] Re-run `pnpm check` (typecheck + vendor-check + spec/enum checks)

---

## Verification

- `pnpm typecheck`, `pnpm build`, and `pnpm check` all pass in `yard-master`
  after each phase
- Manual smoke check in the browser (per this repo's rule against
  Playwright) of anything touching the moved modules — map rendering,
  search, alerts, route pages — since these are exactly the modules that
  render the map and drive navigation
