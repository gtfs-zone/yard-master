/**
 * Shared furniture for the managed pages, the way `render-utils.ts` is shared
 * furniture for the GTFS ones.
 *
 * It exists because three things have to agree across the panel and the feed
 * switcher: how an ISO timestamp from the API is shown, how a load status is
 * badged, and how a person is named when they have signed in under an address
 * but never set a display name.
 *
 * Everything here takes API types, never GTFS ones. The times are instants the
 * server sent as ISO strings, so a `Date` round-trip is safe on them — unlike a
 * GTFS `stop_times` clock value, which may be past 24:00 and must never go
 * through one.
 */

import type { LoadStatus, Member } from '../types/api';
import { escHtml, formatAbsolute, timestampWithAge } from './render-utils';

/** Epoch seconds from an ISO string, or undefined for a null/unparseable one. */
function epochSeconds(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms / 1000;
}

/** An API timestamp as an absolute time in the feed's zone. */
export function formatIso(iso: string | null | undefined): string {
  return formatAbsolute(epochSeconds(iso));
}

/** The same, followed by its own age, refreshed in place by the panel ticker. */
export function isoWithAge(iso: string | null | undefined): string {
  return timestampWithAge(epochSeconds(iso));
}

/** Date only, for a value whose clock time says nothing useful. */
export function formatIsoDate(iso: string | null | undefined): string {
  const seconds = epochSeconds(iso);
  if (seconds === undefined) return '—';
  return new Date(seconds * 1000).toLocaleDateString();
}

const LOAD_BADGE_CLASS: Record<string, string> = {
  success: 'badge-success',
  failed: 'badge-error',
  running: 'badge-info',
  pending: 'badge-warning',
};

/**
 * How a feed's last static load is badged. A feed schedule-foamer has never
 * touched has no `load` at all, which is not `pending`: saying "pending" would
 * claim a brand-new feed is already on its way.
 */
export function loadStatusBadge(load: LoadStatus | null, size = 'badge-sm'): string {
  if (!load) return `<span class="badge badge-ghost ${size}">never loaded</span>`;
  const cls = LOAD_BADGE_CLASS[load.status] ?? 'badge-ghost';
  return `<span class="badge ${cls} ${size}">${escHtml(load.status)}</span>`;
}

/** What to call someone: their name, then their address, then their id. */
export function personLabel(person: Member): string {
  return person.display_name || person.email || `User ${person.user_id}`;
}
