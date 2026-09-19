/**
 * The signed-in person, and the two things they can do about it.
 *
 * The navbar's user button opens this rather than jumping straight to
 * Keycloak: sign-out needs somewhere to live, and a modal keeps the console
 * link and the session control together without a second navbar control.
 *
 * Sign-out is a full navigation to oauth2-proxy, never a fetch. The endpoint
 * answers with a redirect chain that ends in HTML, which `api-client.ts` reads
 * as an expired session and turns into a reload.
 */

import { CONFIG } from '../config';
import type { Me } from '../types/api';
import { personLabel } from './managed-render';
import { showModal, type ModalAction } from 'interlocking/ui/modal-utils';
import { escHtml } from 'interlocking/gtfs/entity-render';

/** Opens the account modal. Resolves when it closes. */
export async function showAccountModal(me: Me): Promise<void> {
  const label = personLabel(me);
  // Only when it is not already the heading, which it is whenever the account
  // has no display name.
  const email = me.email && me.email !== label ? me.email : null;

  const actions: ModalAction[] = [{ label: 'Close', onClick: () => {} }];

  // A deployment without a Keycloak Account Console has no page to send them
  // to, so the entry goes away rather than 404ing.
  const accountUrl = me.account_url;
  if (accountUrl) {
    actions.push({
      // A new tab: the console is a different origin with no link back, so
      // navigating there in this tab strands the map.
      label: 'Manage account',
      onClick: () => {
        window.open(accountUrl, '_blank', 'noopener');
      },
    });
  }

  actions.push({
    label: 'Sign out',
    className: 'btn-error',
    onClick: () => {
      window.location.assign(CONFIG.SIGN_OUT_URL);
    },
  });

  await showModal({
    title: 'Account',
    body: `
      <div class="space-y-1">
        <p class="font-medium">${escHtml(label)}</p>
        ${email ? `<p class="text-sm opacity-70">${escHtml(email)}</p>` : ''}
        ${me.is_admin ? '<p class="text-xs opacity-70">Administrator</p>' : ''}
      </div>`,
    actions,
    escapeAction: 0,
    boxClassName: 'max-w-md',
  });
}
