/**
 * Shared furniture for the managed pages, the way `render-utils.ts` is shared
 * furniture for the GTFS ones.
 *
 * It exists because four things have to agree across the panel and the feed
 * switcher: how an ISO timestamp from the API is shown, how a load status is
 * badged, how a tracker's liveness is worded, and how a person is named when
 * they have signed in under an address but never set a display name.
 *
 * Everything here takes API types, never GTFS ones. The times are instants the
 * server sent as ISO strings, so a `Date` round-trip is safe on them — unlike a
 * GTFS `stop_times` clock value, which may be past 24:00 and must never go
 * through one.
 */

import type { LoadStatus, Member, TrackerRule } from '../types/api';
import { rtEnumValues } from '../gtfs-rt-spec/index';
import { WEEKDAY_DISPLAY, WEEKDAY_KEYS, WEEKDAY_LABELS } from './service-date';
import type { FeedSession } from './feed-session';
import { escHtml, formatAbsolute, formatRelative, timestampWithAge } from './render-utils';

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
 * How a feed's last schedule load is badged. A feed schedule-foamer has never
 * touched has no `load` at all, which is not `pending`: saying "pending" would
 * claim a brand-new feed is already on its way.
 */
export function loadStatusBadge(load: LoadStatus | null, size = 'badge-sm'): string {
  if (!load) return `<span class="badge badge-ghost ${size}">never loaded</span>`;
  const cls = LOAD_BADGE_CLASS[load.status] ?? 'badge-ghost';
  return `<span class="badge ${cls} ${size}">${escHtml(load.status)}</span>`;
}

/**
 * What to call someone: their name, then their address, then their id.
 *
 * Structural rather than `Member`, because the navbar names the signed-in
 * person from `/api/me` and a `Me` is the same three fields under another name.
 */
export function personLabel(person: Pick<Member, 'user_id' | 'email' | 'display_name'>): string {
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
  className = 'btn-outline',
  disabled = false
): string {
  return `<button type="button" class="btn btn-xs ${className}" ${disabled ? 'disabled' : ''}
    data-action="${escHtml(action)}" data-arg="${escHtml(arg)}">${escHtml(label)}</button>`;
}

/**
 * The GTFS-RT alert enumerations by name, in reference order.
 *
 * Derived from `src/gtfs-rt-spec/`, not listed here: the reference is the
 * truth, `scripts/check-rt-spec.ts` holds the spec to it, and
 * `scripts/check-alert-enums.ts` holds cafe-car's `alert_enums.py` to these,
 * so a value the forms offer is a value the API accepts.
 */
export const ALERT_CAUSES = rtEnumValues('Cause');
export const ALERT_EFFECTS = rtEnumValues('Effect');
export const ALERT_SEVERITIES = rtEnumValues('SeverityLevel');

/**
 * `TECHNICAL_PROBLEM` as `Technical problem`, for a select.
 *
 * The spec carries a curated `label` for every enum value, so this is the
 * fallback for a value that arrives from the API without one — an older row,
 * or a value the reference has since dropped.
 */
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

// ─── Tracker liveness ─────────────────────────────────────────────────────────

/**
 * Whether a tracker is reporting, has gone quiet, or has said nothing at all.
 *
 * The three states are not symmetrical, and conflating them is the trap here.
 * A position record expires out of Redis after a minute, so the server can only
 * ever answer "reporting" or "not reporting" — there is no last-seen column
 * anywhere. `quiet` is therefore something only *this session* knows: a tracker
 * this browser has watched report and then stop. A tracker that went quiet
 * before the app was opened is indistinguishable from one that has never
 * reported, and both are `silent`, which is why that state is worded as a
 * question about right now rather than as a claim about the past.
 */
export type TrackerLiveness =
  | { state: 'reporting'; vehicles: number }
  | { state: 'quiet'; since: number }
  | { state: 'silent' };

export function trackerLiveness(session: FeedSession, trackerId: string): TrackerLiveness {
  const vehicles = session.vehiclesFor(trackerId).length;
  if (vehicles > 0) return { state: 'reporting', vehicles };
  const since = session.lastSeen(trackerId);
  return since === null ? { state: 'silent' } : { state: 'quiet', since };
}

const LIVENESS_BADGE_CLASS: Record<TrackerLiveness['state'], string> = {
  reporting: 'badge-success',
  quiet: 'badge-warning',
  silent: 'badge-ghost',
};

/**
 * The liveness badge. `quiet` carries a `data-since`, so the panel's own ticker
 * counts it up without anything re-rendering the row.
 */
export function livenessBadge(liveness: TrackerLiveness, size = 'badge-xs'): string {
  const cls = `badge ${size} ${LIVENESS_BADGE_CLASS[liveness.state]}`;
  if (liveness.state === 'reporting') {
    // The count is only worth showing when it is surprising: one vehicle is
    // what a tracker normally is, and several is the thing worth noticing.
    const label = liveness.vehicles > 1 ? `${liveness.vehicles} vehicles` : 'reporting';
    return `<span class="${cls}">${escHtml(label)}</span>`;
  }
  if (liveness.state === 'quiet') {
    return `<span class="${cls}" data-since="${liveness.since}">${escHtml(
      formatRelative(liveness.since)
    )}</span>`;
  }
  return `<span class="${cls}">no fix</span>`;
}

// ─── Rule times and recurrence ────────────────────────────────────────────────

/**
 * A rule's time as a clock reading. Seconds since **service midnight**, so a
 * value past 86400 is the next calendar day and says so: `01:10 (+1d)` rather
 * than a bare `01:10`, which would be a lie about which night it is.
 *
 * Nothing here goes through a `Date`. These are offsets into a service day, not
 * instants, and a `Date` round-trip would rewrite 25:10 as 01:10 the wrong day
 * — the same trap `stop_times` clock values carry.
 */
export function formatRuleTime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const inDay = seconds - days * 86400;
  const clock = `${String(Math.floor(inDay / 3600)).padStart(2, '0')}:${String(
    Math.floor((inDay % 3600) / 60)
  ).padStart(2, '0')}`;
  const secs = inDay % 60;
  const full = secs ? `${clock}:${String(secs).padStart(2, '0')}` : clock;
  return days > 0 ? `${full} (+${days}d)` : full;
}

/**
 * The same value as a form field: `25:10`, GTFS-shaped, with no day marker.
 *
 * The editor works in service-day hours on purpose. An overnight window is
 * 23:00 to 25:10, which is how the feed writes it and how the resolver reads
 * it, and offering `01:10` next to a "next day" checkbox would invent a second
 * representation of the one number the column holds.
 */
export function ruleTimeInput(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return secs ? `${clock}:${String(secs).padStart(2, '0')}` : clock;
}

/**
 * `H:MM`, `HH:MM` or `HH:MM:SS` as seconds since service midnight, or null if
 * it is not a clock time. Hours past 24 are accepted, which is the whole point.
 */
export function parseRuleTime(value: string): number | null {
  const m = /^\s*(\d{1,2}):([0-5]\d)(?::([0-5]\d))?\s*$/.exec(value);
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0);
}

/** `09:00 to 17:00`, the pair as one reading. */
export function formatWindow(start: number, end: number): string {
  return `${formatRuleTime(start)} to ${formatRuleTime(end)}`;
}

/**
 * When a rule runs, in one line: the weekdays, then the date range that bounds
 * them.
 *
 * A rule with no weekday at all is `Once`, not broken: it is the form's
 * one-off, running only on the date its exception adds.
 */
export function describeRecurrence(rule: TrackerRule): string {
  const days = WEEKDAY_LABELS.filter((_, slot) => rule[WEEKDAY_KEYS[WEEKDAY_DISPLAY[slot]]]);
  if (days.length === 0) return `Once on ${rule.start_date}`;
  const recurrence = days.length === 7 ? 'Every day' : days.join(', ');
  const range = rule.end_date
    ? `${rule.start_date} to ${rule.end_date}`
    : `from ${rule.start_date}`;
  return `${recurrence} - ${range}`;
}
