/**
 * The feed picker: your feeds, and a form for a new one.
 *
 * yard-master's feeds are rows you own or were given, not URLs you type, which
 * is why none of test-track's `FeedSelection` machinery appears here. The only
 * URL anybody enters is a new feed's `static_feed_url`, and that is stored
 * server-side rather than kept in the hash.
 *
 * The "show all feeds" toggle is admin-only and off by default, because
 * `GET /feeds` deliberately does not apply the admin bypass: an admin whose
 * switcher listed every feed on the server would never find their own.
 *
 * Resolves to the feed the person chose, or null if they closed the dialog.
 */

import { createFeed, listFeeds } from './api-client';
import { ApiError } from './api-client';
import { escHtml } from './render-utils';
import { showModal } from './modal-utils';
import { notify } from './notification-system';
import type { Feed } from '../types/api';

/** Badge wording for a feed's last static load. Null is not "pending". */
function loadBadge(feed: Feed): string {
  if (!feed.load) {
    return '<span class="badge badge-ghost badge-sm">never loaded</span>';
  }
  const cls =
    {
      success: 'badge-success',
      failed: 'badge-error',
      running: 'badge-info',
      pending: 'badge-warning',
    }[feed.load.status] ?? 'badge-ghost';
  return `<span class="badge ${cls} badge-sm">${escHtml(feed.load.status)}</span>`;
}

function feedRow(feed: Feed, selectedId: number | null): string {
  const owner = feed.is_owner ? 'yours' : `shared by ${feed.owner_name ?? 'someone'}`;
  return `<button
      type="button"
      data-feed-id="${feed.id}"
      class="w-full text-left card card-bordered bg-base-200 p-3 hover:bg-base-300 ${
        feed.id === selectedId ? 'border-primary' : ''
      }"
    >
    <div class="flex items-center gap-2">
      <span class="font-semibold">${escHtml(feed.feed_name)}</span>
      ${loadBadge(feed)}
      <span class="text-xs opacity-50 ml-auto">${escHtml(owner)}</span>
    </div>
    <p class="text-xs opacity-60 truncate">${escHtml(feed.static_feed_url)}</p>
  </button>`;
}

function listMarkup(feeds: Feed[], selectedId: number | null): string {
  if (feeds.length === 0) {
    return `<p class="text-sm opacity-50 text-center py-6">
      No feeds yet. Create one below.
    </p>`;
  }
  return feeds.map((feed) => feedRow(feed, selectedId)).join('');
}

const NEW_FEED_FORM = `
  <details class="collapse collapse-arrow border border-base-300 mt-4">
    <summary class="collapse-title text-sm font-semibold">New feed</summary>
    <div class="collapse-content space-y-2">
      <label class="form-control">
        <span class="label-text text-xs">Name</span>
        <input id="new-feed-name" class="input input-sm input-bordered w-full"
               placeholder="my-agency" autocomplete="off" />
        <span class="label-text-alt opacity-50">
          Lowercase letters, digits, <code>-</code> and <code>_</code>. It appears
          in this feed's public GTFS-RT URLs, so it cannot be changed casually.
        </span>
      </label>
      <label class="form-control">
        <span class="label-text text-xs">Static feed URL</span>
        <input id="new-feed-url" class="input input-sm input-bordered w-full"
               placeholder="https://example.com/gtfs.zip" autocomplete="off" />
      </label>
      <button id="new-feed-submit" class="btn btn-primary btn-sm">Create feed</button>
    </div>
  </details>`;

export interface FeedSwitcherOptions {
  /** The feed currently selected, marked in the list. */
  selected: Feed | null;
  /** Whether to offer the "show all feeds" toggle at all. */
  isAdmin: boolean;
}

export async function showFeedSwitcher(
  options: FeedSwitcherOptions
): Promise<Feed | null> {
  let chosen: Feed | null = null;
  const selectedId = options.selected?.id ?? null;

  await showModal({
    title: 'Feeds',
    body: `
      ${
        options.isAdmin
          ? `<label class="label cursor-pointer justify-start gap-2 pb-2">
               <input id="feed-show-all" type="checkbox" class="toggle toggle-sm" />
               <span class="label-text text-xs">Show every feed on the server</span>
             </label>`
          : ''
      }
      <div id="feed-list" class="space-y-2">
        <p class="text-sm opacity-50 text-center py-6">Loading…</p>
      </div>
      ${NEW_FEED_FORM}`,
    actions: [{ label: 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-lg',
    onMount: (close) => {
      const list = document.getElementById('feed-list')!;
      const showAll = document.getElementById('feed-show-all') as HTMLInputElement | null;
      const nameInput = document.getElementById('new-feed-name') as HTMLInputElement;
      const urlInput = document.getElementById('new-feed-url') as HTMLInputElement;
      const submit = document.getElementById('new-feed-submit') as HTMLButtonElement;

      const pick = (feed: Feed): void => {
        chosen = feed;
        close();
      };

      let feeds: Feed[] = [];

      const refresh = async (): Promise<void> => {
        try {
          feeds = await listFeeds(showAll?.checked ?? false);
        } catch (err) {
          list.innerHTML = `<p class="text-sm text-error text-center py-6">${escHtml(
            err instanceof Error ? err.message : String(err)
          )}</p>`;
          return;
        }
        list.innerHTML = listMarkup(feeds, selectedId);
      };

      list.addEventListener('click', (e) => {
        const row = (e.target as HTMLElement).closest<HTMLElement>('[data-feed-id]');
        if (!row) return;
        const feed = feeds.find((f) => f.id === Number(row.dataset.feedId));
        if (feed) pick(feed);
      });

      showAll?.addEventListener('change', () => void refresh());

      submit.addEventListener('click', async () => {
        const feed_name = nameInput.value.trim();
        const static_feed_url = urlInput.value.trim();
        if (!feed_name || !static_feed_url) {
          notify.warning('A new feed needs both a name and a static feed URL.');
          return;
        }
        submit.disabled = true;
        try {
          const created = await createFeed({ feed_name, static_feed_url });
          // Created and selected in one step: nobody makes a feed in order to
          // then not look at it. The first load is already queued server-side.
          notify.success(`Created ${created.feed_name}`);
          pick(created);
        } catch (err) {
          // 409 and 422 are both things the person can fix in the form, so the
          // dialog stays open with what they typed still in it.
          notify.error(
            err instanceof ApiError ? err.message : `Could not create the feed: ${err}`
          );
          submit.disabled = false;
        }
      });

      void refresh();
    },
  });

  return chosen;
}
