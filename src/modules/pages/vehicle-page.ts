/**
 * The vehicle page: one live vehicle of a tracker that carries several.
 *
 * yard-master's own page. A tracker with one vehicle never links here (see
 * `vehicle-location.ts`); this is for a producer posting a fleet under one
 * credential, where the tracker page is the fleet and this is one train or bus
 * in it. Nothing here is managed: the vehicle exists only while its record
 * does, so everything editable stays on the tracker.
 */

import { CONFIG } from '../../config';
import type { PageState } from '../../types/page-state';
import type { RenderContext } from '../render-context';
import { vehicleLabel } from '../breadcrumbs';
import { renderVehicle } from './tracker-page';
import { entityLink, escHtml, missing, section } from 'interlocking/gtfs/entity-render';

export function renderVehiclePage(
  ctx: RenderContext,
  state: Extract<PageState, { type: 'vehicle' }>
): string {
  const tracker = ctx.session.trackers.get(state.tracker_id);
  if (!tracker) {
    if (ctx.session.trackers.size === 0) {
      return `<p class="text-sm opacity-60">Loading this feed's trackers…</p>`;
    }
    return missing(`Tracker ${state.tracker_id}`);
  }

  const vehicle = ctx.session.vehicles.get(state.vehicle_key);
  const trackerLink = entityLink(
    ctx,
    { type: 'tracker', tracker_id: tracker.id },
    tracker.nickname,
    'link link-hover'
  );

  return `
    <div class="space-y-4">
      <div class="space-y-1">
        <h2 class="text-lg font-semibold leading-tight">${escHtml(
          vehicleLabel(ctx.session, state.vehicle_key)
        )}</h2>
        <p class="text-xs opacity-60 flex items-center gap-2">
          ${
            vehicle
              ? '<span class="badge badge-xs badge-success">reporting</span>'
              : '<span class="badge badge-xs badge-ghost">no fix</span>'
          }
          <span>on ${trackerLink}</span>
        </p>
      </div>

      ${
        vehicle
          ? section('Position', renderVehicle(ctx, vehicle))
          : section(
              'Position',
              `<p class="text-xs opacity-60">Not reporting. A vehicle drops off the map
               ${Math.round(CONFIG.TRACKER_STALE_MS / 1000)} seconds after its last fix;
               the rest of ${trackerLink}'s fleet is on its tracker page.</p>`
            )
      }
    </div>`;
}
