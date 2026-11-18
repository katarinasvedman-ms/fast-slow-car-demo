import type { HazardVariant, SceneView, WorldState } from './types.js';

export function senseContact(world: Pick<WorldState, 'hazard' | 'hazardActive'>): SceneView['contact'] {
  return world.hazardActive ? { lane: world.hazard.lane, rangeM: world.hazard.distanceM } : null;
}

export function observeScene(world: WorldState, variant: HazardVariant): SceneView {
  const contactDescription = variant === 'ambiguous'
    ? 'Partially occluded quadruped silhouette; most returns indicate a low compact body, but one intermittent upright return suggests possible greater size. Estimated mass uncertain.'
    : variant === 'small_animal'
      ? 'Low compact silhouette close to the ground, estimated mass low.'
      : 'Large quadruped silhouette, estimated mass high, upright stance.';
  return {
    contact: senseContact(world),
    contactDescription: world.hazardActive ? contactDescription : 'No active sensor contact.',
    roadSurface: world.roadSurface,
    followingVehicle: world.followingVehicle ? {
      lane: world.followingVehicle.lane,
      distanceBehindM: world.followingVehicle.distanceBehindM,
      speedKmh: world.followingVehicle.speedKmh,
      closingSpeedKmh: (world.followingVehicle.speedKmh - world.speedKmh) *
        (world.followingVehicle.distanceBehindM >= 0 ? 1 : -1),
    } : null,
    lanes: ([1, 2, 3] as const).map((lane) => {
      const blocked = world.adjacentLanesBlocked.includes(lane);
      const follower = world.followingVehicle?.lane === lane ? world.followingVehicle : null;
      return {
        lane,
        vehicleBehindM: follower ? follower.distanceBehindM >= 0 ? follower.distanceBehindM : null
          : blocked ? world.adjacentVehicleDistanceBehindM : null,
        ...(follower && follower.distanceBehindM < 0 ? { vehicleAheadM: -follower.distanceBehindM } : {}),
        clearAheadM: blocked || (follower && follower.distanceBehindM < 0) ? null : world.clearLaneDistanceM,
      };
    }),
  };
}

export function buildObservation(world: WorldState, variant: HazardVariant): string {
  const scene = observeScene(world, variant);
  if (!scene.contact) throw new Error('Cannot capture a model observation without an active sensor contact.');
  const laneObservations = scene.lanes
    .map(({ lane, vehicleBehindM, vehicleAheadM, clearAheadM }) => `Lane ${lane}: ${vehicleAheadM !== undefined
      ? `vehicle detected ${Math.round(vehicleAheadM)} m ahead` : vehicleBehindM !== null
        ? `vehicle detected ${Math.round(vehicleBehindM)} m behind${clearAheadM === null ? '' : `; clear ahead to ${clearAheadM} m`}` : `clear to ${clearAheadM} m`}.`);
  const following = scene.followingVehicle;
  return [
    `Thermal and radar contact ahead in lane ${scene.contact.lane}, range ${Math.round(scene.contact.rangeM)} m, closing.`,
    scene.contactDescription,
    `Ego vehicle occupies lane ${world.carLane}.`,
    world.laneChange
      ? `Lane change from lane ${world.laneChange.fromLane} to lane ${world.laneChange.toLane} in progress: ${world.laneChange.elapsedTicks}/${world.laneChange.durationTicks} ticks complete; both lanes remain occupied.`
      : 'No lane change in progress.',
    'Lane clearance describes other traffic; the forward sensor contact is reported separately.',
    ...laneObservations,
    ...(following ? [
      `Traffic radar: following vehicle in lane ${following.lane}, ${Math.round(Math.abs(following.distanceBehindM))} m ${following.distanceBehindM >= 0 ? 'behind' : 'ahead'}, ` +
      `speed ${Math.round(following.speedKmh)} km/h, relative closing speed ${Math.round(following.closingSpeedKmh)} km/h (positive means the gap is shrinking).`,
    ] : []),
    `Vehicle speed ${Math.round(world.speedKmh)} km/h. Road surface ${scene.roadSurface}.`,
  ].join('\n');
}
