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

/**
 * A button that asks the shell to do something, rather than to navigate.
 *
 * `PanelRenderer` delegates these the same way it delegates `data-nav` links,
 * so a page stays a pure string renderer and the write itself lives in
 * `actions.ts`. `arg` names the object the action is about — a tracker id, an
 * alert id, an entity id — and is never a credential: `device_key` is not an
 * address for anything.
 */
export function actionButton(
  action: string,
  arg: string,
  label: string,
  className = 'btn-outline'
): string {
  return `<button type="button" class="btn btn-xs ${className}"
    data-action="${escHtml(action)}" data-arg="${escHtml(arg)}">${escHtml(label)}</button>`;
}

/** The GTFS-RT enumerations by name, mirroring cafe-car's `alert_enums.py`. */
export const ALERT_CAUSES = [
  'UNKNOWN_CAUSE',
  'OTHER_CAUSE',
  'TECHNICAL_PROBLEM',
  'STRIKE',
  'DEMONSTRATION',
  'ACCIDENT',
  'HOLIDAY',
  'WEATHER',
  'MAINTENANCE',
  'CONSTRUCTION',
  'POLICE_ACTIVITY',
  'MEDICAL_EMERGENCY',
] as const;

export const ALERT_EFFECTS = [
  'NO_SERVICE',
  'REDUCED_SERVICE',
  'SIGNIFICANT_DELAYS',
  'DETOUR',
  'ADDITIONAL_SERVICE',
  'MODIFIED_SERVICE',
  'OTHER_EFFECT',
  'UNKNOWN_EFFECT',
  'STOP_MOVED',
  'NO_EFFECT',
  'ACCESSIBILITY_ISSUE',
] as const;

export const ALERT_SEVERITIES = [
  'UNKNOWN_SEVERITY',
  'INFO',
  'WARNING',
  'SEVERE',
] as const;

/** `TECHNICAL_PROBLEM` as `Technical problem`, for a select. */
export function enumLabel(value: string): string {
  const words = value.toLowerCase().split('_');
  return words.map((w, i) => (i === 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w)).join(' ');
}

/**
 * An API instant as a `datetime-local` value, in **this browser's** zone.
 *
 * The input has no zone of its own, so the pair of functions here is what
 * stops a wall-clock time from being read as UTC on the way back in. The panel
 * displays these instants in the *feed's* zone, which is the right zone to
 * read a service alert in; the editor works in the reader's own, which is the
 * only zone a bare `datetime-local` can honestly claim.
 */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const local = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** The inverse: a local wall-clock value as an absolute instant, or null. */
export function fromLocalInput(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const ms = Date.parse(trimmed);
  // `Date.parse` of a `datetime-local` value reads it as local time, which is
  // what the input meant. Sending the resulting instant with its offset is
  // what keeps the server from stamping UTC onto a wall-clock time.
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}
