/**
 * The people page: who may work on this feed, and who has been invited but has
 * never signed in.
 *
 * yard-master's own page, and the one place the two halves of sharing are
 * visible together. A member is somebody with an account; an invite is an email
 * address that was shared with before an account existed behind it, and it
 * becomes a member the first time that address signs in. Showing them in one
 * list would blur that — an invite grants nothing until it is claimed.
 *
 * Reading is open to every member, which is why this page renders for anyone
 * with the feed selected. The mutations are owner-only and land with the rest
 * of the writes.
 */

import type { Invite, Member } from '../../types/api';
import type { RenderContext } from '../render-utils';
import { escHtml, section } from '../render-utils';
import { formatIsoDate, personLabel } from '../managed-render';

function memberRow(member: Member, isYou: boolean): string {
  const secondary = member.display_name ? member.email : null;
  return `<li class="flex items-start gap-2 text-xs">
    <div class="min-w-0 flex-1">
      <span class="font-medium">${escHtml(personLabel(member))}</span>
      ${isYou ? '<span class="opacity-50"> (you)</span>' : ''}
      ${secondary ? `<div class="opacity-60 break-all">${escHtml(secondary)}</div>` : ''}
    </div>
    ${
      member.is_owner
        ? '<span class="badge badge-primary badge-xs shrink-0">owner</span>'
        : `<span class="opacity-50 shrink-0">added ${escHtml(formatIsoDate(member.created_at))}</span>`
    }
  </li>`;
}

function inviteRow(invite: Invite): string {
  return `<li class="flex items-start gap-2 text-xs">
    <span class="min-w-0 flex-1 break-all">${escHtml(invite.email)}</span>
    <span class="opacity-50 shrink-0">invited ${escHtml(formatIsoDate(invite.created_at))}</span>
  </li>`;
}

export function renderPeoplePage(ctx: RenderContext, meUserId: number | null): string {
  const people = ctx.session.people;
  if (!people) return `<p class="text-sm opacity-60">Loading the members of this feed…</p>`;

  // The owner first, then everybody else by name, so the row that answers
  // "whose feed is this" is never buried in a long list.
  const members = [...people.members].sort((a, b) => {
    if (a.is_owner !== b.is_owner) return a.is_owner ? -1 : 1;
    return personLabel(a).localeCompare(personLabel(b));
  });

  return `
    <div class="space-y-4">
      <h2 class="text-lg font-semibold leading-tight">People</h2>

      ${section(
        `Members (${members.length})`,
        `<ul class="space-y-2">${members
          .map((m) => memberRow(m, m.user_id === meUserId))
          .join('')}</ul>`
      )}

      ${
        people.invites.length
          ? section(
              `Pending invites (${people.invites.length})`,
              `<ul class="space-y-2">${people.invites.map(inviteRow).join('')}</ul>
               <p class="text-xs opacity-50">An invited address becomes a member the first time
               somebody signs in with it.</p>`
            )
          : ''
      }
    </div>`;
}
