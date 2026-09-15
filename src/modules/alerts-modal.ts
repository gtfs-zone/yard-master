/**
 * Every managed alert on the selected feed, and the way to make another one.
 *
 * yard-master's own file, built on test-track's alerts modal: the same navbar
 * button with the same `indicator` badge, opening the same flat list. What
 * differs is what a row is for. test-track reads a feed it does not own, so its
 * rows expand in place; here an alert is an object with a page of its own — its
 * text, its active period and the entities it informs — so a row is a link into
 * the panel and the modal gets out of the way.
 *
 * It is a navbar modal rather than a page because an alert is not reached
 * through the feed's own hierarchy: it is written about a route, a trip or a
 * stop, and the page it belongs under is whichever of those it names. The list
 * is the way in when the reader does not already have that object open.
 *
 * Mounted on `document.body`, outside the panel host, so both the links and the
 * New alert button are delegated here rather than by `PanelRenderer`. The links
 * are real `<a href>` elements carrying the target hash, so middle-click and
 * copy-link-address behave; a plain click navigates, and the modal comes down
 * because the page state it navigates to names no modal.
 *
 * Hash-routed: `modal-router.ts` is what opens and closes this, so every way in
 * — the navbar button, a pasted link, the back button — goes through a page
 * state rather than calling `showAlertsModal` directly.
 */

import type { PageState } from '../types/page-state';
import { entityRow, entityRowList } from './entity-row';
import type { FeedSession } from './feed-session';
import { actionButton } from './managed-render';
import { showModal } from 'interlocking/modules/modal-utils';
import type { RenderContext } from './render-utils';

export interface AlertsModalHooks {
  ctx: RenderContext;
  /** Navigate the panel. The router closes this modal on the way. */
  navigate: (state: PageState) => void;
  /** Run a write, named by the button that asked for it. */
  action: (action: string, arg: string) => void;
}

/** What the navbar badge says: the managed alerts on the selected feed. */
export function alertsBadgeCount(session: FeedSession): number {
  return session.feed ? session.serviceAlerts.size : 0;
}

function renderAlerts(ctx: RenderContext): string {
  if (!ctx.session.feed) return `<p class="text-sm opacity-60">No feed is selected.</p>`;

  // Newest first: an alert is written about something happening now, so the
  // most recently created one is the one being asked about.
  const alerts = [...ctx.session.serviceAlerts.values()].sort((a, b) => b.id - a.id);

  const rows = alerts.map((alert) =>
    entityRow(ctx, {
      state: { type: 'alert', alert_id: String(alert.id) },
      label: alert.header_text || `Alert ${alert.id}`,
      badge: `${alert.entity_count} entit${alert.entity_count === 1 ? 'y' : 'ies'}`,
    })
  );

  return `
    <div class="space-y-3">
      <div class="flex justify-end">${actionButton('alert:new', '', 'New alert', 'btn-primary')}</div>
      ${entityRowList(rows, 'No service alerts.')}
    </div>`;
}

/**
 * Open the alerts list.
 *
 * It redraws on the session's `change` event, so an alert created from the
 * button inside it appears in the list behind the form that made it.
 */
export async function showAlertsModal(hooks: AlertsModalHooks): Promise<void> {
  const { ctx } = hooks;
  const session = ctx.session;
  let root: HTMLElement | null = null;

  const draw = (): void => {
    if (!root) return;
    root.innerHTML = renderAlerts(ctx);
  };

  const onChange = (): void => draw();
  session.addEventListener('change', onChange);

  await showModal({
    title: 'Service alerts',
    body: '<div data-alerts-root></div>',
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
    boxClassName: 'max-w-2xl',
    onMount: () => {
      root = document.querySelector<HTMLElement>('[data-alerts-root]');
      draw();

      root?.addEventListener('click', (event) => {
        const source = event.target as HTMLElement | null;

        // A write first: it opens its own form over this modal, which stays
        // open behind it and redraws when the list is re-read.
        const button = source?.closest<HTMLElement>('[data-action]');
        if (button) {
          event.preventDefault();
          hooks.action(button.dataset.action!, button.dataset.arg ?? '');
          return;
        }

        // A link: the panel's delegation cannot see it from here, so the row
        // hands the page over itself. Nothing here closes the modal — the new
        // page state carries no modal, so `modal-router.ts` takes this one
        // down. One path, whether the alert was reached from a row, the back
        // button or a pasted link.
        const link = source?.closest<HTMLElement>('[data-nav]');
        if (!link) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        hooks.navigate(JSON.parse(link.dataset.nav!) as PageState);
      });
    },
  });

  session.removeEventListener('change', onChange);
}
