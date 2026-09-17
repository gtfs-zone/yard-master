/**
 * The waterfall chart: one row per object, one column per week, shaded where
 * the object runs, with per-day ticks on top of the shading.
 *
 * yard-master's own file. coloring-book's `src/modules/service-timeline.ts` is
 * the visual specification and nothing else is taken from it: the look is
 * shared across the family, the code is this repo's. What is kept from it is
 * the shape that makes the chart cheap — an HTML `<table>` of fixed-width
 * cells, so there is no SVG, no canvas and no measurement pass — the sticky
 * label column, the month header spanning its own columns, and the today
 * marker drawn as a `background-image` gradient rather than an element, which
 * is what lets one hairline run through both a `<td>` and the `<th>` above it.
 *
 * The input is deliberately generic, because two callers want it: services over
 * `calendar.txt`, and a week of tracker assignments. A row carries a key, a
 * label, a colour, the spans it runs over, the ticks that interrupt them, and
 * the caller may render the inside of any cell itself.
 *
 * **Monday first.** `service-date.ts` is Monday-first and that is what already
 * ships, so this chart is too, where coloring-book's is Sunday-first. Every
 * date here goes through `service-date.ts`; there is no second set of date
 * helpers in this file.
 *
 * Tooltips are the portaled `.field-tooltip-trigger` ones from
 * `src/utils/tooltip-position.ts`, never daisyUI's `.tooltip`, which sets
 * `display:inline-block` and would pull a cell out of the table layout.
 */

import { CONFIG } from '../config';
import { renderTriangleIcon } from 'interlocking/ui/modal-utils';
import { escHtml } from './render-utils';
import {
  addDays,
  dayLabel,
  dayOfMonth,
  monthShortLabel,
  today as todayDate,
  WEEKDAY_DISPLAY,
  WEEKDAY_KEYS,
  WEEKDAY_LABELS,
  weekdayIndex,
  type ServiceDate,
  type WeekdayKey,
} from './service-date';

/** Week columns for a range of dates, day columns for a single week. */
export type TimelineUnit = 'week' | 'day';

/** A stretch the row is active over. Both ends inclusive. */
export interface TimelineSpan {
  from: ServiceDate;
  /** Open-ended spans pass the chart's own last date; nothing here is infinite. */
  to: ServiceDate;
  /** Plain text, shown on every column the span covers. */
  tooltip?: string;
}

/** A single day that interrupts the spans: a service date added or removed. */
export interface TimelineTick {
  date: ServiceDate;
  kind: 'added' | 'removed';
  /** Plain text. Defaults to "Added <date>" / "Removed <date>". */
  tooltip?: string;
}

export interface TimelineRow {
  /** Identifies the row to the click handler. Never rendered. */
  key: string;
  label: string;
  /**
   * The label cell's markup, in place of the escaped `label`. A row that
   * navigates passes `entityLink`'s anchor here, so the panel's delegated
   * `data-nav` handler carries the click and the chart needs no listener of
   * its own. `label` is still what the column is sized from.
   */
  labelHtml?: string;
  /** The dot before the label. Any CSS colour; it also shades the spans. */
  color?: string;
  spans: TimelineSpan[];
  ticks?: TimelineTick[];
  /**
   * Seven booleans in display order, for the weekday-dot column. A row that
   * omits them renders an empty dot cell, and a chart where no row has them
   * drops the column entirely.
   */
  weekdays?: readonly boolean[];
  /** Plain text over the dots. Defaults to the day names. */
  weekdaysTooltip?: string;
  /** Cells for the caller's own extra columns, in `options.columns` order. */
  extra?: readonly string[];
  /** Hover text for the label cell. Defaults to the label. */
  title?: string;
}

/** What a caller may put inside one cell, on top of the row's own shading. */
export interface TimelineCell {
  html?: string;
  /** Overrides the row colour for this cell only. */
  color?: string;
  /** Plain text, replacing the span's tooltip on this cell. */
  tooltip?: string;
  /** Two objects claiming the same cell: a warning ring, not a fill. */
  conflict?: boolean;
}

/** An extra column between the labels and the chart. */
export interface TimelineColumn {
  header: string;
  widthPx: number;
  /** `text-right` and friends, applied to the header and to every cell. */
  className?: string;
}

export interface TimelineOptions {
  unit?: TimelineUnit;
  /** The range to draw. Defaults to the extent of the rows' spans and ticks. */
  from?: ServiceDate;
  to?: ServiceDate;
  /** Overridden only by tests; the default is today in the feed's zone. */
  today?: ServiceDate;
  columns?: readonly TimelineColumn[];
  /** Called for every cell of every row, before the ticks are laid over it. */
  cellRenderer?: (row: TimelineRow, column: TimelineColumnRange) => TimelineCell | undefined;
  /** What the chart says when it has no rows, or no dates to draw. */
  emptyMessage?: string;
}

/** One drawn column: a whole displayed week, or a single day. */
export interface TimelineColumnRange {
  start: ServiceDate;
  end: ServiceDate;
}

const ROW_CLASS = 'timeline-row';
const CELL_CLASS = 'timeline-cell';

/** The hairline through today's position, as a background rather than a border.
 *
 * A border can only ever land on a cell edge, and today is almost never on one.
 *
 * @param pct where in the cell the line sits, 0-100.
 */
function todayLineStyle(pct: number): string {
  const c = 'color-mix(in srgb, var(--color-base-content) 35%, transparent)';
  return `background-image:linear-gradient(to right, transparent calc(${pct}% - 0.5px), ${c} calc(${pct}% - 0.5px), ${c} calc(${pct}% + 0.5px), transparent calc(${pct}% + 0.5px))`;
}

/** Span shading. `color-mix` rather than a hex parse, so any CSS colour works. */
function shade(color: string): string {
  return `background-color:color-mix(in srgb, ${color} 22%, transparent)`;
}

function tooltipTrigger(text: string, content: string, className = ''): string {
  return `<span class="field-tooltip-trigger ${className}" tabindex="0"
    data-tooltip-content="${escHtml(text)}">${content}</span>`;
}

/**
 * Seven booleans out of anything with `monday`..`sunday` on it, in display
 * order, which is what the dots and the tooltip under them are drawn in.
 */
export function weekdayFlags(source: Partial<Record<WeekdayKey, unknown>>): boolean[] {
  return WEEKDAY_DISPLAY.map((i) => {
    const value = source[WEEKDAY_KEYS[i]];
    return value === true || value === 1 || value === '1';
  });
}

/** `Mon, Wed, Fri`, or the whole week said once. */
function weekdaysTooltip(flags: readonly boolean[]): string {
  const days = WEEKDAY_LABELS.filter((_, i) => flags[i]);
  if (days.length === 7) return 'Every day';
  if (days.length === 0) return 'No regular days';
  return days.join(', ');
}

function weekdayDots(flags: readonly boolean[] | undefined): string {
  if (!flags) return '';
  const dots = WEEKDAY_LABELS.map((_, i) => (flags[i] ? '●' : '○')).join('');
  return tooltipTrigger(
    weekdaysTooltip(flags),
    `<span class="font-mono tracking-tight text-base-content/70">${dots}</span>`
  );
}

/** The extent of everything the rows draw, or null when they draw nothing. */
function rowsExtent(rows: readonly TimelineRow[]): { from: ServiceDate; to: ServiceDate } | null {
  let from: ServiceDate | null = null;
  let to: ServiceDate | null = null;
  const widen = (date: ServiceDate): void => {
    if (from === null || date < from) from = date;
    if (to === null || date > to) to = date;
  };
  for (const row of rows) {
    for (const span of row.spans) {
      widen(span.from);
      widen(span.to);
    }
    // A removed tick never widens the range: it marks a day the row does not
    // run, so on its own it is not something to scroll to.
    for (const tick of row.ticks ?? []) if (tick.kind === 'added') widen(tick.date);
  }
  return from === null || to === null ? null : { from, to };
}

/** The drawn columns, and whether the requested range had to be cut short. */
function buildColumns(
  unit: TimelineUnit,
  from: ServiceDate,
  to: ServiceDate
): { columns: TimelineColumnRange[]; truncated: boolean } {
  const step = unit === 'week' ? 7 : 1;
  const start = unit === 'week' ? addDays(from, -weekdayIndex(from)) : from;
  const cap = addDays(start, CONFIG.TIMELINE_MAX_DAYS - 1);
  const truncated = to > cap;
  const last = truncated ? cap : to;

  const columns: TimelineColumnRange[] = [];
  for (let day = start; day <= last; day = addDays(day, step)) {
    columns.push({ start: day, end: addDays(day, step - 1) });
  }
  return { columns, truncated };
}

/** Month header cells, each spanning the columns that fall in that month. */
function monthSpans(columns: readonly TimelineColumnRange[]): Array<{ label: string; span: number }> {
  const spans: Array<{ label: string; span: number }> = [];
  for (const column of columns) {
    const label = monthShortLabel(column.start);
    const previous = spans[spans.length - 1];
    if (previous && previous.label === label) previous.span++;
    else spans.push({ label, span: 1 });
  }
  return spans;
}

/** Where in a column today's hairline falls, or -1 when it is not in it. */
function todayOffset(column: TimelineColumnRange, today: ServiceDate): number {
  if (today < column.start || today > column.end) return -1;
  let days = 0;
  for (let day = column.start; day < today; day = addDays(day, 1)) days++;
  return days;
}

function cellTicks(row: TimelineRow, column: TimelineColumnRange): string {
  const ticks: string[] = [];
  for (const tick of row.ticks ?? []) {
    if (tick.date < column.start || tick.date > column.end) continue;
    const added = tick.kind === 'added';
    ticks.push(
      tooltipTrigger(
        tick.tooltip ?? `${added ? 'Added' : 'Removed'} ${dayLabel(tick.date)}`,
        renderTriangleIcon(`h-2.5 w-2.5 ${added ? '-rotate-90' : 'rotate-90'}`),
        `inline-flex ${added ? 'text-success' : 'text-error'}`
      )
    );
  }
  return ticks.join('');
}

/** The span covering a column, if any. Spans are inclusive at both ends. */
function coveringSpan(row: TimelineRow, column: TimelineColumnRange): TimelineSpan | undefined {
  return row.spans.find((span) => span.from <= column.end && span.to >= column.start);
}

function emptyChart(message: string): string {
  return `<div class="flex items-center justify-center h-24 text-xs opacity-60">${escHtml(
    message
  )}</div>`;
}

/**
 * The chart, as one HTML string.
 *
 * Callers mount it like every other page fragment and then call
 * `attachTimelineListeners` on the mounted root.
 */
export function renderTimelineChart(
  rows: readonly TimelineRow[],
  options: TimelineOptions = {}
): string {
  const empty = options.emptyMessage ?? 'Nothing to show on the timeline.';
  if (rows.length === 0) return emptyChart(empty);

  const unit = options.unit ?? 'week';
  const extent = rowsExtent(rows);
  const from = options.from ?? extent?.from;
  const to = options.to ?? extent?.to;
  if (!from || !to || from > to) return emptyChart(empty);

  const { columns, truncated } = buildColumns(unit, from, to);
  const today = options.today ?? todayDate();
  const cellPx = unit === 'week' ? CONFIG.TIMELINE_WEEK_CELL_PX : CONFIG.TIMELINE_DAY_CELL_PX;
  const extraColumns = options.columns ?? [];
  const hasDots = rows.some((row) => row.weekdays);

  const labelPx = Math.min(
    CONFIG.TIMELINE_LABEL_MAX_PX,
    Math.max(
      CONFIG.TIMELINE_LABEL_MIN_PX,
      Math.max(...rows.map((row) => row.label.length)) * CONFIG.TIMELINE_LABEL_CHAR_PX +
        CONFIG.TIMELINE_LABEL_PAD_PX
    )
  );
  const labelStyle = `width:${labelPx}px;min-width:${labelPx}px;max-width:${labelPx}px`;
  const cellStyle = `width:${cellPx}px;min-width:${cellPx}px`;

  // Days in one column, which is what a today marker's position within a cell
  // is a fraction of.
  const columnDays = unit === 'week' ? 7 : 1;

  // The month header carries the marker too, so the line reads as continuous
  // from the top of the table rather than starting at the first row.
  let spanStart = 0;
  const monthHeader = monthSpans(columns)
    .map(({ label, span }) => {
      let style = '';
      for (let i = 0; i < span; i++) {
        const day = todayOffset(columns[spanStart + i], today);
        if (day < 0) continue;
        style = todayLineStyle(((i + (day + 0.5) / columnDays) / span) * 100);
        break;
      }
      spanStart += span;
      return `<th colspan="${span}" class="px-1 py-0.5 text-center font-medium opacity-60
        border-b border-base-300 whitespace-nowrap" style="${style}">${escHtml(label)}</th>`;
    })
    .join('');

  const dayHeader =
    unit === 'day'
      ? `<tr>${columns
          .map(
            (column) =>
              `<th class="px-1 py-0.5 text-center font-medium opacity-60 border-b border-base-300
                whitespace-nowrap" style="${cellStyle}">${escHtml(
                  `${WEEKDAY_LABELS[weekdayIndex(column.start)]} ${dayOfMonth(column.start)}`
                )}</th>`
          )
          .join('')}</tr>`
      : '';
  const headerRowSpan = unit === 'day' ? ' rowspan="2"' : '';

  const dotsHeader = hasDots
    ? `<th${headerRowSpan} class="w-14 min-w-14 px-1 py-0.5 text-center border-b border-base-300">
        <span class="font-mono tracking-tight opacity-50">${escHtml(
          WEEKDAY_LABELS.map((label) => label[0]).join('')
        )}</span></th>`
    : '';
  const extraHeader = extraColumns
    .map(
      (column) =>
        `<th${headerRowSpan} class="px-1 py-0.5 border-b border-base-300 whitespace-nowrap opacity-50
          ${column.className ?? ''}" style="width:${column.widthPx}px;min-width:${
            column.widthPx
          }px">${escHtml(column.header)}</th>`
    )
    .join('');

  const body = rows
    .map((row) => {
      const cells = columns
        .map((column) => {
          const span = coveringSpan(row, column);
          const cell = options.cellRenderer?.(row, column);
          const color = cell?.color ?? (span ? row.color : undefined);

          const styles: string[] = [];
          if (color) styles.push(shade(color));
          const day = todayOffset(column, today);
          if (day >= 0) styles.push(todayLineStyle(((day + 0.5) / columnDays) * 100));

          // Every column of a span carries the same tooltip, so the whole span
          // reads as one. A column outside every span says nothing at all: a
          // week is not a meaningful unit here, since a span can start or end
          // mid-week.
          const tooltip = cell?.tooltip ?? span?.tooltip;
          const tooltipAttr = tooltip ? ` data-tooltip-content="${escHtml(tooltip)}"` : '';
          const conflict = cell?.conflict
            ? ' ring-1 ring-inset ring-warning outline-none'
            : '';

          return `<td class="${CELL_CLASS} border-r border-base-300/20 text-center align-middle
            leading-none${tooltip ? ' field-tooltip-trigger' : ''}${conflict}"
            style="${cellStyle};height:${CONFIG.TIMELINE_ROW_PX}px;${styles.join(';')}"
            data-timeline-date="${escHtml(column.start)}"${tooltipAttr}>${
              cell?.html ?? ''
            }${cellTicks(row, column)}</td>`;
        })
        .join('');

      const dot = row.color
        ? `<span class="size-2 rounded-full shrink-0" style="background:${escHtml(row.color)}"></span>`
        : '';
      const labelCell = `<td class="sticky left-0 z-10 bg-base-200 px-2 py-1
        border-b border-base-300/30" style="${labelStyle}">
        <span class="inline-flex items-center gap-1 overflow-hidden max-w-full">${dot}
          ${tooltipTrigger(row.title ?? row.label, row.labelHtml ?? escHtml(row.label), 'truncate')}
        </span></td>`;
      const dotsCell = hasDots
        ? `<td class="w-14 min-w-14 px-1 py-1 border-b border-base-300/30 text-center">${weekdayDots(
            row.weekdays
          )}</td>`
        : '';
      const extraCells = extraColumns
        .map(
          (column, i) =>
            `<td class="px-1 py-1 border-b border-base-300/30 ${column.className ?? ''}">${
              row.extra?.[i] ?? ''
            }</td>`
        )
        .join('');

      return `<tr class="${ROW_CLASS} hover:bg-base-300/20"
        data-timeline-key="${escHtml(row.key)}">${labelCell}${dotsCell}${extraCells}${cells}</tr>`;
    })
    .join('');

  const truncatedNote = truncated
    ? `<div class="text-xs text-warning mb-2">Range longer than ${
        CONFIG.TIMELINE_MAX_DAYS
      } days: the display stops at ${escHtml(columns[columns.length - 1].end)}.</div>`
    : '';

  return `<div>${truncatedNote}
    <div class="overflow-x-auto">
      <table class="text-xs border-collapse">
        <thead>
          <tr>
            <th${headerRowSpan} class="sticky left-0 z-10 bg-base-200 border-b border-base-300"
              style="${labelStyle}"></th>
            ${dotsHeader}${extraHeader}${monthHeader}
          </tr>
          ${dayHeader}
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
  </div>`;
}

/**
 * Wire the chart up.
 *
 * A cell click is a row click too unless `onCellClick` is given, so a chart
 * with no cell behaviour behaves as one big row target.
 *
 * The pointer cursor is added here rather than rendered, so a chart nobody
 * wired up does not advertise a click that does nothing. A row whose label is
 * a link is navigated by the panel's own delegation and needs none of this.
 */
export function attachTimelineListeners(
  root: ParentNode,
  onRowClick?: (key: string) => void,
  onCellClick?: (key: string, date: ServiceDate) => void
): void {
  root.querySelectorAll<HTMLElement>(`.${ROW_CLASS}`).forEach((row) => {
    const key = row.dataset.timelineKey;
    if (key === undefined) return;

    if (onRowClick || onCellClick) row.classList.add('cursor-pointer');

    if (onCellClick) {
      row.querySelectorAll<HTMLElement>(`.${CELL_CLASS}`).forEach((cell) => {
        const date = cell.dataset.timelineDate;
        if (date === undefined) return;
        cell.addEventListener('click', (event) => {
          event.stopPropagation();
          onCellClick(key, date);
        });
      });
    }
    if (onRowClick) row.addEventListener('click', () => onRowClick(key));
  });
}
