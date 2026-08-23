/**
 * The assignments page: the weeks a feed is planned over, each openable, each
 * a waterfall of trips against days.
 *
 * yard-master's own page, and the feature the rest of the app was shaped
 * around. It is drawn with `timeline-chart.ts` in its `day` unit, which is the
 * same chart the services page draws in weeks: one row per object, one column
 * per date, the shading saying when it runs. Before this the page invented a
 * month grid, its own selection styling and its own conflict highlight, none of
 * which appeared anywhere else in the family.
 *
 * A row is a trip a rule already touches in that week — a feed has tens of
 * thousands of trips and almost none of them are assigned, so the rows come
 * from the rules rather than from the schedule — and a cell carries whichever
 * tracker is running that trip that day.
 *
 * Three things this page never does itself:
 *
 * - **Expand a rule.** The occurrences come from `GET /feeds/{id}/assignments`,
 *   which shares its expansion with the resolver that decides what a tracker is
 *   running. A grid that re-implemented the recurrence would eventually
 *   disagree with the pipeline about which day a rule runs, and disagree
 *   silently.
 * - **Resolve a trip.** An assignment names a `trip_id`, and the loaded
 *   schedule may not contain it: a feed can be reloaded out from under a rule.
 *   Such a row still renders, as its bare id, because it is still real and
 *   still needs deleting or repointing.
 * - **Write anything.** A cell opens `assign:day`, which is where the three
 *   writes a day can take live: edit the rule, skip this date, run this date.
 *
 * Every date here is a service date in feed-local time — the date a window
 * *starts* — so an overnight run appears once, on the day it started, with an
 * end time past 24:00.
 */

import { CONFIG } from '../../config';
import type { Assignment, TrackerRule } from '../../types/api';
import type { PageState } from '../../types/page-state';
import { cappedNote, entityRow, entityRowList, rowSection } from '../entity-row';
import type { RenderContext } from '../render-utils';
import { entityLink, escHtml, prop, propList, section } from '../render-utils';
import { actionButton, describeRecurrence, formatWindow } from '../managed-render';
import { renderTriangleIcon } from '../modal-utils';
import { tripName } from '../trip-picker';
import { renderTimelineChart, type TimelineRow } from '../timeline-chart';
import {
  addDays,
  dayOfMonth,
  isServiceDate,
  shortDayLabel,
  startOfWeek,
  today,
  WEEKDAY_LABELS,
  weekdayIndex,
  type ServiceDate,
} from '../service-date';

/** The days the listed weeks cover, which is the window that is fetched. */
export function gridRange(anchor: ServiceDate): { from: ServiceDate; to: ServiceDate } {
  const from = startOfWeek(anchor);
  return { from, to: addDays(from, CONFIG.ASSIGNMENT_WEEKS * 7 - 1) };
}

/** The week a state is looking at: its selected day's, or this one. */
export function anchorDate(state: Extract<PageState, { type: 'assignments' }>): ServiceDate {
  return isServiceDate(state.date) ? state.date : today();
}

/** A rule is in a week when its own range overlaps it. Open-ended runs on. */
function touchesWeek(rule: TrackerRule, from: ServiceDate, to: ServiceDate): boolean {
  return rule.start_date <= to && (rule.end_date === null || rule.end_date >= from);
}

// ─── One week's worth of rows ─────────────────────────────────────────────────

interface WeekData {
  start: ServiceDate;
  end: ServiceDate;
  days: ServiceDate[];
  /** Every occurrence in the week, for the summary count. */
  assignments: Assignment[];
  /** trip_id -> date -> the trackers running it that day. */
  byTrip: Map<string, Map<ServiceDate, Assignment[]>>;
  /** trip_id -> date -> the exception a rule on that trip carries. */
  exceptions: Map<string, Map<ServiceDate, 'added' | 'removed'>>;
  /** Row order: the trips any rule touches, plus any the expansion names. */
  trips: string[];
  /** Trip/date pairs claimed by two different trackers. */
  conflicts: number;
}

function weekData(ctx: RenderContext, start: ServiceDate): WeekData {
  const end = addDays(start, 6);
  const days: ServiceDate[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);

  const assignments: Assignment[] = [];
  const byTrip = new Map<string, Map<ServiceDate, Assignment[]>>();
  let conflicts = 0;

  for (const day of days) {
    for (const assignment of ctx.session.assignmentsOn(day)) {
      assignments.push(assignment);
      const dates = byTrip.get(assignment.trip_id) ?? new Map<ServiceDate, Assignment[]>();
      const cell = dates.get(day) ?? [];
      cell.push(assignment);
      dates.set(day, cell);
      byTrip.set(assignment.trip_id, dates);
      // Counted on the second *distinct* tracker only: one tracker held by two
      // overlapping rules is redundant, not contradictory.
      if (cell.length > 1 && new Set(cell.map((a) => a.tracker_id)).size === 2) conflicts++;
    }
  }

  // A rule the week does not run adds its trip anyway, so the row is there to
  // add a date to. This is the other half of the exception model: "run it after
  // all" has to live somewhere a cell is not already filled.
  const exceptions = new Map<string, Map<ServiceDate, 'added' | 'removed'>>();
  const trips = new Set(byTrip.keys());
  for (const rule of ctx.session.rules?.values() ?? []) {
    if (!touchesWeek(rule, start, end)) continue;
    trips.add(rule.trip_id);
    for (const exception of rule.exceptions) {
      if (exception.date < start || exception.date > end) continue;
      const dates = exceptions.get(rule.trip_id) ?? new Map<ServiceDate, 'added' | 'removed'>();
      dates.set(exception.date, exception.exception_type);
      exceptions.set(rule.trip_id, dates);
    }
  }

  return {
    start,
    end,
    days,
    assignments,
    byTrip,
    exceptions,
    trips: sortTrips(ctx, [...trips]),
    conflicts,
  };
}

/**
 * Row order: first departure, then id.
 *
 * Sorted on the raw clock string, since GTFS times are zero-padded and may run
 * past 24:00, which makes lexicographic order departure order.
 */
function sortTrips(ctx: RenderContext, trips: string[]): string[] {
  const feed = ctx.session.staticFeed;
  const departure = (tripId: string): string =>
    feed?.stopTimesByTrip.get(tripId)?.[0]?.departure_time ?? '';
  return trips.sort((a, b) => departure(a).localeCompare(departure(b)) || a.localeCompare(b));
}

/** The button that fills a cell. Clicking it is `assign:day` on that date. */
function cellButton(tripId: string, date: ServiceDate, inner: string): string {
  // The date is first and fixed-width, because a trip_id may itself contain a
  // colon and the action splits this back apart on offset, not on separator.
  return `<button type="button" data-action="assign:day"
    data-arg="${escHtml(`${date}:${tripId}`)}"
    class="flex h-5 w-full items-center justify-center gap-0.5 rounded px-0.5
           hover:bg-base-content/10">${inner}</button>`;
}

/** The tick that says a date was changed by hand rather than by the weekdays. */
function exceptionGlyph(kind: 'added' | 'removed' | undefined): string {
  if (!kind) return '';
  const added = kind === 'added';
  return `<span class="inline-flex shrink-0 ${added ? 'text-success' : 'text-error'}"
    >${renderTriangleIcon(`h-2.5 w-2.5 ${added ? '-rotate-90' : 'rotate-90'}`)}</span>`;
}

function weekRows(ctx: RenderContext, week: WeekData): TimelineRow[] {
  const feed = ctx.session.staticFeed;

  return week.trips.map((tripId) => {
    const trip = feed?.trips.get(tripId);
    const route = trip ? feed?.routes.get(trip.route_id) : undefined;
    const label = trip ? tripName(trip) : tripId;

    return {
      key: tripId,
      label,
      labelHtml: trip
        ? entityLink(
            ctx,
            { type: 'trip', trip_id: tripId, ...(trip.route_id ? { route_id: trip.route_id } : {}) },
            label,
            'link link-hover'
          )
        : `<span class="font-mono opacity-70">${escHtml(tripId)}</span>`,
      ...(route ? { color: route.color } : {}),
      // Nothing is shaded by span here: a day either has a tracker on it or it
      // does not, and that is what the cell renderer paints.
      spans: [],
      title: trip ? label : `${tripId} is not in the loaded schedule`,
    };
  });
}

function renderWeekChart(ctx: RenderContext, week: WeekData): string {
  const rows = weekRows(ctx, week);

  return renderTimelineChart(rows, {
    unit: 'day',
    from: week.start,
    to: week.end,
    emptyMessage: 'No rule touches this week.',
    cellRenderer: (row, column) => {
      const date = column.start;
      const running = week.byTrip.get(row.key)?.get(date) ?? [];
      const trackers = new Set(running.map((a) => a.tracker_id));
      const glyph = exceptionGlyph(week.exceptions.get(row.key)?.get(date));

      // Two rules on one tracker is one nickname, not a count: only a second
      // *tracker* is worth spending the cell on.
      const label =
        trackers.size === 0
          ? ''
          : trackers.size === 1
            ? running[0].tracker_nickname
            : `${trackers.size} trackers`;
      const tooltip = running.length
        ? running
            .map((a) => `${a.tracker_nickname} ${formatWindow(a.start_time, a.end_time)}`)
            .join(' · ')
        : `Nothing runs this trip on ${date}`;

      return {
        html: cellButton(
          row.key,
          date,
          `${glyph}<span class="truncate">${escHtml(label)}</span>`
        ),
        // The row draws no spans, so the shading is the cell's alone: a day
        // with a tracker on it is painted in the trip's route colour, and an
        // empty one is left as background.
        ...(running.length ? { color: row.color ?? 'var(--color-primary)' } : {}),
        tooltip,
        conflict: trackers.size > 1,
      };
    },
  });
}

/** The seven days of a week as links, which is how the map's day is chosen. */
function renderDayPicker(ctx: RenderContext, week: WeekData, selected: ServiceDate | null): string {
  const buttons = week.days
    .map((day) =>
      entityLink(
        ctx,
        { type: 'assignments', date: day },
        `${WEEKDAY_LABELS[weekdayIndex(day)]} ${dayOfMonth(day)}`,
        `btn btn-xs ${day === selected ? 'btn-primary' : 'btn-ghost'}`
      )
    )
    .join('');
  return `<div class="flex flex-wrap gap-1">${buttons}</div>`;
}

function renderWeekBody(
  ctx: RenderContext,
  week: WeekData,
  selected: ServiceDate | null
): string {
  return `
    ${renderDayPicker(ctx, week, selected)}
    ${renderWeekChart(ctx, week)}
    <p class="text-xs opacity-50">A cell is the tracker running that trip that day. Clicking one
      offers the three writes a day can take: edit the rule, skip this date, or run it after all.
      A triangle marks a date already <span class="text-success">added</span> or
      <span class="text-error">removed</span> by hand.</p>
    <div>${actionButton('assign:new', week.start, 'Assign a trip', 'btn-primary')}</div>`;
}

/** What a week says about itself when it is closed. */
function weekSummary(week: WeekData): string {
  const conflicts = week.conflicts
    ? `<span class="badge badge-warning badge-xs">${week.conflicts} conflict${
        week.conflicts === 1 ? '' : 's'
      }</span>`
    : '';
  return `<span class="flex items-center gap-2 min-w-0">
      <span class="truncate">${escHtml(
        `${shortDayLabel(week.start)} – ${shortDayLabel(week.end)}`
      )}</span>
      <span class="ml-auto flex items-center gap-2 shrink-0">
        ${conflicts}
        <span class="opacity-50 tabular-nums font-normal">${week.assignments.length}</span>
      </span>
    </span>`;
}

/**
 * The anchored week, always open, and the rest as disclosures.
 *
 * The anchored one is a plain section rather than a `<details>` on purpose: a
 * page that forced a disclosure open would fight the panel, which restores what
 * the reader opened on every re-render and would keep reopening a week they had
 * just closed. Picking a day in another week re-anchors it instead.
 */
function renderWeek(
  ctx: RenderContext,
  week: WeekData,
  selected: ServiceDate | null,
  anchored: boolean
): string {
  if (anchored) {
    return section(
      `Week of ${shortDayLabel(week.start)}`,
      `<div class="space-y-2">${renderWeekBody(ctx, week, selected)}</div>`,
      week.conflicts
        ? `<span class="badge badge-warning badge-xs ml-2">${week.conflicts} conflict${
            week.conflicts === 1 ? '' : 's'
          }</span>`
        : ''
    );
  }

  return `
    <details class="rounded-lg border border-base-300" data-detail="assign:week:${escHtml(
      week.start
    )}">
      <summary class="cursor-pointer px-3 py-2 text-sm font-medium">${weekSummary(week)}</summary>
      <div class="px-3 pb-3 space-y-2">${renderWeekBody(ctx, week, selected)}</div>
    </details>`;
}

// ─── The page ─────────────────────────────────────────────────────────────────

function renderNav(ctx: RenderContext, from: ServiceDate, to: ServiceDate): string {
  const jump = (date: ServiceDate, label: string): string =>
    entityLink(ctx, { type: 'assignments', date }, label, 'btn btn-xs btn-ghost');
  const step = CONFIG.ASSIGNMENT_WEEKS * 7;

  return `
    <div class="flex items-center justify-between gap-2">
      ${jump(addDays(from, -step), '‹')}
      <span class="text-sm font-semibold">${escHtml(
        `${shortDayLabel(from)} – ${shortDayLabel(to)}`
      )}</span>
      <span class="flex gap-1">
        ${jump(today(), 'Today')}
        ${jump(addDays(from, step), '›')}
      </span>
    </div>`;
}

/** Every rule on the feed, for reaching one no listed week shows. */
function renderAllRules(ctx: RenderContext): string {
  const rules = [...(ctx.session.rules?.values() ?? [])];
  if (rules.length === 0) return '';

  const feed = ctx.session.staticFeed;
  const nickname = (rule: TrackerRule): string =>
    ctx.session.trackers.get(rule.tracker_id)?.nickname ?? rule.tracker_id;
  rules.sort((a, b) => nickname(a).localeCompare(nickname(b)) || a.id - b.id);

  const shown = rules.slice(0, CONFIG.RULE_LIST_MAX);
  const rows = shown.map((rule) => {
    const trip = feed?.trips.get(rule.trip_id);
    return entityRow(ctx, {
      state: { type: 'tracker', tracker_id: rule.tracker_id },
      label: nickname(rule),
      sublabel: `${trip ? tripName(trip) : rule.trip_id} · ${describeRecurrence(rule)} · ${formatWindow(
        rule.start_time,
        rule.end_time
      )}`,
      actionsHtml: `${actionButton('assign:edit', String(rule.id), 'Edit')}${actionButton(
        'assign:delete',
        String(rule.id),
        'Delete',
        'btn-outline btn-error'
      )}`,
    });
  });

  return rowSection(
    'All rules',
    rules.length,
    `${entityRowList(rows, 'No rule is on this feed.')}${cappedNote(rules.length, shown.length)}`
  );
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
  // The window is fetched by `AppState` on every focus change, so a range the
  // session does not cover is one whose request is still out.
  const loaded =
    session.assignmentsRange !== null &&
    session.assignmentsRange.from <= range.from &&
    session.assignmentsRange.to >= range.to;

  const anchorWeek = startOfWeek(anchor);
  const weeks: string[] = [];
  for (let start = range.from; start <= range.to; start = addDays(start, 7)) {
    weeks.push(renderWeek(ctx, weekData(ctx, start), selected, start === anchorWeek));
  }

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">Assignments</h2>
        <p class="text-xs opacity-60">Which tracker is running which trip, by service date in
        the feed's own timezone.</p>
      </div>

      ${renderNav(ctx, range.from, range.to)}
      ${loaded ? '' : '<p class="text-xs opacity-60">Loading these weeks…</p>'}

      <div class="space-y-2">${weeks.join('')}</div>

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
