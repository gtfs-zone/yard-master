/**
 * The assignments calendar: a month of tracker-to-trip assignments, and the
 * agenda for whichever day is selected.
 *
 * yard-master's own page, and the feature the rest of the app was shaped
 * around. Hand-rolled rather than a calendar library: what is drawn is one
 * month of a GTFS-shaped recurrence, which is `calendar.txt` plus
 * `calendar_dates.txt`, and no library models that.
 *
 * Two things this page never does itself:
 *
 * - **Expand a rule.** The occurrences come from `GET /feeds/{id}/assignments`,
 *   which shares its expansion with the resolver that decides what a tracker is
 *   running. A grid that re-implemented the recurrence would eventually
 *   disagree with the pipeline about which day a rule runs, and disagree
 *   silently.
 * - **Resolve a trip.** An assignment names a `trip_id`, and the loaded
 *   schedule may not contain it: a feed can be reloaded out from under a rule.
 *   Such an assignment still renders, as its bare id, because it is still real
 *   and still needs deleting or repointing.
 *
 * Every date here is a service date in feed-local time — the date a window
 * *starts* — so an overnight run appears once, on the day it started, with an
 * end time past 24:00.
 */

import { CONFIG } from '../../config';
import type { Assignment, TrackerRule } from '../../types/api';
import type { PageState } from '../../types/page-state';
import type { RenderContext } from '../render-utils';
import { entityLink, escHtml, prop, propList, section } from '../render-utils';
import { actionButton, describeRecurrence, formatWindow } from '../managed-render';
import {
  addMonths,
  dayLabel,
  dayOfMonth,
  isServiceDate,
  monthGrid,
  monthLabel,
  sameMonth,
  startOfMonth,
  today,
  WEEKDAY_LABELS,
  type ServiceDate,
} from '../service-date';

/** The days one page of the calendar covers, padding included. */
export function gridRange(anchor: ServiceDate): { from: ServiceDate; to: ServiceDate } {
  const days = monthGrid(anchor);
  return { from: days[0], to: days[days.length - 1] };
}

/** The month a state is looking at: its selected day, or today's month. */
export function anchorDate(state: Extract<PageState, { type: 'assignments' }>): ServiceDate {
  return isServiceDate(state.date) ? state.date : today();
}

/**
 * Trips that two different trackers are both assigned to on one day.
 *
 * The same tracker holding a trip twice is not a conflict — an overlapping pair
 * of rules on one tracker is redundant, not contradictory — but two trackers
 * on one trip means two vehicles claiming the same run in the published feed,
 * and only a person can say which one is right.
 */
function conflictedTrips(assignments: Assignment[]): Set<string> {
  const trackersByTrip = new Map<string, Set<string>>();
  for (const a of assignments) {
    const trackers = trackersByTrip.get(a.trip_id) ?? new Set<string>();
    trackers.add(a.tracker_id);
    trackersByTrip.set(a.trip_id, trackers);
  }
  const conflicts = new Set<string>();
  for (const [tripId, trackers] of trackersByTrip) {
    if (trackers.size > 1) conflicts.add(tripId);
  }
  return conflicts;
}

/** A trip as a link, or as its bare id when the loaded feed has lost it. */
function tripLink(ctx: RenderContext, tripId: string): string {
  const trip = ctx.session.staticFeed?.trips.get(tripId);
  if (!trip) {
    return `<span class="font-mono opacity-70" title="Not in the loaded schedule">${escHtml(
      tripId
    )}</span>`;
  }
  const routeId = trip.route_id;
  return entityLink(
    ctx,
    { type: 'trip', trip_id: tripId, ...(routeId ? { route_id: routeId } : {}) },
    trip.raw.trip_short_name?.trim() || trip.headsign || tripId
  );
}

// ─── The grid ─────────────────────────────────────────────────────────────────

function renderNav(anchor: ServiceDate, ctx: RenderContext): string {
  const jump = (date: ServiceDate, label: string, extra = ''): string =>
    entityLink(ctx, { type: 'assignments', date }, label, `btn btn-xs btn-ghost ${extra}`);

  return `
    <div class="flex items-center justify-between gap-2">
      ${jump(startOfMonth(addMonths(anchor, -1)), '‹')}
      <span class="text-sm font-semibold">${escHtml(monthLabel(anchor))}</span>
      <span class="flex gap-1">
        ${jump(today(), 'Today')}
        ${jump(startOfMonth(addMonths(anchor, 1)), '›')}
      </span>
    </div>`;
}

function renderDay(
  ctx: RenderContext,
  day: ServiceDate,
  anchor: ServiceDate,
  selected: ServiceDate | null
): string {
  const assignments = ctx.session.assignmentsOn(day);
  const conflicts = conflictedTrips(assignments);
  const outside = !sameMonth(day, anchor) ? 'opacity-40' : '';
  const isToday = day === today();
  const isSelected = day === selected;

  const shown = assignments.slice(0, CONFIG.CALENDAR_DAY_CHIPS);
  const chips = shown
    .map(
      (a) => `<span class="block truncate text-[10px] leading-tight rounded px-1 ${
        conflicts.has(a.trip_id) ? 'bg-warning/30' : 'bg-base-300'
      }">${escHtml(a.tracker_nickname)}</span>`
    )
    .join('');
  const more =
    assignments.length > shown.length
      ? `<span class="block text-[10px] leading-tight opacity-60">+${
          assignments.length - shown.length
        }</span>`
      : '';

  return `<a href="${escHtml(ctx.href({ type: 'assignments', date: day }))}"
     data-nav="${escHtml(JSON.stringify({ type: 'assignments', date: day }))}"
     class="block rounded-md border p-1 min-h-12 hover:bg-base-200 ${outside}
            ${isSelected ? 'border-primary bg-base-200' : 'border-base-300'}">
    <span class="block text-[11px] tabular-nums ${
      isToday ? 'font-bold underline' : 'opacity-60'
    }">${dayOfMonth(day)}</span>
    ${chips}${more}
  </a>`;
}

function renderGrid(
  ctx: RenderContext,
  anchor: ServiceDate,
  selected: ServiceDate | null
): string {
  const headers = WEEKDAY_LABELS.map(
    (label) =>
      `<div class="text-[10px] uppercase tracking-wide opacity-50 text-center">${escHtml(
        label.slice(0, 2)
      )}</div>`
  ).join('');
  const cells = monthGrid(anchor)
    .map((day) => renderDay(ctx, day, anchor, selected))
    .join('');

  return `<div class="grid grid-cols-7 gap-1">${headers}${cells}</div>`;
}

// ─── The day agenda ───────────────────────────────────────────────────────────

/** The exception, if any, this rule already carries for this date. */
function exceptionOn(rule: TrackerRule | undefined, date: ServiceDate) {
  return rule?.exceptions.find((e) => e.date === date);
}

function renderAssignmentRow(
  ctx: RenderContext,
  assignment: Assignment,
  date: ServiceDate,
  conflicted: boolean
): string {
  const rule = ctx.session.rules?.get(assignment.rule_id);
  const added = exceptionOn(rule, date)?.exception_type === 'added';

  return `<li class="rounded-lg border ${
    conflicted ? 'border-warning' : 'border-base-300'
  } p-2 space-y-1">
    <div class="flex items-center justify-between gap-2 min-w-0">
      <span class="min-w-0 truncate text-sm">${entityLink(
        ctx,
        { type: 'tracker', tracker_id: assignment.tracker_id },
        assignment.tracker_nickname
      )}</span>
      <span class="text-xs tabular-nums opacity-70 shrink-0">${escHtml(
        formatWindow(assignment.start_time, assignment.end_time)
      )}</span>
    </div>
    <div class="text-xs min-w-0 truncate">${tripLink(ctx, assignment.trip_id)}</div>
    ${
      conflicted
        ? `<p class="text-xs text-warning">Another tracker is assigned to this trip today. The
           published feed will carry two vehicles claiming the same run.</p>`
        : ''
    }
    ${rule ? `<p class="text-xs opacity-50">${escHtml(describeRecurrence(rule))}</p>` : ''}
    <div class="flex flex-wrap gap-1">
      ${actionButton('assign:edit', String(assignment.rule_id), 'Edit')}
      ${
        added
          ? actionButton(
              'assign:unexcept',
              `${assignment.rule_id}:${date}`,
              'Undo this date'
            )
          : actionButton('assign:skip', `${assignment.rule_id}:${date}`, 'Skip this day')
      }
      ${actionButton(
        'assign:delete',
        String(assignment.rule_id),
        'Delete rule',
        'btn-outline btn-error'
      )}
    </div>
  </li>`;
}

/**
 * Rules that exist but do not run on the selected day, each with a one-click
 * way to make them.
 *
 * This is the other half of the exception model: "skip this day" lives on a
 * row that is there, and "run it after all" has to live somewhere a row is
 * not. Closed by default, because on a normal day it is every other rule.
 */
function renderOtherRules(
  ctx: RenderContext,
  date: ServiceDate,
  running: Set<number>
): string {
  const rules = [...(ctx.session.rules?.values() ?? [])].filter((r) => !running.has(r.id));
  if (rules.length === 0) return '';

  const rows = rules
    .slice(0, CONFIG.TREE_LIST_MAX)
    .map((rule) => {
      const tracker = ctx.session.trackers.get(rule.tracker_id);
      const removed = exceptionOn(rule, date)?.exception_type === 'removed';
      return `<li class="flex items-center gap-2 min-w-0 py-0.5">
        <span class="min-w-0 truncate">${escHtml(tracker?.nickname ?? rule.tracker_id)}
          <span class="opacity-50">·</span> ${tripLink(ctx, rule.trip_id)}</span>
        <span class="ml-auto shrink-0">${
          removed
            ? actionButton('assign:unexcept', `${rule.id}:${date}`, 'Un-skip')
            : actionButton('assign:add-day', `${rule.id}:${date}`, 'Run this day')
        }</span>
      </li>`;
    })
    .join('');

  return `
    <details class="rounded-lg border border-base-300 mt-2" data-detail="assign:other">
      <summary class="cursor-pointer px-3 py-2 text-xs font-medium">
        Rules not running this day
        <span class="opacity-50 tabular-nums">${rules.length}</span>
      </summary>
      <ul class="px-3 pb-3 text-xs">${rows}</ul>
    </details>`;
}

function renderAgenda(ctx: RenderContext, date: ServiceDate): string {
  const assignments = ctx.session.assignmentsOn(date);
  const conflicts = conflictedTrips(assignments);
  const running = new Set(assignments.map((a) => a.rule_id));

  const body = assignments.length
    ? `<ul class="space-y-2">${assignments
        .map((a) => renderAssignmentRow(ctx, a, date, conflicts.has(a.trip_id)))
        .join('')}</ul>`
    : '<p class="text-xs opacity-60">Nothing is assigned on this day.</p>';

  return section(
    dayLabel(date),
    `${body}
     <div class="mt-2">${actionButton(
       'assign:new',
       date,
       'Assign a tracker',
       'btn-primary'
     )}</div>
     ${renderOtherRules(ctx, date, running)}`
  );
}

// ─── The page ─────────────────────────────────────────────────────────────────

/** Every rule on the feed, for editing one the current month never shows. */
function renderAllRules(ctx: RenderContext): string {
  const rules = [...(ctx.session.rules?.values() ?? [])].sort((a, b) => a.id - b.id);
  if (rules.length === 0) return '';

  const rows = rules
    .map((rule) => {
      const tracker = ctx.session.trackers.get(rule.tracker_id);
      return `<li class="py-1 space-y-0.5">
        <div class="flex items-center gap-2 min-w-0">
          <span class="min-w-0 truncate">${escHtml(tracker?.nickname ?? rule.tracker_id)}
            <span class="opacity-50">·</span> ${tripLink(ctx, rule.trip_id)}</span>
          <span class="ml-auto shrink-0 flex gap-1">
            ${actionButton('assign:edit', String(rule.id), 'Edit')}
            ${actionButton('assign:delete', String(rule.id), 'Delete', 'btn-outline btn-error')}
          </span>
        </div>
        <p class="opacity-50">${escHtml(describeRecurrence(rule))} · ${escHtml(
          formatWindow(rule.start_time, rule.end_time)
        )}</p>
      </li>`;
    })
    .join('');

  return `
    <details class="rounded-lg border border-base-300" data-detail="assign:rules">
      <summary class="cursor-pointer px-3 py-2 text-sm font-semibold flex justify-between gap-2">
        <span>All rules</span>
        <span class="opacity-50 tabular-nums font-normal">${rules.length}</span>
      </summary>
      <ul class="px-3 pb-3 text-xs">${rows}</ul>
    </details>`;
}

export function renderAssignmentsPage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'assignments' }>
): string {
  const session = ctx.session;
  if (!session.feed) return '<p class="text-sm opacity-60">No feed is selected.</p>';

  const anchor = anchorDate(state);
  const selected = isServiceDate(state.date) ? state.date : null;
  const range = gridRange(anchor);
  // The window is fetched by `AppState` on every focus change, so a grid whose
  // range the session does not cover is one whose request is still out.
  const loaded =
    session.assignmentsRange !== null &&
    session.assignmentsRange.from <= range.from &&
    session.assignmentsRange.to >= range.to;

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">Assignments</h2>
        <p class="text-xs opacity-60">Which tracker is running which trip, by service date in
        the feed's own timezone.</p>
      </div>

      ${renderNav(anchor, ctx)}
      ${
        loaded
          ? ''
          : '<p class="text-xs opacity-60">Loading this month…</p>'
      }
      ${renderGrid(ctx, anchor, selected)}

      ${
        selected
          ? renderAgenda(ctx, selected)
          : `<p class="text-xs opacity-60">Pick a day to see what runs on it, and to add or
             change an assignment.</p>`
      }

      ${renderAllRules(ctx)}

      ${section(
        'In view',
        propList([
          prop('Assignments', String([...session.assignments.values()].flat().length)),
          prop('Rules', session.rules ? String(session.rules.size) : '…'),
        ])
      )}
    </div>`;
}
