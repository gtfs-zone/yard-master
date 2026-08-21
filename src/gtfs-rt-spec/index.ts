/**
 * The GTFS-realtime spec as typed data, in the shape of coloring-book's
 * `src/gtfs-spec/`.
 *
 * It covers the messages this app edits or displays, not the whole reference:
 * an alert and the entities it selects are complete, a trip update and a
 * vehicle position are here for their field descriptions, and everything else
 * the reference defines is deliberately absent. `scripts/check-rt-spec.ts`
 * diffs what is here against `reference/gtfs-realtime-reference.md` and says
 * nothing about what is not.
 *
 * `Cause`, `Effect` and `SeverityLevel` are the source of the alert enum lists
 * the forms and the API bodies use, which is why `managed-render.ts` derives
 * `ALERT_CAUSES` and friends from here rather than listing them again.
 */

import type { RTEnumSpec, RTFieldSpec, RTMessageSpec, RTSpec } from './types';
import { alertSpec, causeSpec, effectSpec, severityLevelSpec } from './files/alert';
import { entitySelectorSpec } from './files/entity-selector';
import { timeRangeSpec } from './files/time-range';
import { translatedStringSpec, translationSpec } from './files/translated-string';
import {
  congestionLevelSpec,
  occupancyStatusSpec,
  vehiclePositionSpec,
  vehicleStopStatusSpec,
} from './files/vehicle-position';
import { tripUpdateSpec } from './files/trip-update';
import { tripDescriptorSpec, tripScheduleRelationshipSpec } from './files/trip-descriptor';

export const gtfsRtSpec: RTSpec = {
  version: '2.0',
  referenceRevision: '2026-08-17',
  messages: [
    alertSpec,
    entitySelectorSpec,
    timeRangeSpec,
    translatedStringSpec,
    translationSpec,
    vehiclePositionSpec,
    tripUpdateSpec,
    tripDescriptorSpec,
  ],
  enums: [
    causeSpec,
    effectSpec,
    severityLevelSpec,
    vehicleStopStatusSpec,
    congestionLevelSpec,
    occupancyStatusSpec,
    tripScheduleRelationshipSpec,
  ],
};

/** A message by name, or undefined for one this module does not cover. */
export function rtMessage(name: string): RTMessageSpec | undefined {
  return gtfsRtSpec.messages.find((m) => m.name === name);
}

/** One field of one message. */
export function rtField(message: string, field: string): RTFieldSpec | undefined {
  return rtMessage(message)?.fields.find((f) => f.name === field);
}

/** An enum by name. Only one `ScheduleRelationship` is covered, so this is unambiguous. */
export function rtEnum(name: string): RTEnumSpec | undefined {
  return gtfsRtSpec.enums.find((e) => e.name === name);
}

/**
 * The values of an enum, in reference order. Throws rather than returning an
 * empty list: every caller names an enum this module declares, so a miss is a
 * typo, and a silently empty select is worse than a failed build.
 */
export function rtEnumValues(name: string): readonly string[] {
  const spec = rtEnum(name);
  if (!spec) throw new Error(`gtfs-rt-spec: no enum named ${name}`);
  return spec.values.map((v) => v.value);
}

export type { RTEnumSpec, RTEnumValue, RTFieldSpec, RTMessageSpec, RTSpec } from './types';
