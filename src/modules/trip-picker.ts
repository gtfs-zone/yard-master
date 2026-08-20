/**
 * Picking one trip out of a feed that may hold fifty thousand of them.
 *
 * A `<select>` is not an option at that size, and neither is a free text field:
 * a mistyped `trip_id` is a rule that silently never resolves. So this is the
 * same fuzzy search the map's search box uses, over the trips the browser has
 * parsed, in a modal of its own.
 *
 * Two things it deliberately allows:
 *
 * - **Typing an id by hand.** The zip may not have loaded — an unreachable
 *   `static_feed_url` is a normal state in this app — and an assignment must
 *   still be writable, because the server never checks a trip id against the
 *   schedule either.
 * - **Keeping an id the loaded feed has lost.** A feed can be reloaded out from
 *   under a rule, so the picker opens on whatever the rule already names,
 *   whether or not the schedule still describes it.
 */

import uFuzzy from '@leeoniya/ufuzzy';
import type { GTFSStatic, Trip } from '../gtfs-static';
import type { FeedSession } from './feed-session';
import { formatScheduleTime } from './feed-time';
import { showModal } from './modal-utils';
import { escHtml } from './render-utils';

// Same tolerance the map search box uses: one inserted character inside a term.
const uf = new uFuzzy({ intraIns: 1 });

// Rows rendered at once. The list is a shortlist to pick from, not a way to
// page through a feed, and a query that matches thousands means "type more".
const RESULT_LIMIT = 50;

const DEBOUNCE_MS = 150;

/** What a trip is called here: its short name, then its headsign, then its id. */
export function tripName(trip: Trip): string {
  return trip.raw.trip_short_name?.trim() || trip.headsign || trip.trip_id;
}

/** The trip's route and first departure, which is what tells two runs apart. */
function tripDetail(feed: GTFSStatic, trip: Trip): string {
  const route = feed.routes.get(trip.route_id);
  const routeLabel = route
    ? route.short_name || route.long_name || route.id
    : trip.route_id;
  const first = feed.stopTimesByTrip.get(trip.trip_id)?.[0];
  const departure = first?.departure_time || first?.arrival_time;
  return departure ? `${routeLabel} · ${formatScheduleTime(departure)}` : routeLabel;
}

function renderRows(feed: GTFSStatic, trips: Trip[], selected: string | null): string {
  if (trips.length === 0) {
    return `<li class="text-xs opacity-60 px-2 py-3">No trip matches that.</li>`;
  }
  return trips
    .map(
      (trip) => `<li>
        <button type="button" class="w-full text-left rounded-lg px-2 py-1.5 hover:bg-base-200 ${
          trip.trip_id === selected ? 'bg-base-200' : ''
        }" data-trip="${escHtml(trip.trip_id)}">
          <span class="text-sm block truncate">${escHtml(tripName(trip))}</span>
          <span class="text-xs opacity-60 block truncate">${escHtml(
            tripDetail(feed, trip)
          )}</span>
          <span class="text-xs opacity-40 font-mono block truncate">${escHtml(
            trip.trip_id
          )}</span>
        </button>
      </li>`
    )
    .join('');
}

/**
 * Ask for a trip. Resolves to its id, or null if the dialog was dismissed.
 *
 * `current` is the id the caller already holds, shown in the field so an edit
 * opens on what it is about to change rather than on an empty box.
 */
export async function pickTrip(
  session: FeedSession,
  current: string | null = null
): Promise<string | null> {
  const feed = session.staticFeed;
  let chosen: string | null = null;

  if (!feed) {
    // No parsed schedule to search. The id is still writable, because the
    // server does not check it either and a rule written now is right as soon
    // as the zip loads.
    await showModal({
      title: 'Choose a trip',
      body: `
        <div class="space-y-3">
          <p class="text-xs opacity-70">The schedule has not loaded in this browser, so there is
          nothing to search. Type the <span class="font-mono">trip_id</span> exactly as the feed
          spells it.</p>
          <input class="input input-bordered input-sm w-full font-mono" data-trip-id
                 value="${escHtml(current ?? '')}" placeholder="trip_id" autofocus />
        </div>`,
      actions: [
        { label: 'Cancel', onClick: () => {} },
        {
          label: 'Use this id',
          className: 'btn-primary',
          // True keeps the modal open, which an empty field wants.
          onClick: (): boolean => {
            const input = document.querySelector<HTMLInputElement>(
              '.modal-open [data-trip-id]'
            );
            const value = input?.value.trim() ?? '';
            if (!value) return true;
            chosen = value;
            return false;
          },
        },
      ],
      escapeAction: 0,
      boxClassName: 'max-w-md',
    });
    return chosen;
  }

  const trips = [...feed.trips.values()];
  // Built once per open rather than per keystroke: fifty thousand strings is a
  // cheap array and an expensive loop to redo on every character.
  const haystack = trips.map((trip) =>
    [tripName(trip), trip.trip_id, trip.headsign, trip.route_id]
      .filter(Boolean)
      .join(' ')
  );

  await showModal({
    title: 'Choose a trip',
    body: `
      <div class="space-y-3">
        <input class="input input-bordered input-sm w-full" data-trip-query
               placeholder="Search ${trips.length} trips by name, headsign or id" autofocus />
        <ul class="space-y-1 max-h-[45vh] overflow-y-auto" data-trip-results></ul>
      </div>`,
    actions: [{ label: 'Cancel', onClick: () => {} }],
    escapeAction: 0,
    boxClassName: 'max-w-lg',
    onMount: (close) => {
      const boxes = document.querySelectorAll<HTMLElement>('.modal-open .modal-box');
      const box = boxes[boxes.length - 1];
      const input = box.querySelector<HTMLInputElement>('[data-trip-query]')!;
      const results = box.querySelector<HTMLElement>('[data-trip-results]')!;

      const show = (query: string): void => {
        let matched: Trip[];
        if (!query.trim()) {
          matched = trips.slice(0, RESULT_LIMIT);
        } else {
          const [idxs, info, order] = uf.search(haystack, query);
          // `info.idx` maps an info slot back to its haystack index and `order`
          // is those slots ranked, so `info.idx[order[i]]` is the trip.
          const ranked = info && order ? order.map((o) => info.idx[o]) : (idxs ?? []);
          matched = ranked.slice(0, RESULT_LIMIT).map((i) => trips[i]);
        }
        results.innerHTML = renderRows(feed, matched, current);
      };

      let timer: ReturnType<typeof setTimeout> | null = null;
      input.addEventListener('input', () => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => show(input.value), DEBOUNCE_MS);
      });

      results.addEventListener('click', (event) => {
        const button = (event.target as HTMLElement | null)?.closest<HTMLElement>(
          '[data-trip]'
        );
        if (!button) return;
        chosen = button.dataset.trip!;
        close();
      });

      show('');
      input.focus();
    },
  });

  return chosen;
}
