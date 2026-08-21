/** VehiclePosition and the three enums a position can carry. */

import type { RTEnumSpec, RTMessageSpec } from '../types';

export const vehiclePositionSpec: RTMessageSpec = {
  name: 'VehiclePosition',
  description:
    'Realtime positioning information for a given vehicle.',
  fields: [
    {
      name: 'trip',
      type: 'TripDescriptor',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The Trip that this vehicle is serving. Can be empty or partial if the vehicle can not be identified with a given trip instance.',
    },
    {
      name: 'vehicle',
      type: 'VehicleDescriptor',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Additional information on the vehicle that is serving this trip. Each entry should have a **unique** vehicle id.',
    },
    {
      name: 'position',
      type: 'Position',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Current position of this vehicle.',
    },
    {
      name: 'current_stop_sequence',
      type: 'uint32',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The stop sequence index of the current stop. The meaning of current_stop_sequence (i.e., the stop that it refers to) is determined by current_status. If current_status is missing IN_TRANSIT_TO is assumed.',
    },
    {
      name: 'stop_id',
      type: 'string',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Identifies the current stop. The value must be the same as in stops.txt in the corresponding GTFS feed. If `StopTimeProperties.assigned_stop_id` is used to assign a `stop_id`, this field should also reflect the change in `stop_id`.',
      gtfsField: { file: 'stops.txt', field: 'stop_id' },
    },
    {
      name: 'current_status',
      type: 'VehicleStopStatus',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The exact status of the vehicle with respect to the current stop. Ignored if current_stop_sequence is missing.',
      enumName: 'VehicleStopStatus',
    },
    {
      name: 'timestamp',
      type: 'uint64',
      presence: 'Optional',
      cardinality: 'One',
      description:
        "Moment at which the vehicle's position was measured. In POSIX time (i.e., number of seconds since January 1st 1970 00:00:00 UTC).",
    },
    {
      name: 'congestion_level',
      type: 'CongestionLevel',
      presence: 'Optional',
      cardinality: 'One',
      description:
        '',
      enumName: 'CongestionLevel',
    },
    {
      name: 'occupancy_status',
      type: 'OccupancyStatus',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The state of passenger occupancy for the vehicle or carriage. If multi_carriage_details is populated with per-carriage OccupancyStatus, then this field should describe the entire vehicle with all carriages accepting passengers considered.<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
      enumName: 'OccupancyStatus',
    },
    {
      name: 'occupancy_percentage',
      type: 'uint32',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'A percentage value indicating the degree of passenger occupancy in the vehicle. The value 100 should represent the total maximum occupancy the vehicle was designed for, including both seating and standing capacity, and current operating regulations allow. The value may exceed 100 if there are more passengers than the maximum designed capacity. The precision of occupancy_percentage should be low enough that individual passengers cannot be tracked boarding or alighting the vehicle. If multi_carriage_details is populated with per-carriage occupancy_percentage, then this field should describe the entire vehicle with all carriages accepting passengers considered.<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
    },
    {
      name: 'multi_carriage_details',
      type: 'CarriageDetails',
      presence: 'Optional',
      cardinality: 'Many',
      description:
        'Details of the multiple carriages of this given vehicle. The first occurrence represents the first carriage of the vehicle, **given the current direction of travel**. The number of occurrences of the multi_carriage_details field represents the number of carriages of the vehicle. It also includes non boardable carriages, like engines, maintenance carriages, etc… as they provide valuable information to passengers about where to stand on a platform.<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
    },
  ],
};

export const vehicleStopStatusSpec: RTEnumSpec = {
  name: 'VehicleStopStatus',
  description:
    '',
  values: [
    {
      value: 'INCOMING_AT',
      label: 'Incoming at',
      description:
        'The vehicle is just about to arrive at the stop (on a stop display, the vehicle symbol typically flashes).',
    },
    {
      value: 'STOPPED_AT',
      label: 'Stopped at',
      description:
        'The vehicle is standing at the stop.',
    },
    {
      value: 'IN_TRANSIT_TO',
      label: 'In transit to',
      description:
        'The vehicle has departed the previous stop and is in transit.',
    },
  ],
};

export const congestionLevelSpec: RTEnumSpec = {
  name: 'CongestionLevel',
  description:
    'Congestion level that is affecting this vehicle.',
  values: [
    {
      value: 'UNKNOWN_CONGESTION_LEVEL',
      label: 'Unknown congestion level',
      description:
        '',
    },
    {
      value: 'RUNNING_SMOOTHLY',
      label: 'Running smoothly',
      description:
        '',
    },
    {
      value: 'STOP_AND_GO',
      label: 'Stop and go',
      description:
        '',
    },
    {
      value: 'CONGESTION',
      label: 'Congestion',
      description:
        '',
    },
    {
      value: 'SEVERE_CONGESTION',
      label: 'Severe congestion',
      description:
        '',
    },
  ],
};

export const occupancyStatusSpec: RTEnumSpec = {
  name: 'OccupancyStatus',
  description:
    'The state of passenger occupancy for the vehicle or carriage.<br><br>Individual producers may not publish all OccupancyStatus values. Therefore, consumers must not assume that the OccupancyStatus values follow a linear scale. Consumers should represent OccupancyStatus values as the state indicated and intended by the producer. Likewise, producers must use OccupancyStatus values that correspond to actual vehicle occupancy states.<br><br>For describing passenger occupancy levels on a linear scale, see `occupancy_percentage`.',
  experimental: true,
  values: [
    {
      value: 'EMPTY',
      label: 'Empty',
      description:
        '_The vehicle is considered empty by most measures, and has few or no passengers onboard, but is still accepting passengers._',
    },
    {
      value: 'MANY_SEATS_AVAILABLE',
      label: 'Many seats available',
      description:
        '_The vehicle or carriage has a large number of seats available. The amount of free seats out of the total seats available to be considered large enough to fall into this category is determined at the discretion of the producer._',
    },
    {
      value: 'FEW_SEATS_AVAILABLE',
      label: 'Few seats available',
      description:
        '_The vehicle or carriage has a small number of seats available. The amount of free seats out of the total seats available to be considered small enough to fall into this category is determined at the discretion of the producer._',
    },
    {
      value: 'STANDING_ROOM_ONLY',
      label: 'Standing room only',
      description:
        '_The vehicle or carriage can currently accommodate only standing passengers._',
    },
    {
      value: 'CRUSHED_STANDING_ROOM_ONLY',
      label: 'Crushed standing room only',
      description:
        '_The vehicle or carriage can currently accommodate only standing passengers and has limited space for them._',
    },
    {
      value: 'FULL',
      label: 'Full',
      description:
        '_The vehicle is considered full by most measures, but may still be allowing passengers to board._',
    },
    {
      value: 'NOT_ACCEPTING_PASSENGERS',
      label: 'Not accepting passengers',
      description:
        '_The vehicle or carriage is not accepting passengers. The vehicle or carriage usually accepts passengers for boarding._',
    },
    {
      value: 'NO_DATA_AVAILABLE',
      label: 'No data available',
      description:
        "_The vehicle or carriage doesn't have any occupancy data available at that time._",
    },
    {
      value: 'NOT_BOARDABLE',
      label: 'Not boardable',
      description:
        '_The vehicle or carriage is not boardable and never accepts passengers. Useful for special vehicles or carriages (engine, maintenance carriage, etc…)._',
    },
  ],
};
