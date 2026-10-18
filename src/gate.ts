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
  if (envelope.action === 'swerve' && currentSpeedKmh > policy.swerveSpeedLimit) {
    reasons.push({
      reason: 'prohibited_action',
      detail: `Swerve at ${currentSpeedKmh.toFixed(1)} km/h exceeds ${policy.swerveSpeedLimit} km/h limit for ${policy.swerveTier} (${policy.ambientTempC} °C).`,
    });
  }
  const [first, ...rest] = reasons;
  return first ? { allowed: false, reasons: [first, ...rest] } : { allowed: true };
}
