import type { SwerveLimit } from './policy.js';
import type { ActionEnvelope, GateDecision, GateRefusal } from './types.js';

export function evaluateGate(
  envelope: ActionEnvelope,
  currentTick: number,
  currentSpeedKmh: number,
  policy: SwerveLimit & { stalenessLimitTicks: number; ambientTempC: number },
): GateDecision {
  const reasons: GateRefusal[] = [];
  const age = currentTick - envelope.observedAtTick;
  if (age > policy.stalenessLimitTicks) {
    reasons.push({
      reason: 'stale_advice',
      detail: `Observation age ${age} ticks exceeds ${policy.stalenessLimitTicks}.`,
    });
  }
  const speedLimit = envelope.source === 'fast'
    ? Math.min(policy.fastSwerveSpeedLimit, policy.swerveSpeedLimit) : policy.swerveSpeedLimit;
  if (envelope.action === 'swerve' && currentSpeedKmh > speedLimit) {
    reasons.push({
      reason: 'prohibited_action',
      detail: envelope.source === 'fast' && policy.fastSwerveSpeedLimit < policy.swerveSpeedLimit
        ? `Fast swerve at ${currentSpeedKmh.toFixed(1)} km/h exceeds ${speedLimit} km/h actor cap; temperature limit ${policy.swerveSpeedLimit} km/h.`
        : `Swerve at ${currentSpeedKmh.toFixed(1)} km/h exceeds ${speedLimit} km/h limit for ${policy.swerveTier} (${policy.ambientTempC} °C).`,
    });
  }
  const [first, ...rest] = reasons;
  return first ? { allowed: false, reasons: [first, ...rest] } : { allowed: true };
}
