/**
 * What is actually in the zip somebody just chose, read in the browser before
 * a byte of it is sent.
 *
 * This is the point of the upload dialog. cafe-car checks the same things
 * server-side and is the authority, but it can only answer after the file has
 * been uploaded; somebody who picked last year's export, or the wrong agency's,
 * finds out here instead of three minutes later in a failed load.
 *
 * The file-name checks are deliberately the same ones `api/uploads.py` makes,
 * in the same order and with the same wording, so a zip that passes here and
 * then fails there is a bug rather than a difference of opinion. The counts on
 * top come from `GTFSScheduled`, the same parser the map runs on.
 */

import JSZip from 'jszip';
import { CONFIG } from '../config';
import { GTFSScheduled } from '../gtfs-scheduled';

/** Mirrors cafe-car's `REQUIRED_FILES`. */
const REQUIRED_FILES = [
  'agency.txt',
  'stops.txt',
  'routes.txt',
  'trips.txt',
  'stop_times.txt',
];

/** A feed needs at least one; with neither it has no service days. */
const CALENDAR_FILES = ['calendar.txt', 'calendar_dates.txt'];

export interface ZipSummary {
  sizeBytes: number;
  /** Agency names as `agency.txt` gives them, for "is this the right feed". */
  agencies: string[];
  routes: number;
  stops: number;
  trips: number;
  /** YYYY-MM-DD, or null when the feed has no dated service at all. */
  serviceStart: string | null;
  serviceEnd: string | null;
}

export type ZipPreview =
  | { ok: true; summary: ZipSummary }
  | { ok: false; reason: string };

/** `YYYYMMDD` as GTFS writes it, or null for anything that is not one. */
function isoDate(compact: string): string | null {
  return /^\d{8}$/.test(compact)
    ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6)}`
    : null;
}

/**
 * The span of dated service in the feed: `calendar.txt`'s outermost bounds
 * widened by any `calendar_dates.txt` exception outside them.
 *
 * A calendar-dates-only feed is common and entirely valid, which is why the
 * exceptions are read rather than treated as decoration on a calendar row.
 */
function serviceRange(feed: GTFSScheduled): { start: string | null; end: string | null } {
  const dates: string[] = [];
  for (const cal of feed.calendar) {
    const start = isoDate(cal.start_date);
    const end = isoDate(cal.end_date);
    if (start) dates.push(start);
    if (end) dates.push(end);
  }
  for (const exception of feed.calendarDates) {
    const date = isoDate(exception.date);
    if (date) dates.push(date);
  }
  if (!dates.length) return { start: null, end: null };
  dates.sort();
  return { start: dates[0], end: dates[dates.length - 1] };
}

/** The name checks, against the entries at the root of the archive. */
function rejectByName(names: string[]): string | null {
  const root = new Set(names);

  const nested = names.filter(
    (n) => n.includes('/') && REQUIRED_FILES.includes(n.slice(n.lastIndexOf('/') + 1))
  );
  if (nested.length) {
    const directory = nested[0].slice(0, nested[0].lastIndexOf('/'));
    return `The .txt files are inside '${directory}/'. They have to be at the top level of the zip`;
  }

  const missing = REQUIRED_FILES.filter((name) => !root.has(name));
  if (missing.length) return `That zip is missing ${missing.join(', ')}`;

  if (!CALENDAR_FILES.some((name) => root.has(name))) {
    return 'That zip has neither calendar.txt nor calendar_dates.txt';
  }
  return null;
}

/**
 * Read a chosen file and say what it is, or why it is not a feed.
 *
 * Parsing tens of megabytes of CSV is not free and there is no worker here, so
 * the caller shows a spinner and this yields to the event loop first: the
 * dialog gets to paint that spinner before the main thread goes away. It never
 * throws — an unreadable zip is one of the answers, not an exception the form
 * has to catch.
 */
export async function previewGtfsZip(file: File): Promise<ZipPreview> {
  if (file.size > CONFIG.UPLOAD_MAX_BYTES) {
    const mb = Math.round(CONFIG.UPLOAD_MAX_BYTES / (1 << 20));
    return { ok: false, reason: `That file is larger than ${mb} MB` };
  }
  if (file.size === 0) return { ok: false, reason: 'That file is empty' };

  await new Promise((resolve) => setTimeout(resolve, 0));

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return { ok: false, reason: 'That file is not a zip archive' };
  }

  const named = rejectByName(Object.keys(zip.files));
  if (named) return { ok: false, reason: named };

  const feed = new GTFSScheduled();
  try {
    await feed.loadFromFile(file);
  } catch (err) {
    return {
      ok: false,
      reason: `That zip could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const range = serviceRange(feed);
  return {
    ok: true,
    summary: {
      sizeBytes: file.size,
      agencies: feed.agencies.map((a) => a.name).filter(Boolean),
      routes: feed.routes.size,
      stops: feed.stops.size,
      trips: feed.trips.size,
      serviceStart: range.start,
      serviceEnd: range.end,
    },
  };
}
