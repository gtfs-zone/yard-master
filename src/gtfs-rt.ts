/* @vendored-from test-track:src/gtfs-rt.ts
   @sha e770356
   @status modified
   @changes
   - `e770356` reaches only the decoder: it captures a `TripDescriptor`'s
     `schedule_relationship` while building a `VehiclePosition`. Nothing here
     builds one, so the field is declared on the type in `map-controller.ts`
     and filled by cafe-car.
   - The poller is gone. `GTFSRealtime`, `decodeFeed`, `readHeader`,
     `deriveVehicleKeys` and the status types they answer with (`FeedStatus`,
     `EndpointStatus`, `RawFeedHeader`, `VehicleIdStrategy`,
     `DuplicateVehicleId`, `FetchStartDetail`) went with it. yard-master never
     fetches a `.pb`: its live half arrives on the SSE channel, already shaped.
   - `transit_realtime` is imported as a **type**, so nothing pulls protobufjs
     into the bundle. It survived tree-shaking while `FeedMessage.decode` was
     still reachable, at roughly a quarter of the built JS for a decoder no code
     path could reach.
   - `present` went with the decoder; `presentNumber`, which two vendored
     modules still call, is unchanged. */
/**
 * The GTFS-RT types the vendored panel and map modules are written against.
 *
 * Types only, plus the one runtime helper that reads them. `gtfs-realtime-bindings`
 * is a devDependency for exactly this reason: the interfaces it declares are the
 * honest description of a GTFS-RT message and are worth keeping, while the
 * generated decoder underneath them is 400kB this app has no use for.
 *
 * That is not a shortcut around the spec. A `VehiclePosition` on the channel is
 * still a GTFS-RT vehicle position, published by cafe-car from the same record
 * the public `.pb` is built from; what changes is that it arrives as JSON that
 * has already been decoded, rather than as bytes this browser has to decode.
 */
import type { transit_realtime } from 'gtfs-realtime-bindings';

export type TripUpdate = transit_realtime.ITripUpdate;
export type ServiceAlert = transit_realtime.IAlert;

/**
 * An alert plus the identity it is addressed by.
 *
 * GTFS-RT alerts carry no id of their own — only the enclosing `FeedEntity.id`
 * — so that is what the alert page is keyed on. Some producers regenerate
 * entity ids between polls, which means a focused alert can vanish even though
 * the same disruption is still being reported. There is nothing better to key
 * on; the UI has to tolerate it.
 */
export interface AlertRecord {
  id: string;
  alert: ServiceAlert;
  /** Plain-object form of the same alert, for the alert page's raw dump. */
  raw: unknown;
}

/**
 * A numeric field, or `undefined` when the producer did not send it.
 *
 * Whether a field was actually on the wire is an own-property question, not a
 * nullish one. The generated bindings keep every proto2 default on the message
 * *prototype* (`VehiclePosition.prototype.currentStopSequence = 0`,
 * `currentStatus = 2`), and a decoder only assigns own properties for what it
 * read, so `msg.currentStopSequence ?? undefined` can never yield `undefined`
 * and an absent field is indistinguishable from a reported zero unless the
 * own-property is checked.
 *
 * Reading such a field without that check is worse than useless: an absent
 * `int64` reads back as `Long{0,0}`, which is finite, so the value comes out as
 * `0` — midnight 1970 for a time, "on time" for a delay. Both are things the
 * feed never said. The coercion is for the same 64-bit fields: they decode to
 * `Long` objects rather than numbers, and `Number(long)` goes through the
 * Long's own `toString`, so this works whether or not Long support was
 * installed.
 *
 * `msg` is nullable so the whole containing message may be absent, as in
 * `presentNumber(stu.arrival, 'time')`.
 */
export function presentNumber(msg: object | null | undefined, field: string): number | undefined {
  if (!msg || !Object.prototype.hasOwnProperty.call(msg, field)) return undefined;
  const n = Number((msg as Record<string, unknown>)[field]);
  return Number.isFinite(n) ? n : undefined;
}
