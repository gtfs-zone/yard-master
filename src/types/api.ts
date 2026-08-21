/**
 * The shapes cafe-car's `/api` returns, one type per model in its
 * `api/schemas.py`. Hand-mirrored rather than generated: the API is small, it
 * is in a repo next door, and a generated client would bring a build step that
 * buys nothing at this size.
 *
 * Two rules travel with these types and are the reason the split exists at
 * all:
 *
 * - `Tracker` has no `device_key`. Only `TrackerDetail` does, only
 *   `GET /trackers/{id}` returns it, and it belongs in the properties panel and
 *   nowhere else — never in the hash, never in a log line.
 * - `Feed.load` is null for a feed schedule-foamer has never touched. That is
 *   not `pending`, and a status reader that treats it as pending will claim a
 *   brand-new feed is already downloading.
 *
 * Dates arrive as ISO strings, which is what `JSON.parse` gives; they are
 * typed as `string` rather than silently revived into `Date`.
 */

import type { VehiclePosition } from '../map-controller';

export interface Me {
  user_id: number;
  email: string | null;
  display_name: string | null;
  is_admin: boolean;
  /** Keycloak's Account Console. Null in a deployment without one. */
  account_url: string | null;
}

/** Mirrors railroad-club's `LoadStatus`. */
export type LoadStatusName = 'pending' | 'running' | 'success' | 'failed';

export interface LoadStatus {
  status: LoadStatusName;
  error_message: string | null;
  timezone: string | null;
  last_loaded_at: string | null;
  started_at: string | null;
  next_retry_at: string | null;
}

/** Mirrors railroad-club's `FeedSourceKind`. */
export type FeedSourceKind = 'url' | 'hosted';

/**
 * One schedule zip somebody uploaded, as the feed page's history lists it.
 *
 * No `object_key`: where the bytes sit in the bucket is between cafe-car and
 * schedule-foamer, and a client that knew it would be one refactor away from
 * addressing the store directly. An upload is named by its id and reached
 * through the feed's public URL.
 */
export interface GtfsUpload {
  id: string;
  sha256: string;
  size_bytes: number;
  original_filename: string;
  uploaded_by_user_id: number | null;
  uploaded_at: string;
  /** Whether this is the one the feed is serving. Derived server-side. */
  is_current: boolean;
}

export interface Feed {
  id: number;
  feed_name: string;
  source_kind: FeedSourceKind;
  /** Null on a hosted feed, which has no upstream URL to show. */
  static_feed_url: string | null;
  /**
   * Where a consumer downloads the schedule: this feed's own permanent URL
   * when hosted, the upstream one when linked. Null for neither, which the
   * server treats as a feed with no schedule at all.
   */
  hosted_url: string | null;
  /** The upload being served, or null on a linked feed. */
  current_upload: GtfsUpload | null;
  owner_id: number;
  owner_name: string | null;
  /** Whether the caller *is* the owner. An admin on someone else's feed: false. */
  is_owner: boolean;
  /** Whether the caller may transfer, delete or manage members. */
  can_manage: boolean;
  vehicle_positions_url: string;
  trip_updates_url: string;
  service_alerts_url: string;
  /** Null when the feed has never been handed to schedule-foamer. */
  load: LoadStatus | null;
}

/**
 * A new feed. A linked one needs its URL; a hosted one is created empty and
 * gets its zip from the upload that follows, so sending a URL with it is a 422.
 */
export interface FeedCreate {
  feed_name: string;
  source_kind: FeedSourceKind;
  static_feed_url?: string | null;
}

export interface Tracker {
  /** The surrogate. Safe in navigation state, in a map feature key and in a log. */
  id: string;
  nickname: string;
  feed_id: number;
}

export interface TrackerDetail extends Tracker {
  /** The Traccar `uniqueId`. The whole secret; properties panel only. */
  device_key: string;
}

export interface InformedEntity {
  id: number;
  service_alert_id: number;
  agency_id: string | null;
  route_id: string | null;
  route_type: number | null;
  direction_id: number | null;
  stop_id: string | null;
  trip_id: string | null;
  trip_route_id: string | null;
  trip_direction_id: number | null;
  trip_start_time: string | null;
  trip_start_date: string | null;
}

export interface Alert {
  id: number;
  feed_id: number;
  header_text: string;
  description_text: string;
  url: string | null;
  cause: string | null;
  effect: string | null;
  severity_level: string | null;
  active_period_start: string | null;
  active_period_end: string | null;
  entity_count: number;
}

export interface AlertDetail extends Alert {
  entities: InformedEntity[];
}

export interface Member {
  user_id: number;
  email: string | null;
  display_name: string | null;
  is_owner: boolean;
  added_by_user_id: number | null;
  /** Null for the owner, who was never added by anybody. */
  created_at: string | null;
}

export interface Invite {
  id: number;
  email: string;
  invited_by_user_id: number | null;
  created_at: string;
}

export interface Members {
  members: Member[];
  invites: Invite[];
}

export interface RuleException {
  id: number;
  /** YYYY-MM-DD service date. */
  date: string;
  exception_type: 'added' | 'removed';
}

/**
 * A recurrence rule as stored. `start_time`/`end_time` are seconds since
 * service midnight, so an `end_time` past 86400 runs into the next calendar day.
 */
export interface TrackerRule {
  id: number;
  tracker_id: string;
  trip_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  start_date: string;
  end_date: string | null;
  start_time: number;
  end_time: number;
  exceptions: RuleException[];
}

/**
 * One rule occurring on one service date, which is the date the window
 * *starts* in feed-local time and the trip's GTFS-RT `start_date`.
 */
export interface Assignment {
  rule_id: number;
  tracker_id: string;
  tracker_nickname: string;
  trip_id: string;
  service_date: string;
  start_time: number;
  end_time: number;
}

// ─── What a write sends ───────────────────────────────────────────────────────
// One type per request model in cafe-car's `api/schemas.py`. None of them
// carries an `owner_id`, an `id` or a `device_key`: the server does not read
// those from a body, and a type that offered them would suggest otherwise.

/** A feed edit. An absent field is an unchanged one, which is what PATCH means. */
export interface FeedUpdate {
  feed_name?: string;
  /**
   * Moves one way: a hosted feed goes back to a URL by naming one. The other
   * direction is an upload, or activating one the feed already has, because
   * hosting means serving specific bytes and a PATCH carries none.
   */
  source_kind?: FeedSourceKind;
  static_feed_url?: string | null;
}

export interface TrackerCreate {
  nickname: string;
  /**
   * Settable at creation only: it is baked into the provisioned Traccar
   * device. Left out, the server generates a pet-name one.
   */
  device_key?: string;
}

/** Several trackers named `{prefix}{n}`, numbered past whatever exists. */
export interface TrackerBulkCreate {
  prefix: string;
  count: number;
}

/** A rename. `id` and `device_key` are immutable, so neither is here. */
export interface TrackerUpdate {
  nickname: string;
}

/**
 * What a phone needs to report as this tracker. Every field derives from
 * `device_key` and is therefore just as secret, the QR included.
 */
export interface Provisioning {
  device_key: string;
  config_url: string;
  qr_svg: string;
}

/**
 * The editable half of an alert. Every field is sent on every save, so an
 * omitted one is a cleared one.
 */
export interface AlertWrite {
  header_text: string;
  description_text: string;
  url: string | null;
  cause: string | null;
  effect: string | null;
  severity_level: string | null;
  active_period_start: string | null;
  active_period_end: string | null;
}

/** One entity selector. At least one specifier has to be non-null. */
export interface InformedEntityWrite {
  agency_id?: string | null;
  route_id?: string | null;
  route_type?: number | null;
  direction_id?: number | null;
  stop_id?: string | null;
  trip_id?: string | null;
  trip_route_id?: string | null;
  trip_direction_id?: number | null;
  trip_start_time?: string | null;
  trip_start_date?: string | null;
}

/**
 * A rule as written. Every field is sent on every save, so an unchecked
 * weekday is a cleared one and an absent `end_date` is an open-ended rule.
 *
 * `tracker_id` is not here: a rule is one tracker on one trip, the tracker is
 * fixed when the rule is created, and reassigning a trip to somebody else is a
 * different rule rather than an edit to this one.
 */
export interface RuleWrite {
  trip_id: string;
  monday: boolean;
  tuesday: boolean;
  wednesday: boolean;
  thursday: boolean;
  friday: boolean;
  saturday: boolean;
  sunday: boolean;
  /** YYYY-MM-DD, feed-local. */
  start_date: string;
  end_date: string | null;
  /** Seconds since service midnight. Past 86400 is a window crossing midnight. */
  start_time: number;
  end_time: number;
}

/** One date's departure from a rule's recurrence. */
export interface RuleExceptionWrite {
  date: string;
  exception_type: 'added' | 'removed';
}

/**
 * What sharing an address did. `kind` is `member` when the address already had
 * a verified account and `invited` when it did not, and an invite grants
 * nothing until somebody signs in with a verified copy of it.
 */
export interface ShareResult {
  kind: string;
  message: string;
}

// ─── The event channel ────────────────────────────────────────────────────────
// `GET /feeds/{id}/events` frames, mirroring railroad-club's `feed_events.py`.
// cafe-car forwards these unparsed, so the shape is agreed between whoever
// published it and this file, with no server-side schema in between.

/**
 * Where the feed's static load has got to. The first frame of every stream is
 * one of these carrying the current state, so a client never polls to bootstrap.
 */
export interface LoadEvent {
  type: 'load';
  /** Null for a feed the loader has never touched. Not `pending`. */
  load: LoadStatus | null;
}

/**
 * One vehicle's current fix, already in the camelCase shape the map reads, so
 * it goes into `FeedSession.vehicles` without a translation layer.
 *
 * The same object `GET /feeds/{id}/tracker-positions` returns, built by one
 * function in cafe-car's `vehicle_payload.py`. Which of the two a vehicle
 * arrived through is not something anything downstream may be able to tell.
 */
export interface PositionEvent {
  type: 'position';
  vehicle: VehiclePosition;
}

/**
 * A frame off the channel. The union is open on purpose: an event type added
 * upstream reaches an older client as an unrecognised `type`, which it drops
 * rather than treating as an error.
 */
export type FeedEvent = LoadEvent | PositionEvent | { type: string };
