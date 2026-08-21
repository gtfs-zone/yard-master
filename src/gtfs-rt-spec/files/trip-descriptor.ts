/**
 * TripDescriptor and its ScheduleRelationship.
 *
 * The reference declares two enums named ScheduleRelationship, one for a stop
 * time and one for a trip, with different values in each. This is the trip's,
 * hence `referenceOccurrence: 2`.
 */

import type { RTEnumSpec, RTMessageSpec } from '../types';

export const tripDescriptorSpec: RTMessageSpec = {
  name: 'TripDescriptor',
  description:
    "A descriptor that identifies a single instance of a GTFS trip, unless `schedule_relationship` is `NEW`, in such case, it specifies a new instance of trip to be added.<br><br>To specify a single trip instance, in many cases a `trip_id` by itself is sufficient. However, the following cases require additional information to resolve to a single trip instance:<br><br>* For trips defined in frequencies.txt, `start_date` and `start_time` are required in addition to `trip_id` * If the trip lasts for more than 24 hours, or is delayed such that it would collide with a scheduled trip on the following day, then `start_date` is required in addition to `trip_id` * If the `trip_id` field can't be provided, then `route_id`, `direction_id`, `start_date`, and `start_time` must all be provided<br><br>In all cases, if `route_id` is provided in addition to `trip_id`, then the `route_id` must be the same `route_id` as assigned to the given trip in GTFS trips.txt.<br><br>The `trip_id` field cannot, by itself or in combination with other TripDescriptor fields, be used to identify multiple trip instances. For example, a TripDescriptor should never specify trip_id by itself for GTFS frequencies.txt exact_times=0 trips because start_time is also required to resolve to a single trip instance starting at a specific time of the day. If the TripDescriptor does not resolve to a single trip instance (i.e., it resolves to zero or multiple trip instances), it is considered an error and the entity containing the erroneous TripDescriptor may be discarded by consumers.<br><br>Note that if the trip_id is not known, then station sequence ids in TripUpdate are not sufficient, and stop_ids must be provided as well. In addition, absolute arrival/departure times must be provided.<br><br>TripDescriptor.route_id cannot be used within an Alert EntitySelector to specify a route-wide alert that affects all trips for a route - use EntitySelector.route_id instead.<br><br>If `schedule_relationship` is `NEW`, `trip_id` must be set to a value not listed in the GTFS feed, and `route_id` must be set to a value listed in `routes.txt` in the GTFS static, to associate the trip to a route. `start_date` should be set, and `direction_id` may be set for the new trip.",
  fields: [
    {
      name: 'trip_id',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The trip_id from the GTFS feed that this selector refers to. For non frequency-based trips (trips not defined in GTFS frequencies.txt), this field is enough to uniquely identify the trip. For frequency-based trips defined in GTFS frequencies.txt, trip_id, start_time, and start_date are all required. For scheduled-based trips (trips not defined in GTFS frequencies.txt), trip_id can only be omitted if the trip can be uniquely identified by a combination of route_id, direction_id, start_time, and start_date, and all those fields are provided. When schedule_relationship is NEW, it must be specified with a unique value not defined in the GTFS static. When schedule_relationship is REPLACEMENT, the trip_id identifies the trip from static GTFS to be replaced. When schedule_relationship is DUPLICATED within a TripUpdate, the trip_id identifies the trip from static GTFS to be duplicated. When schedule_relationship is DUPLICATED within a VehiclePosition, the trip_id identifies the new duplicate trip and must contain the value for the corresponding TripUpdate.TripProperties.trip_id.',
      gtfsField: { file: 'trips.txt', field: 'trip_id' },
    },
    {
      name: 'route_id',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The route_id from the GTFS that this selector refers to. If trip_id is omitted, route_id, direction_id, start_time, and schedule_relationship=SCHEDULED must all be set to identify a trip instance. TripDescriptor.route_id should not be used within an Alert EntitySelector to specify a route-wide alert that affects all trips for a route - use EntitySelector.route_id instead. When schedule_relationship is NEW, route_id must be specified for route which the new trip belongs to.',
      gtfsField: { file: 'routes.txt', field: 'route_id' },
    },
    {
      name: 'direction_id',
      type: 'uint32',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The direction_id from the GTFS feed trips.txt file, indicating the direction of travel for trips this selector refers to. If trip_id is omitted, direction_id must be provided. <br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.<br>',
      experimental: true,
      gtfsField: { file: 'trips.txt', field: 'direction_id' },
    },
    {
      name: 'start_time',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The initially scheduled start time of this trip instance. When the trip_id corresponds to a non-frequency-based trip, this field should either be omitted or be equal to the value in the GTFS feed. When the trip_id correponds to a frequency-based trip defined in GTFS frequencies.txt, start_time is required and must be specified for trip updates and vehicle positions. If the trip corresponds to exact_times=1 GTFS record, then start_time must be some multiple (including zero) of headway_secs later than frequencies.txt start_time for the corresponding time period. If the trip corresponds to exact_times=0, then its start_time may be arbitrary, and is initially expected to be the first departure of the trip. Once established, the start_time of this frequency-based exact_times=0 trip should be considered immutable, even if the first departure time changes -- that time change may instead be reflected in a StopTimeUpdate. If trip_id is omitted, start_time must be provided. Format and semantics of the field is same as that of GTFS/frequencies.txt/start_time, e.g., 11:15:35 or 25:15:35.',
    },
    {
      name: 'start_date',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The start date of this trip instance in YYYYMMDD format. For scheduled trips (trips not defined in GTFS frequencies.txt), this field must be provided to disambiguate trips that are so late as to collide with a scheduled trip on a next day. For example, for a train that departs 8:00 and 20:00 every day, and is 12 hours late, there would be two distinct trips on the same time. This field can be provided but is not mandatory for schedules in which such collisions are impossible - for example, a service running on hourly schedule where a vehicle that is one hour late is not considered to be related to schedule anymore. This field is required for frequency-based trips defined in GTFS frequencies.txt. If trip_id is omitted, start_date must be provided.',
    },
    {
      name: 'schedule_relationship',
      type: 'ScheduleRelationship',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The relation between this trip and the static schedule. If TripDescriptor is provided in an Alert `EntitySelector`, the `schedule_relationship` field is ignored by consumers when identifying the matching trip instance.',
      enumName: 'ScheduleRelationship',
    },
    {
      name: 'modified_trip',
      type: 'ModifiedTripSelector',
      presence: 'Optional',
      cardinality: 'One',
      description:
        "Linkage to any modifications done to this trip (shape changes, removal or addition of stops). If this field is provided, the `trip_id`, `route_id`, `direction_id`, `start_time`, `start_date` fields of the `TripDescriptor` MUST be left empty, to avoid confusion by consumers that aren't looking for the `ModifiedTripSelector` value.",
    },
  ],
};

export const tripScheduleRelationshipSpec: RTEnumSpec = {
  name: 'ScheduleRelationship',
  description:
    "The relation between this trip and the static schedule. If a new trip is done in accordance with temporary schedule, not reflected in GTFS, then it shouldn't be marked as SCHEDULED, but marked as NEW. If a trip is done in accordance with a modified schedule, not reflected in GTFS, then it shouldn't be marked as SCHEDULED, but marked as REPLACEMENT.",
  referenceOccurrence: 2,
  values: [
    {
      value: 'SCHEDULED',
      label: 'Scheduled',
      description:
        'Trip that is running in accordance with its GTFS schedule, or is close enough to the scheduled trip to be associated with it.',
    },
    {
      value: 'ADDED',
      label: 'Added',
      description:
        '*NOTE: This value has been deprecated as the behavior was unspecified. Use **DUPLICATED** for an extra trip that is the same as a scheduled trip except the start date or time, or **NEW** for an extra trip that is unrelated to an existing trip.*',
    },
    {
      value: 'UNSCHEDULED',
      label: 'Unscheduled',
      description:
        'A trip that is running with no schedule associated to it - this value is used to identify trips defined in GTFS frequencies.txt with exact_times = 0. It should not be used to describe trips not defined in GTFS frequencies.txt, or trips in GTFS frequencies.txt with exact_times = 1. Trips with `schedule_relationship: UNSCHEDULED` must also set all StopTimeUpdates `schedule_relationship: UNSCHEDULED`',
    },
    {
      value: 'CANCELED',
      label: 'Canceled',
      description:
        'A trip that existed in the schedule but was removed.',
    },
    {
      value: 'REPLACEMENT',
      label: 'Replacement',
      description:
        "A trip that replaces an existing scheduled trip, for example, with a changed schedule or a diverted routing. The complete journey of the replacement trip must be specified via `StopTimeUpdate`s, and the original schedule from the GTFS static isn't used for the replaced instance.<br>`REPLACEMENT` can be used if the trip is operating on a revised schedule, but must not be used to communicate real-time schedule deviations (predictions) if the vehicle is aimed to follow the schedule listed in `stop_times.txt` the static GTFS.<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.",
    },
    {
      value: 'DUPLICATED',
      label: 'Duplicated',
      description:
        'A new trip that is the same as an existing scheduled trip except for service start date and time. Used with `TripUpdate.TripProperties.trip_id`, `TripUpdate.TripProperties.start_date`, and `TripUpdate.TripProperties.start_time` to copy an existing trip from static GTFS but start at a different service date and/or time. Duplicating a trip is allowed if the service related to the original trip in (CSV) GTFS (in `calendar.txt` or `calendar_dates.txt`) is operating within the next 30 days. The trip to be duplicated is identified via `TripUpdate.TripDescriptor.trip_id`. <br><br> This enumeration does not modify the existing trip referenced by `TripUpdate.TripDescriptor.trip_id` - if a producer wants to cancel the original trip, it must publish a separate `TripUpdate` with the value of CANCELED. Trips defined in GTFS `frequencies.txt` with `exact_times` that is empty or equal to `0` cannot be duplicated. The `VehiclePosition.TripDescriptor.trip_id` for the new trip must contain the matching value from `TripUpdate.TripProperties.trip_id` and `VehiclePosition.TripDescriptor.ScheduleRelationship` must also be set to `DUPLICATED`.  <br><br>*Existing producers and consumers that were using the ADDED enumeration to represent duplicated trips must follow the [migration guide](/gtfs-realtime/spec/en/examples/migration-duplicated.md) to transition to the DUPLICATED enumeration.*',
    },
    {
      value: 'NEW',
      label: 'New',
      description:
        'An extra trip unrelated to any existing trips, for example, to respond to sudden passenger load. The complete journey of the new trip, including all stops and times, must be specified via `StopTimeUpdate`s.   <br><br>*Existing producers and consumers that were using the ADDED enumeration to represent new trips unrelated to the static GTFS must follow the [migration guide](/gtfs-realtime/spec/en/examples/migration-duplicated.md) to transition to the NEW enumeration.*<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
    },
    {
      value: 'DELETED',
      label: 'Deleted',
      description:
        'A trip that existed in the schedule but was removed that must not be shown to users. <br><br> DELETED should be used instead of CANCELED to indicate that a transit provider would like to entirely remove information about the corresponding trip from consuming applications, so the trip is not shown as cancelled to riders, e.g. a trip that is entirely being replaced by another trip. This designation becomes particularly important if several trips are cancelled and replaced with substitute service. If consumers were to show explicit information about the cancellations it would distract from the more important real-time predictions.<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
    },
  ],
};
