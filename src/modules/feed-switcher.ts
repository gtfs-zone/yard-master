/**
 * The feed picker: your feeds, and a form for a new one.
 *
 * yard-master's feeds are rows you own or were given, not URLs you type, which
 * is why none of test-track's `FeedSelection` machinery appears here. A feed
 * either links a URL, which is stored server-side rather than kept in the
 * hash, or hosts a zip somebody uploaded; `schedule-upload.ts` owns that form,
 * because the drop zone and its preview are shared with the feed page.
 *
 * The "show all feeds" toggle is admin-only and off by default, because
 * `GET /feeds` deliberately does not apply the admin bypass: an admin whose
 * switcher listed every feed on the server would never find their own.
 *
 * Resolves to the feed the person chose, or null if they closed the dialog.
 */

import { listFeeds } from './api-client';
import { sourceLabel } from './feed-source';
import { escHtml } from './render-utils';
import { loadStatusBadge } from './managed-render';
import { showModal } from './modal-utils';
import { showNewFeedForm } from './schedule-upload';
import type { Feed } from '../types/api';

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
      ${loadStatusBadge(feed.load)}
      <span class="text-xs opacity-50 ml-auto">${escHtml(owner)}</span>
    </div>
    <p class="text-xs opacity-60 truncate">${escHtml(
      feed.static_feed_url ?? sourceLabel(feed)
    )}</p>
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

const NEW_FEED_BUTTON = `
  <button id="new-feed" class="btn btn-primary btn-sm w-full mt-4">New feed</button>`;

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
      ${NEW_FEED_BUTTON}`,
    actions: [{ label: 'Close', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-lg',
    onMount: (close) => {
      const list = document.getElementById('feed-list')!;
      const showAll = document.getElementById('feed-show-all') as HTMLInputElement | null;
      const newFeed = document.getElementById('new-feed') as HTMLButtonElement;

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

      // The form owns its own errors and stays open on a 409 or a 422, so a
      // resolved value here means a feed exists. Created and selected in one
      // step: nobody makes a feed in order to then not look at it.
      newFeed.addEventListener('click', () => {
        void showNewFeedForm().then((created) => {
          if (created) pick(created);
        });
      });

      void refresh();
    },
  });

  return chosen;
}
