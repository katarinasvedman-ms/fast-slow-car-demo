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
    lanes: ([1, 2, 3] as const).map((lane) => {
      const blocked = world.adjacentLanesBlocked.includes(lane);
      return {
        lane,
        vehicleBehindM: blocked ? world.adjacentVehicleDistanceBehindM : null,
        clearAheadM: blocked ? null : world.clearLaneDistanceM,
      };
    }),
  };
}

export function buildObservation(world: WorldState, variant: HazardVariant): string {
  const scene = observeScene(world, variant);
  if (!scene.contact) throw new Error('Cannot capture a model observation without an active sensor contact.');
  const laneObservations = scene.lanes
    .filter(({ lane }) => lane !== world.carLane)
    .map(({ lane, vehicleBehindM, clearAheadM }) => `Lane ${lane}: ${vehicleBehindM !== null
      ? `vehicle detected ${vehicleBehindM} m behind` : `clear to ${clearAheadM} m`}.`);
  return [
    `Thermal and radar contact ahead in lane ${scene.contact.lane}, range ${Math.round(scene.contact.rangeM)} m, closing.`,
    scene.contactDescription,
    ...laneObservations,
    `Vehicle speed ${Math.round(world.speedKmh)} km/h. Road surface ${scene.roadSurface}.`,
  ].join('\n');
}
