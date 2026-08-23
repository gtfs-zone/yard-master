/**
 * Choosing a schedule zip: the drop zone, the preview under it, and the two
 * dialogs that put a zip on a feed.
 *
 * Both dialogs share one field so that both get the preview. That preview is
 * the feature rather than decoration — the counts and the service dates are
 * how somebody notices they picked last year's export before they upload it,
 * and cafe-car cannot tell them that because cafe-car only sees the file after
 * it has been sent.
 *
 * A create is two requests, deliberately: `POST /feeds` makes a hosted feed
 * with no schedule, and `POST /feeds/{id}/uploads` gives it one and queues the
 * load. There is no combined endpoint, and a multipart create would have to
 * carry the feed fields as form parts for the sake of saving a round trip on
 * an action nobody takes twice.
 */

import { CONFIG } from '../config';
import type { Feed, GtfsUpload } from '../types/api';
import { ApiError, createFeed, getFeed, uploadSchedule } from './api-client';
import { formatBytes } from './feed-download';
import type { FormField } from './entity-form';
import { showEntityForm } from './entity-form';
import { previewGtfsZip } from './gtfs-zip-preview';
import { notify } from './notification-system';
import { escHtml } from './render-utils';

/** Mirrors cafe-car's `_FEED_NAME_RE`, so the refusal happens before the request. */
const FEED_NAME_RE = /^[a-z][a-z0-9_-]{2,63}$/;

/** The `source_kind` choice, worded as the two things somebody is deciding between. */
const SOURCE_OPTIONS = [
  { value: 'url', label: 'Link a URL' },
  { value: 'hosted', label: 'Upload a zip' },
];

/**
 * Render one preview result into the slot under a drop zone.
 *
 * A rejection is shown in the same place and the same shape as a server-side
 * 422 would be, so the two are not two different experiences of the same
 * refusal.
 */
// Which parse a slot is waiting for. Choosing a second file while the first is
// still parsing is ordinary — a big zip takes seconds — and without this the
// slower answer would land last and describe the wrong file.
const pending = new WeakMap<HTMLElement, symbol>();

function renderPreview(slot: HTMLElement, file: File): void {
  const token = Symbol('preview');
  pending.set(slot, token);
  slot.innerHTML = `<span class="text-xs opacity-60">
    <span class="loading loading-spinner loading-xs align-middle"></span>
    Reading ${escHtml(file.name)}…
  </span>`;

  void previewGtfsZip(file).then((preview) => {
    if (pending.get(slot) !== token || !slot.isConnected) return;
    if (!preview.ok) {
      slot.innerHTML = `<div class="alert alert-error alert-sm text-xs">
        <span>${escHtml(preview.reason)}</span>
      </div>`;
      return;
    }

    const s = preview.summary;
    const dates =
      s.serviceStart && s.serviceEnd
        ? `${s.serviceStart} to ${s.serviceEnd}`
        : 'no dated service';
    const agencies = s.agencies.length ? s.agencies.join(', ') : 'no named agency';
    slot.innerHTML = `<div class="rounded-lg bg-base-200 px-3 py-2 space-y-1 text-xs">
      <div class="font-semibold">${escHtml(agencies)}</div>
      <div class="opacity-70">
        ${s.routes.toLocaleString()} routes, ${s.stops.toLocaleString()} stops,
        ${s.trips.toLocaleString()} trips
      </div>
      <div class="opacity-70">Service ${escHtml(dates)} · ${escHtml(
        formatBytes(s.sizeBytes)
      )}</div>
    </div>`;
  });
}

/**
 * The drop zone field, with the parse wired to it.
 *
 * `visibleWhen` is left to the caller: the create form shows it only for a
 * hosted feed, and the replace form has nothing to hide it behind.
 */
export function scheduleZipField(overrides: Partial<FormField> = {}): FormField {
  return {
    name: 'file',
    label: 'Schedule zip',
    type: 'file',
    accept: '.zip,application/zip',
    tooltip: `A GTFS zip, up to ${Math.round(CONFIG.UPLOAD_MAX_BYTES / (1 << 20))} MB. It is
           stored here and published at this feed's own URL.`,
    onFile: (file, slot) => {
      if (file) renderPreview(slot, file);
    },
    ...overrides,
  };
}

/** What cafe-car's `AnyHttpUrl` accepts: an absolute http or https URL. */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Upload a zip, reporting a rejected one under the drop zone rather than in a toast. */
export async function putSchedule(feedId: number, file: File): Promise<GtfsUpload> {
  return uploadSchedule(feedId, file);
}

/**
 * The new-feed dialog: a name, a source, and whichever half of the form that
 * source needs.
 *
 * Resolves to the created feed, or null if the dialog was closed. A hosted
 * feed whose upload fails is *still created* — the row exists and the dialog
 * has already closed — so the failure is reported as what it is: a feed with
 * no schedule yet, which the feed page offers to fix.
 */
export async function showNewFeedForm(): Promise<Feed | null> {
  return showEntityForm<Feed>({
    title: 'New feed',
    conflictField: 'feed_name',
    submitLabel: 'Create feed',
    fields: [
      {
        name: 'feed_name',
        label: 'Name',
        autofocus: true,
        placeholder: 'my-agency',
        tooltip: `Starts with a lowercase letter, then lowercase letters, digits, - and _, 3-64
               characters. It appears in every public GTFS-RT URL this feed serves, so it
               cannot be changed casually.`,
      },
      {
        name: 'source_kind',
        label: 'Schedule source',
        type: 'select',
        value: 'url',
        options: SOURCE_OPTIONS,
        tooltip: 'A linked feed is re-downloaded from its URL; an uploaded one is stored and served here.',
      },
      {
        name: 'static_feed_url',
        label: 'Static feed URL',
        type: 'url',
        placeholder: 'https://example.com/gtfs.zip',
        visibleWhen: { field: 'source_kind', equals: 'url' },
      },
      scheduleZipField({ visibleWhen: { field: 'source_kind', equals: 'hosted' } }),
    ],
    validate: (values): Record<string, string> | null => {
      if (!FEED_NAME_RE.test(values.feed_name.trim())) {
        return {
          feed_name:
            'Starts with a lowercase letter, then lowercase letters, digits, - and _, 3-64 characters',
        };
      }
      if (values.source_kind === 'url') {
        const url = values.static_feed_url.trim();
        if (!url) return { static_feed_url: 'A linked feed needs a static feed URL' };
        if (!isHttpUrl(url)) return { static_feed_url: 'Must be a valid http or https URL' };
      }
      if (values.source_kind === 'hosted' && !values.file) {
        return { file: 'Choose a schedule zip to upload' };
      }
      return null;
    },
    submit: async (values, files) => {
      const hosted = values.source_kind === 'hosted';
      const feed = await createFeed({
        feed_name: values.feed_name.trim(),
        source_kind: hosted ? 'hosted' : 'url',
        ...(hosted ? {} : { static_feed_url: values.static_feed_url.trim() }),
      });
      if (!hosted) return feed;

      try {
        await putSchedule(feed.id, files.file!);
      } catch (err) {
        // The feed is already made, so this cannot be reported as a failed
        // save: closing the form and saying what is missing is the honest
        // answer, and the feed page is where the retry lives.
        notify.error(
          `Created ${feed.feed_name}, but the schedule did not upload: ${
            err instanceof ApiError ? err.message : String(err)
          }`
        );
        return feed;
      }
      // Re-read rather than returned as created: the upload is what flipped
      // `source_kind` and filled in `current_upload`, so the row this dialog
      // holds is a revision behind, and the caller selects whatever it gets.
      return getFeed(feed.id);
    },
  });
}
