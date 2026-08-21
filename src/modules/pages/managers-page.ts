/**
 * The managers page: who may work on this feed, and who has been invited but
 * has never signed in.
 *
 * yard-master's own page, and the one place the two halves of sharing are
 * visible together. A manager is somebody with an account; an invite is an
 * email address that was shared with before an account existed behind it, and
 * it becomes a manager the first time that address signs in. Showing them in
 * one list would blur that — an invite grants nothing until it is claimed.
 * Invites keep the language of people rather than roles: an invite goes to an
 * address, and only the sign-in behind it makes a manager.
 *
 * The API calls these rows members and this app keeps that name in its types,
 * so `Member` still mirrors cafe-car's schema. Only the label says manager.
 *
 * Reading is open to every member, which is why this page renders for anyone
 * with the feed selected. The mutations are owner-only, so the buttons appear
 * only for a reader whose feed says `can_manage`: showing a manager a Remove
 * button that answers 403 would be worse than not offering it. Transfer is on
 * this page for the same reason it is gated: it hands the feed to one of the
 * rows listed right below it.
 */

import type { Invite, Member } from '../../types/api';
import type { RenderContext } from '../render-utils';
import { entityRow, entityRowList, rowSection } from '../entity-row';
import { actionButton, formatIsoDate, personLabel } from '../managed-render';

function managerRow(
  ctx: RenderContext,
  member: Member,
  isYou: boolean,
  canManage: boolean
): string {
  return entityRow(ctx, {
    label: `${personLabel(member)}${isYou ? ' (you)' : ''}`,
    // Only when the label is a name: repeating the address under itself says
    // nothing.
    sublabel: member.display_name ? member.email ?? undefined : undefined,
    badgeHtml: member.is_owner
      ? '<span class="badge badge-primary badge-xs">owner</span>'
      : `<span class="text-xs opacity-50">added ${formatIsoDate(member.created_at)}</span>`,
    // The owner is not a membership row at all: they leave through a transfer,
    // which is the button above this list.
    actionsHtml:
      canManage && !member.is_owner
        ? actionButton('member:remove', String(member.user_id), 'Remove', 'btn-ghost')
        : '',
  });
}

function inviteRow(ctx: RenderContext, invite: Invite, canManage: boolean): string {
  return entityRow(ctx, {
    label: invite.email,
    badgeHtml: `<span class="text-xs opacity-50">invited ${formatIsoDate(invite.created_at)}</span>`,
    actionsHtml: canManage
      ? actionButton('invite:revoke', String(invite.id), 'Revoke', 'btn-ghost')
      : '',
  });
}

export function renderManagersPage(ctx: RenderContext, meUserId: number | null): string {
  const members = ctx.session.members;
  if (!members) return `<p class="text-sm opacity-60">Loading the managers of this feed…</p>`;

  // The owner first, then everybody else by name, so the row that answers
  // "whose feed is this" is never buried in a long list.
  const managers = [...members.members].sort((a, b) => {
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
    return personLabel(a).localeCompare(personLabel(b));
  });

  const canManage = ctx.session.feed?.can_manage ?? false;

  return `
    <div class="space-y-4">
      <h2 class="text-lg font-semibold leading-tight">Managers</h2>

      ${
        canManage
          ? `<div class="flex flex-wrap gap-2">
              ${actionButton('manager:add', '', 'Add manager', 'btn-primary')}
              ${actionButton('feed:transfer', '', 'Transfer ownership')}
            </div>`
          : ''
      }

      ${rowSection(
        'Managers',
        managers.length,
        entityRowList(
          managers.map((m) => managerRow(ctx, m, m.user_id === meUserId, canManage)),
          'Nobody manages this feed.'
        )
      )}

      ${
        members.invites.length
          ? rowSection(
              'Pending invites',
              members.invites.length,
              `${entityRowList(
                members.invites.map((i) => inviteRow(ctx, i, canManage)),
                'No pending invites.'
              )}
               <p class="text-xs opacity-50">An invited address becomes a manager the first time
               somebody signs in with it.</p>`
            )
          : ''
      }
    </div>`;
}
