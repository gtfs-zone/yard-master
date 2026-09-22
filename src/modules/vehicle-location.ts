/**
 * Which page a live vehicle opens.
 *
 * A tracker carrying one vehicle is that vehicle, which is every Traccar
 * device: its page is the tracker page and there is no vehicle page to add.
 * Only a tracker carrying several (a producer posting a whole fleet under one
 * credential) hands out a page per vehicle. The count decides it rather than the
 * key's shape, since a single device's key names its vehicle too.
 *
 * The map, search and the trip page all go through here, so a click and a
 * search for the same vehicle cannot land on different pages.
 */

import type { VehiclePosition } from '../map-controller';
import type { PageLocation } from '../types/page-state';

export function vehicleLocation(
  fleet: Iterable<VehiclePosition>,
  vehicle: VehiclePosition
): PageLocation {
  let count = 0;
  for (const other of fleet) {
    if (other.trackerId === vehicle.trackerId && ++count > 1) {
      return { type: 'vehicle', tracker_id: vehicle.trackerId, vehicle_key: vehicle.key };
    }
  }
  return { type: 'tracker', tracker_id: vehicle.trackerId };
}
