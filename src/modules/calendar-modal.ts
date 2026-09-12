/* @vendored-from coloring-book:src/modules/calendar-modal.ts
   @sha dca23b3
   @status modified
   @changes
   - The chips are this repo's: a service chip and an assignment chip, coloured
     by route where the trip has one, each a link where coloring-book's is a
     click handler
   - Data comes from a FeedSession's serviceCatalog/assignmentsOn, not an
     IndexedDB read through ServiceTimelineSource
   - The month grid's leading/trailing cells are real neighbouring-month days
     from monthGrid(), not blank filler cells
   - The timeline half (renderRuleChart/renderTimeline) has no counterpart
     upstream; coloring-book's service-timeline.ts answers a different question
   - The header combines the month nav and the tab bar in one row; upstream
     keeps them separate */

/**
 * The calendar: one month of the feed at a time, and the same waterfall the
 * rest of the app draws.
 *
 * Two questions are asked of a feed's calendar and
 * they have different shapes: "does this run today" is a month grid, and "who
 * is covering it over the next few weeks" is the timeline chart. Both are here,
 * as two tabs over one set of data, because the answer to either is the other
 * half of the same plan.
 *
 * It lives off the navbar rather than in the panel, so it can be opened from
 * any page without losing the object the reader was on. That is also why every
 * link inside it is delegated here rather than by `PanelRenderer`: the modal is
 * mounted on `document.body`, outside the panel host, so the panel's `data-nav`
 * handler never sees these clicks. The markup is the same — a real `<a href>`
 * carrying the target hash — so middle-click and copy-link-address still work;
 * a plain click closes the modal first and then navigates, since the page
 * behind it is about to change.
 *
 * Rows and chips are read-only. A tracker chip is the way to the object that
 * owns the rule, which is where a write to it lives.
 */

import { CONFIG } from '../config';
import type { Assignment, TrackerRule } from '../types/api';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';
import { showModal } from './modal-utils';
import { formatWindow } from './managed-render';
import type { RenderContext } from './render-utils';
import { escHtml, section } from './render-utils';
import {
  serviceCatalog,
  serviceRunsOn,
  sortByCascade,
  type ServiceSummary,
} from './service-catalog';
import {
  addDays,
  addMonths,
  dayLabel,
  dayOfMonth,
  monthGrid,
  monthLabel,
  sameMonth,
  startOfMonth,
  today,
  WEEKDAY_LABELS,
  type ServiceDate,
} from './service-date';
import { assignmentCounts } from './service-catalog';
import { renderTimelineChart, weekdayFlags, type TimelineRow } from './timeline-chart';
import { tripName } from './trip-picker';

export interface CalendarModalHooks {
  ctx: RenderContext;
  /** Navigate the panel. Called after the modal has closed. */
  navigate: (state: PageState) => void;
  /** Expand the rules over a window, widening whatever is held. */
  ensureAssignments: (from: ServiceDate, to: ServiceDate) => Promise<void>;
  /** Load the feed's rules if they are not already in the session. */
  ensureRules: () => Promise<void>;
}

type CalendarTab = 'grid' | 'timeline';

/**
 * What the navbar badge says: the assignments running today.
 *
 * Null when the answer is not known yet — no feed, or an expansion window that
 * does not reach today — because a badge showing 0 would claim nothing is
 * running when nothing has been asked.
 */
export function calendarBadgeCount(session: FeedSession): number | null {
  if (!session.feed) return null;
  const range = session.assignmentsRange;
  const date = today();
  if (!range || range.from > date || range.to < date) return null;
  return session.assignmentsOn(date).length;
}

// ─── The month grid ───────────────────────────────────────────────────────────

/** A link inside the modal: a real anchor, navigated by the modal's own handler. */
function chipLink(
  ctx: RenderContext,
  state: PageState,
  label: string,
  className: string,
  style = '',
  title = label
): string {
  return `<a href="${escHtml(ctx.href(state))}" data-nav="${escHtml(JSON.stringify(state))}"
    class="${className}" style="${style}" title="${escHtml(title)}">${escHtml(label)}</a>`;
}

const CHIP_CLASS = 'block truncate rounded px-1 text-[10px] leading-4 hover:brightness-110';

/**
 * One service running that day, in the accent.
 *
 * A chip rather than a link: a service is not an object this app browses, so
 * the id is a fact about the day and nothing more.
 */
function serviceChip(service: ServiceSummary): string {
  return `<span class="${CHIP_CLASS} bg-primary/15 text-primary font-mono"
    title="${escHtml(`Service ${service.id}`)}">${escHtml(service.id)}</span>`;
}

/**
 * One tracker running one trip that day.
 *
 * Coloured by the trip's route where the zip has it, so the chips agree with
 * the map and with every chart in the app. The label is the nickname, which is
 * what the map draws, and the title carries the trip and the window.
 */
function assignmentChip(ctx: RenderContext, assignment: Assignment): string {
  const feed = ctx.session.scheduledFeed;
  const trip = feed?.trips.get(assignment.trip_id);
  const route = trip ? feed?.routes.get(trip.route_id) : undefined;
  const style = route
    ? `background:color-mix(in srgb, ${escHtml(route.color)} 22%, transparent)`
    : '';
  return chipLink(
    ctx,
    { type: 'tracker', tracker_id: assignment.tracker_id },
    assignment.tracker_nickname,
    `${CHIP_CLASS} ${route ? '' : 'bg-base-content/10'}`,
    style,
    `${assignment.tracker_nickname} - ${trip ? tripName(trip) : assignment.trip_id} - ${formatWindow(
      assignment.start_time,
      assignment.end_time
    )}`
  );
}

function renderDayCell(
  ctx: RenderContext,
  date: ServiceDate,
  month: ServiceDate,
  services: readonly ServiceSummary[]
): string {
  const assignments = ctx.session.assignmentsOn(date);
  const running = services.filter((service) => serviceRunsOn(service, date));
  const chips = [
    ...running.map((service) => serviceChip(service)),
    ...assignments.map((assignment) => assignmentChip(ctx, assignment)),
  ];

  const isToday = date === today();
  const outside = !sameMonth(date, month);

  return `<div class="min-h-16 p-1 rounded bg-base-200/20 border overflow-hidden ${
    outside ? 'border-base-300/30 opacity-40' : 'border-base-300/30'
  }${isToday ? ' ring-1 ring-primary bg-primary/5' : ''}">
    <span class="block text-[11px] leading-4 tabular-nums font-medium opacity-70
      ${isToday ? 'text-primary font-bold' : ''}" title="${escHtml(dayLabel(date))}"
      >${dayOfMonth(date)}</span>
    <div class="max-h-24 overflow-y-auto overscroll-contain">
      <div class="flex flex-col gap-0.5">${chips.join('')}</div>
    </div>
  </div>`;
}

function renderGrid(ctx: RenderContext, month: ServiceDate): string {
  const feed = ctx.session.scheduledFeed;
  const services = feed ? sortByCascade([...serviceCatalog(feed).values()]) : [];
  const days = monthGrid(month);

  const header = WEEKDAY_LABELS.map(
    (label) =>
      `<div class="text-center text-[10px] uppercase tracking-wide opacity-50">${escHtml(
        label
      )}</div>`
  ).join('');

  return `
    <div class="space-y-1">
      <div class="grid grid-cols-7 gap-1">${header}</div>
      <div class="grid grid-cols-7 gap-1">${days
        .map((date) => renderDayCell(ctx, date, month, services))
        .join('')}</div>
      <p class="text-xs opacity-50">A chip is a service running that day, or a tracker assigned
        to a trip. A tracker chip opens that tracker.</p>
    </div>`;
}

// ─── The timeline ─────────────────────────────────────────────────────────────

/**
 * One rule as a chart row: its own date range as the span, its weekdays as the
 * dots, and its exceptions as the ticks over the top.
 *
 * An open-ended rule is drawn to `CONFIG.CALENDAR_OPEN_END_DAYS` past today
 * rather than forever, and says so in its tooltip. Nothing in the chart is
 * infinite; a span has to name a last date.
 */
function ruleRow(ctx: RenderContext, rule: TrackerRule, openEnd: ServiceDate): TimelineRow {
  const feed = ctx.session.scheduledFeed;
  const trip = feed?.trips.get(rule.trip_id);
  const route = trip ? feed?.routes.get(trip.route_id) : undefined;
  const nickname = ctx.session.trackers.get(rule.tracker_id)?.nickname ?? rule.tracker_id;
  const label = `${nickname} - ${trip ? tripName(trip) : rule.trip_id}`;
  const end = rule.end_date ?? openEnd;

  return {
    key: String(rule.id),
    label,
    labelHtml: chipLink(
      ctx,
      { type: 'tracker', tracker_id: rule.tracker_id },
      label,
      'link link-hover truncate'
    ),
    ...(route ? { color: route.color } : { color: 'var(--color-primary)' }),
    spans:
      rule.start_date <= end
        ? [
            {
              from: rule.start_date,
              to: end,
              tooltip: `${label} - ${formatWindow(rule.start_time, rule.end_time)} - ${
                rule.end_date ? `${rule.start_date} to ${rule.end_date}` : `from ${rule.start_date}, no end date`
              }`,
            },
          ]
        : [],
    weekdays: weekdayFlags(rule),
    ticks: rule.exceptions.map((exception) => ({
      date: exception.date,
      kind: exception.exception_type,
    })),
    title: label,
  };
}

function renderRuleChart(ctx: RenderContext, month: ServiceDate): string {
  const rules = [...(ctx.session.rules?.values() ?? [])];
  if (ctx.session.rules === null) {
    return '<p class="text-xs opacity-60">Loading rules…</p>';
  }

  // Far enough past today that an open-ended rule reads as continuing, and at
  // least to the end of the month being shown.
  const monthEnd = addDays(addMonths(startOfMonth(month), 1), -1);
  const openEndDefault = addDays(today(), CONFIG.CALENDAR_OPEN_END_DAYS);
  const openEnd = monthEnd > openEndDefault ? monthEnd : openEndDefault;

  rules.sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id - b.id);

  return renderTimelineChart(
    rules.map((rule) => ruleRow(ctx, rule, openEnd)),
    { emptyMessage: 'No tracker is assigned to a trip on this feed.' }
  );
}

function unassignedLine(ctx: RenderContext): string {
  const feed = ctx.session.scheduledFeed;
  if (!feed) return '';
  const counts = assignmentCounts(ctx.session, feed.trips.keys());
  if (!counts) return '';
  const unassigned = counts.total - counts.assigned;
  if (unassigned === 0) return '';
  return `<p class="text-xs opacity-50">${unassigned} of ${counts.total} trips on this feed have no
    rule assigned.</p>`;
}

function renderTimeline(ctx: RenderContext, month: ServiceDate): string {
  return `
    <div class="space-y-4">
      ${section(
        'Assignments',
        `${renderRuleChart(ctx, month)}
         <p class="text-xs opacity-50">A shaded week is a week the rule runs on its weekdays. A
         triangle is a date <span class="text-success">added</span> or
         <span class="text-error">removed</span> by hand.</p>
         ${unassignedLine(ctx)}`
      )}
    </div>`;
}

// ─── The modal ────────────────────────────────────────────────────────────────

function renderHeader(month: ServiceDate, tab: CalendarTab): string {
  const tabButton = (key: CalendarTab, label: string): string =>
    `<button type="button" role="tab" data-cal-tab="${key}"
      class="tab ${tab === key ? 'tab-active' : ''}">${label}</button>`;

  return `
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-1">
        <button type="button" class="btn btn-xs btn-ghost" data-cal-month="-1">‹</button>
        <span class="text-sm font-semibold w-36 text-center">${escHtml(monthLabel(month))}</span>
        <button type="button" class="btn btn-xs btn-ghost" data-cal-month="1">›</button>
        <button type="button" class="btn btn-xs btn-ghost" data-cal-today>Today</button>
      </div>
      <div role="tablist" class="tabs tabs-border tabs-sm">
        ${tabButton('grid', 'Month grid')}${tabButton('timeline', 'Timeline')}
      </div>
    </div>`;
}

/** Whether the session already holds the expansion the grid is drawing. */
function covers(session: FeedSession, from: ServiceDate, to: ServiceDate): boolean {
  const range = session.assignmentsRange;
  return range !== null && range.from <= from && range.to >= to;
}

/**
 * Open the calendar.
 *
 * The modal owns its own re-rendering: it redraws on the session events that
 * can change what it says, exactly as the panel does, so an expansion that
 * arrives after it opened fills the grid in place rather than leaving it empty
 * until the reader clicks something.
 */
export async function showCalendarModal(hooks: CalendarModalHooks): Promise<void> {
  const { ctx } = hooks;
  const session = ctx.session;

  let month = startOfMonth(today());
  let tab: CalendarTab = 'timeline';
  let root: HTMLElement | null = null;

  const draw = (): void => {
    if (!root) return;
    const days = monthGrid(month);
    const loading =
      session.feed && !covers(session, days[0], days[days.length - 1])
        ? '<p class="text-xs opacity-60">Loading this month…</p>'
        : '';

    root.innerHTML = `
      <div class="space-y-3">
        ${renderHeader(month, tab)}
        ${loading}
        ${
          session.feed
            ? tab === 'grid'
              ? renderGrid(ctx, month)
              : renderTimeline(ctx, month)
            : '<p class="text-sm opacity-60">No feed is selected.</p>'
        }
      </div>`;
  };

  /** The month on screen, and the rules behind both tabs. */
  const load = (): void => {
    if (!session.feed) return;
    const days = monthGrid(month);
    void hooks.ensureAssignments(days[0], days[days.length - 1]);
    void hooks.ensureRules();
  };

  const onSessionChange = (): void => draw();
  for (const event of ['change', 'assignments', 'scheduleloaded'] as const) {
    session.addEventListener(event, onSessionChange);
  }

  await showModal({
    title: 'Calendar',
    body: '<div data-calendar-root></div>',
    actions: [{ label: 'Close', onClick: () => {} }],
    enterAction: 0,
    escapeAction: 0,
    boxClassName: 'max-w-5xl',
    onMount: (close) => {
      root = document.querySelector<HTMLElement>('[data-calendar-root]');
      draw();
      load();

      root?.addEventListener('click', (event) => {
        const source = event.target as HTMLElement | null;

        const step = source?.closest<HTMLElement>('[data-cal-month]');
        if (step) {
          month = addMonths(month, Number(step.dataset.calMonth));
          draw();
          load();
          return;
        }
        if (source?.closest('[data-cal-today]')) {
          month = startOfMonth(today());
          draw();
          load();
          return;
        }
        const chosen = source?.closest<HTMLElement>('[data-cal-tab]');
        if (chosen) {
          tab = chosen.dataset.calTab as CalendarTab;
          draw();
          return;
        }

        // A link: the panel's delegation cannot see it from here, so the modal
        // closes itself and hands the page over.
        const link = source?.closest<HTMLElement>('[data-nav]');
        if (!link) return;
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
        event.preventDefault();
        const state = JSON.parse(link.dataset.nav!) as PageState;
        close();
        hooks.navigate(state);
      });
    },
  });

  for (const event of ['change', 'assignments', 'scheduleloaded'] as const) {
    session.removeEventListener(event, onSessionChange);
  }
}
