/* @vendored-from test-track:src/modules/panel-renderer.ts
   @sha fa12a57
   @status modified
   @changes
   - The session events are yard-master's: `change`, `vehicles`, `assignments`
     and `staticloaded` replace test-track's `vehicles` / `tripUpdates` /
     `alerts`.
   - No `active` flag and no `hide()`. test-track hands the panel back to a
     status page when nothing is focused; here `home` is the browse tree, so
     the panel always has something to render.
   - `setBreadcrumbs` added: the trail is rebuilt outside this class and can
     arrive after the page it belongs to, without a scroll reset.
   - The dispatcher covers yard-master's eight variants: `home` renders the
     feed and its tree, `trip` is this repo's own page, `vehicle` is gone, and
     the managed variants render this repo's own pages, the calendar included.
   - `meUserId` added to the hooks: the people page marks the signed-in row,
     and `RenderContext` is a verbatim type that has no business growing a
     field for it.
   - `action` added to the hooks, and `data-action` delegated alongside
     `data-nav`. test-track's panel is read-only and needs neither; here a page
     emits a button and `actions.ts` owns what it does, which is what keeps the
     pages pure string renderers.
   - `mapIssues` added to the hooks. The counts belong to `LayerManager`, which
     is verbatim and knows nothing about the panel; upstream reads them off its
     own status page, which this repo does not have. */
/**
 * The right panel's object pages: one dispatcher over `PageState`, plus the
 * furniture every page shares.
 *
 * The panel re-renders on every realtime poll, which is every 15 seconds. A
 * naive `innerHTML =` would bounce the reader to the top of a 60-stop route
 * strip and slam shut every raw-column table they had opened, so scroll
 * position is captured and restored around each render and open `<details>` are
 * tracked by key in a set that outlives the DOM.
 */

import type { BreadcrumbItem, PageState } from '../types/page-state';
import type { MapDataIssues } from './layer-manager';
import type { FeedSession } from './feed-session';
import { RtIndex } from './rt-index';
import type { RenderContext } from './render-utils';
import { escHtml, formatRelative } from './render-utils';
import { renderAlertPage } from './pages/alert-page';
import { renderAssignmentsPage } from './pages/assignments-page';
import { renderPeoplePage } from './pages/people-page';
import { renderRoutePage } from './pages/route-page';
import { renderStopPage } from './pages/stop-page';
import { renderTrackerPage } from './pages/tracker-page';
import { renderTreePage } from './pages/tree-page';
import { renderTripPage } from './pages/trip-page';

export interface PanelRendererHooks {
  /** Navigate to a page, as if the user had clicked it on the map. */
  navigate: (state: PageState) => void;
  /** The full hash for a page, so links are real links. */
  href: (state: PageState) => string;
  /** Light a stop on the map while its route-strip row is hovered. */
  hoverStop: (stop_id: string | null) => void;
  /** The signed-in user's id, or null before `/me` has answered. */
  meUserId: () => number | null;
  /** Run a write, named by the button that asked for it. */
  action: (action: string, arg: string) => void;
  /** What the map could not draw, for the home page's warning card. */
  mapIssues: () => MapDataIssues;
}

function renderBreadcrumbs(ctx: RenderContext, items: BreadcrumbItem[]): string {
  if (items.length === 0) return '';
  return `
    <nav class="text-xs breadcrumbs opacity-70 py-0">
      <ul>${items
        .map((item, i) =>
          i === items.length - 1
            ? `<li>${escHtml(item.label)}</li>`
            : `<li><a href="${escHtml(ctx.href(item.pageState))}" data-nav="${escHtml(
                JSON.stringify(item.pageState),
              )}">${escHtml(item.label)}</a></li>`,
        )
        .join('')}</ul>
    </nav>`;
}

export class PanelRenderer {
  private host: HTMLElement;
  private session: FeedSession;
  private hooks: PanelRendererHooks;

  private state: PageState = { type: 'home' };
  private breadcrumbs: BreadcrumbItem[] = [];
  private hoveredStopId: string | null = null;

  /** Invalidated on every payload event; rebuilt lazily on the next render. */
  private index: RtIndex | null = null;
  private openDetails = new Set<string>();
  private tickerId: ReturnType<typeof setInterval> | null = null;
  private renderQueued = false;

  constructor(host: HTMLElement, session: FeedSession, hooks: PanelRendererHooks) {
    this.host = host;
    this.session = session;
    this.hooks = hooks;
  }

  initialize(): void {
    // `change` covers every managed update, `vehicles` the live fleet,
    // `assignments` an expanded calendar window and `staticloaded` the parsed
    // zip. All four invalidate the index, since any of them can change what a
    // page can resolve. `vehicles` is separate from `change` because it fires
    // per pushed fix, which the map wants and most of the rest of the app does
    // not.
    for (const event of ['change', 'vehicles', 'assignments', 'staticloaded'] as const) {
      this.session.addEventListener(event, () => {
        this.index = null;
        this.queueRender();
      });
    }

    // Delegated so the handlers survive every re-render.
    this.host.addEventListener('click', e => this.onClick(e));
    this.host.addEventListener('toggle', e => this.onToggle(e), true);
    // pointerover/out bubble, unlike pointerenter/leave, so they can be
    // delegated to the panel host the same way.
    this.host.addEventListener('pointerover', e => this.onPointerOver(e));
    this.host.addEventListener('pointerout', e => this.onPointerOut(e));

    this.tickerId = setInterval(() => this.tick(), 1000);
  }

  destroy(): void {
    if (this.tickerId !== null) clearInterval(this.tickerId);
    this.tickerId = null;
  }

  /**
   * Replace the trail without changing the page. The trail is rebuilt from the
   * session, so it goes stale whenever an object a crumb names arrives late;
   * this keeps the reader's scroll position, which `show` deliberately does not.
   */
  setBreadcrumbs(breadcrumbs: BreadcrumbItem[]): void {
    this.breadcrumbs = breadcrumbs;
    this.queueRender();
  }

  /** Render `state`. `home` is the browse tree, so there is always a page. */
  show(state: PageState, breadcrumbs: BreadcrumbItem[]): void {
    this.clearHoveredStop();
    this.state = state;
    this.breadcrumbs = breadcrumbs;
    // A different object is a different page: start it at the top rather than
    // inheriting the previous page's scroll offset.
    this.render(true);
  }

  /**
   * Drop the hover light. A page change replaces the rows under the pointer,
   * so the `pointerout` that would normally clear it never arrives.
   */
  private clearHoveredStop(): void {
    if (this.hoveredStopId === null) return;
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  private onClick(e: Event): void {
    const source = e.target as HTMLElement | null;

    // Actions first: a button is never inside a link, but a link may well be
    // inside the same row as one, and a write must not also navigate.
    const action = source?.closest<HTMLElement>('[data-action]');
    if (action) {
      e.preventDefault();
      this.hooks.action(action.dataset.action!, action.dataset.arg ?? '');
      return;
    }

    const target = source?.closest<HTMLElement>('[data-nav]');
    if (!target) return;
    // Let modified clicks do what the browser would do with a normal link.
    const mouse = e as MouseEvent;
    if (mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.button !== 0) return;
    e.preventDefault();
    this.hooks.navigate(JSON.parse(target.dataset.nav!) as PageState);
  }

  /** The stop_id of the strip row an event happened inside, if any. */
  private rowStopId(e: Event): string | null {
    const row = (e.target as HTMLElement | null)?.closest<HTMLElement>('.strip-stop-row');
    return row?.dataset.stopId ?? null;
  }

  private onPointerOver(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId === this.hoveredStopId) return;
    this.hoveredStopId = stopId;
    this.hooks.hoverStop(stopId);
  }

  private onPointerOut(e: Event): void {
    const stopId = this.rowStopId(e);
    if (!stopId || stopId !== this.hoveredStopId) return;
    // Moving between two children of the same row fires an out/over pair for
    // that row; only a pointer that actually left every row clears the light.
    const next = (e as PointerEvent).relatedTarget;
    if (next instanceof Element && next.closest('.strip-stop-row')) return;
    this.hoveredStopId = null;
    this.hooks.hoverStop(null);
  }

  private onToggle(e: Event): void {
    const el = e.target as HTMLDetailsElement;
    const key = el.dataset?.detail;
    if (!key) return;
    if (el.open) this.openDetails.add(key);
    else this.openDetails.delete(key);
  }

  private queueRender(): void {
    if (this.renderQueued) return;
    this.renderQueued = true;
    queueMicrotask(() => {
      this.renderQueued = false;
      this.render(false);
    });
  }

  private tick(): void {
    this.host.querySelectorAll<HTMLElement>('[data-since]').forEach(el => {
      el.textContent = formatRelative(Number(el.dataset.since));
    });
  }

  private render(resetScroll: boolean): void {
    const scroll = this.host.scrollTop;
    const ctx: RenderContext = { session: this.session, href: this.hooks.href };

    this.host.innerHTML = `
      <div class="space-y-4">
        ${renderBreadcrumbs(ctx, this.breadcrumbs)}
        ${this.renderPage(ctx)}
      </div>`;

    // Re-open whatever the reader had opened, then put them back where they
    // were — in that order, since opening a table changes the scroll height.
    this.host.querySelectorAll<HTMLDetailsElement>('[data-detail]').forEach(el => {
      if (this.openDetails.has(el.dataset.detail!)) el.open = true;
    });
    this.host.scrollTop = resetScroll ? 0 : scroll;
  }

  /** The realtime read-model for the current payloads, built on demand. */
  get rtIndex(): RtIndex {
    return (this.index ??= new RtIndex(this.session));
  }

  private renderPage(ctx: RenderContext): string {
    const index = this.rtIndex;
    switch (this.state.type) {
      case 'home':
        return renderTreePage(ctx, this.hooks.mapIssues());
      case 'route':
        return renderRoutePage(ctx, index, this.state);
      case 'stop':
        return renderStopPage(ctx, index, this.state);
      case 'trip':
        return renderTripPage(ctx, index, this.state);
      case 'alert':
        return renderAlertPage(ctx, this.state);
      case 'tracker':
        return renderTrackerPage(ctx, this.state);
      case 'people':
        return renderPeoplePage(ctx, this.hooks.meUserId());
      case 'assignments':
        return renderAssignmentsPage(ctx, this.state);
    }
  }
}
