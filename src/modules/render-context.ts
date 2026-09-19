/**
 * interlocking's generic render types, bound to this app's own shapes: the
 * page-state union, the session class, and the vehicle that carries a tracker
 * id.
 *
 * Aliased in one place so every page keeps writing `RenderContext`
 * unparameterized, and so `ctx.session` stays the full session — the trackers,
 * rules and members the managed pages read — rather than the four-member view
 * the shared renderers are written against.
 */

import type { RenderContext as SharedRenderContext } from 'interlocking/gtfs/entity-render';
import type { RtIndex as SharedRtIndex } from 'interlocking/gtfs/rt-index';
import type { PageState } from '../types/page-state';
import type { VehiclePosition } from '../map-controller';
import type { FeedSession } from './feed-session';

export type RenderContext = SharedRenderContext<PageState, FeedSession>;

/** The live index, over this app's vehicles rather than the bare GTFS-RT ones. */
export type RtIndex = SharedRtIndex<VehiclePosition>;
