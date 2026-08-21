/** TimeRange: an alert's active, communication or impact window. */

import type { RTMessageSpec } from '../types';

export const timeRangeSpec: RTMessageSpec = {
  name: 'TimeRange',
  description:
    'A time interval. The interval is considered active at time `t` if `t` is greater than or equal to the start time and less than the end time.',
  fields: [
    {
      name: 'start',
      type: 'uint64',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'Start time, in POSIX time (i.e., number of seconds since January 1st 1970 00:00:00 UTC). If missing, the interval starts at minus infinity.  If a TimeRange is provided, either start or end must be provided - both fields cannot be empty.',
    },
    {
      name: 'end',
      type: 'uint64',
      presence: 'Conditionally Required',
      cardinality: 'One',
      description:
        'End time, in POSIX time (i.e., number of seconds since January 1st 1970 00:00:00 UTC). If missing, the interval ends at plus infinity. If a TimeRange is provided, either start or end must be provided - both fields cannot be empty.',
    },
  ],
};
