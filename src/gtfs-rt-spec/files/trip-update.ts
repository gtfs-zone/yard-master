/** TripUpdate, the message trip-updogger publishes. */

import type { RTMessageSpec } from '../types';

export const tripUpdateSpec: RTMessageSpec = {
  name: 'TripUpdate',
  description:
    "Realtime update on the progress of a vehicle along a trip. Please also refer to the general discussion of the [trip updates entities](trip-updates.md).<br><br>Depending on the value of ScheduleRelationship, a TripUpdate can specify:<br><br>* A trip that proceeds along the schedule. * A trip that proceeds along a route but has no fixed schedule. * A trip that has been added or removed with regard to schedule. * A trip that replaces an existing trip in static GTFS. * A new trip that is a copy of an existing trip in static GTFS. It will run at the service date and time specified in TripProperties.<br><br>The updates can be for future, predicted arrival/departure events, or for past events that already occurred. In most cases information about past events is a measured value thus its uncertainty value is recommended to be 0\\. Although there could be cases when this does not hold so it is allowed to have uncertainty value different from 0 for past events. If an update's uncertainty is not 0, either the update is an approximate prediction for a trip that has not completed or the measurement is not precise or the update was a prediction for the past that has not been verified after the event occurred.<br><br>If a vehicle is serving multiple trips within the same block (for more information about trips and blocks, please refer to [GTFS trips.txt](https://github.com/google/transit/blob/master/gtfs/spec/en/reference.md#tripstxt)):<br><br>* the feed should include a TripUpdate for the trip currently being served by the vehicle. Producers are encouraged to include TripUpdates for one or more trips after the current trip in this vehicle's block if the producer is confident in the quality of the predictions for these future trip(s). Including multiple TripUpdates for the same vehicle avoids prediction \"pop-in\" for riders as the vehicle transitions from one trip to another and also gives riders advance notice of delays that impact downstream trips (e.g., when the known delay exceeds planned layover times between trips). * the respective TripUpdate entities are not required to be added to the feed in the same order that they are scheduled in the block. For example, if there are trips with `trip_ids` 1, 2, and 3 that all belong to one block, and the vehicle travels trip 1, then trip 2, and then trip 3, the `trip_update` entities may appear in any order - for example, adding trip 2, then trip 1, and then trip 3 is allowed.<br><br>Note that the update can describe a trip that has already completed. To this end, it is enough to provide an update for the last stop of the trip. If the time of arrival at the last stop is in the past, the client will conclude that the whole trip is in the past (it is possible, although inconsequential, to also provide updates for preceding stops). This option is most relevant for a trip that has completed ahead of schedule, but according to the schedule, the trip is still proceeding at the current time. Removing the updates for this trip could make the client assume that the trip is still proceeding. Note that the feed provider is allowed, but not required, to purge past updates - this is one case where this would be practically useful.",
  fields: [
    {
      name: 'trip',
      type: 'TripDescriptor',
      presence: 'Required',
      cardinality: 'One',
      description:
        'The Trip that this message applies to. There can be at most one TripUpdate entity for each actual trip instance. If there is none, that means there is no prediction information available. It does *not* mean that the trip is progressing according to schedule.',
    },
    {
      name: 'vehicle',
      type: 'VehicleDescriptor',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Additional information on the vehicle that is serving this trip.',
    },
    {
      name: 'stop_time_update',
      type: 'StopTimeUpdate',
      presence: 'Conditionally Required',
      cardinality: 'Many',
      description:
        'Updates to StopTimes for the trip (both future, i.e., predictions, and in some cases, past ones, i.e., those that already happened). The updates must be sorted by stop_sequence, and apply for all the following stops of the trip up to the next specified stop_time_update.<br>If trip.schedule_relationship is SCHEDULED or UNSCHEDULED, at least one stop_time_update must be provided for the trip.<br>If trip.schedule_relationship is NEW or REPLACEMENT, stop_time_updates must be provided for all stops in the new or replacement trip, including stops with times in the past, and the stop times in the static GTFS are not used.<br>If the trip is canceled or deleted, no stop_time_updates need to be provided. If stop_time_updates are provided for a canceled or deleted trip then the trip.schedule_relationship takes precedence over any stop_time_updates and their associated schedule_relationship. If the trip is duplicated, stop_time_updates may be provided to indicate real-time information for the new trip.',
    },
    {
      name: 'timestamp',
      type: 'uint64',
      presence: 'Optional',
      cardinality: 'One',
      description:
        "The most recent moment at which the vehicle's real-time progress was measured to estimate StopTimes in the future. When StopTimes in the past are provided, arrival/departure times may be earlier than this value. In POSIX time (i.e., the number of seconds since January 1st 1970 00:00:00 UTC).",
    },
    {
      name: 'delay',
      type: 'int32',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'The current schedule deviation for the trip. Delay should only be specified when the prediction is given relative to some existing schedule in GTFS.<br>Delay (in seconds) can be positive (meaning that the vehicle is late) or negative (meaning that the vehicle is ahead of schedule). Delay of 0 means that the vehicle is exactly on time.<br>Delay information in StopTimeUpdates take precedent of trip-level delay information, such that trip-level delay is only propagated until the next stop along the trip with a StopTimeUpdate delay value specified.<br>Feed providers are strongly encouraged to provide a TripUpdate.timestamp value indicating when the delay value was last updated, in order to evaluate the freshness of the data.<br><br>**Caution:** this field is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
    },
    {
      name: 'trip_properties',
      type: 'TripProperties',
      presence: 'Optional',
      cardinality: 'One',
      description:
        'Provides the updated properties for the trip. <br><br>**Caution:** this message is still **experimental**, and subject to change. It may be formally adopted in the future.',
      experimental: true,
    },
  ],
};
