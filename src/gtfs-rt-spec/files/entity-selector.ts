/**
 * EntitySelector: what an alert is about.
 *
 * Every id field carries the static table it names, which is what lets the
 * informed-entity form offer the ids in the loaded feed instead of asking
 * somebody to type one.
 */

import type { RTMessageSpec } from '../types';

export const entitySelectorSpec: RTMessageSpec = {
  name: 'EntitySelector',
  description:
    'A selector for an entity in a GTFS feed. The values of the fields should correspond to the appropriate fields in the GTFS feed. At least one specifier must be given. If several are given, they should be interpreted as being joined by the logical `AND` operator. Additionally, the combination of specifiers must match the corresponding information in the GTFS feed. In other words, in order for an alert to apply to an entity in GTFS it must match all of the provided EntitySelector fields. For example, an EntitySelector that includes the fields `route_id: "5"` and `route_type: "3"` applies only to the `route_id: "5"` bus - it does not apply to any other routes of `route_type: "3"`. If a producer wants an alert to apply to `route_id: "5"` as well as `route_type: "3"`, it should provide two separate EntitySelectors, one referencing `route_id: "5"` and another referencing `route_type: "3"`.<br><br>At least one specifier must be given - all fields in an EntitySelector cannot be empty.',
  fields: [
    {
      name: 'agency_id',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The agency_id from the GTFS feed that this selector refers to.',
      gtfsField: { file: 'agency.txt', field: 'agency_id' },
    },
    {
      name: 'route_id',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The route_id from the GTFS that this selector refers to. If direction_id is provided, route_id must also be provided.',
      gtfsField: { file: 'routes.txt', field: 'route_id' },
    },
    {
      name: 'route_type',
      type: 'int32',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The route_type from the GTFS that this selector refers to.',
      gtfsField: { file: 'routes.txt', field: 'route_type' },
    },
    {
      name: 'direction_id',
      type: 'uint32',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The direction_id from the GTFS feed trips.txt file, used to select all trips in one direction for a route, specified by route_id. If direction_id is provided, route_id must also be provided. <br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.<br>',
      experimental: true,
      gtfsField: { file: 'trips.txt', field: 'direction_id' },
    },
    {
      name: 'trip',
      type: 'TripDescriptor',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The trip instance from the GTFS that this selector refers to. This TripDescriptor must resolve to a single trip instance in the GTFS data (e.g., a producer cannot provide only a trip_id for exact_times=0 trips). If the ScheduleRelationship field is populated within this TripDescriptor it will be ignored by consumers when attempting to identify the GTFS trip.',
    },
    {
      name: 'stop_id',
      type: 'string',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'The stop_id from the GTFS feed that this selector refers to.',
      gtfsField: { file: 'stops.txt', field: 'stop_id' },
    },
  ],
};
