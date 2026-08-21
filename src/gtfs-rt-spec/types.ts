/**
 * The shape of the GTFS-realtime spec data.
 *
 * Modelled on coloring-book's `src/gtfs-spec/types.ts`, but for the realtime
 * reference rather than the schedule one, so a field carries a Cardinality as
 * well as a Required value and an enum is a top-level object rather than a
 * list hanging off one field: `Cause` is referenced by name because the same
 * enum is reachable from more than one place.
 *
 * Everything marked verbatim is diffed against `reference/` by
 * `scripts/check-rt-spec.ts`. Everything marked curated is this repo's own and
 * is not checked, because the reference has nowhere to put it.
 */

/** The reference's *Required* column. */
export type RTPresence =
  | 'Required'
  | 'Optional'
  | 'Conditionally Required'
  | 'Conditionally Forbidden';

/** The reference's *Cardinality* column. */
export type RTCardinality = 'One' | 'Many';

export interface RTEnumValue {
  /** Verbatim enum name, e.g. `SIGNIFICANT_DELAYS`. */
  value: string;
  /** Curated. `Significant delays`, for a select row. */
  label: string;
  /**
   * Verbatim Comment column. Empty for the enums the reference lists as bare
   * values, which includes Cause and Effect.
   */
  description: string;
}

export interface RTEnumSpec {
  name: string;
  /** Verbatim prose between the heading and the values table. */
  description: string;
  values: RTEnumValue[];
  experimental?: boolean;
  /**
   * 1-based ordinal when the reference declares more than one enum under this
   * name. `ScheduleRelationship` is declared twice, once for a stop time and
   * once for a trip, with different values in each.
   */
  referenceOccurrence?: number;
}

/** Curated: the static GTFS column a field names, for the phase 8 id pickers. */
export interface RTGtfsFieldRef {
  file: string;
  field: string;
}

export interface RTFieldSpec {
  name: string;
  /** Verbatim type, as the link text in the reference's *Type* column. */
  type: string;
  presence: RTPresence;
  cardinality: RTCardinality;
  description: string;
  experimental?: boolean;
  /** Curated. Names an `RTEnumSpec`, which for a duplicate name is qualified. */
  enumName?: string;
  /** Curated. */
  gtfsField?: RTGtfsFieldRef;
}

export interface RTMessageSpec {
  name: string;
  /** Verbatim prose between the heading and the fields table. */
  description: string;
  fields: RTFieldSpec[];
  experimental?: boolean;
}

export interface RTSpec {
  /** The feed spec version this describes. */
  version: string;
  /** The `reference/README.md` revision the data was taken from. */
  referenceRevision: string;
  messages: RTMessageSpec[];
  enums: RTEnumSpec[];
}
