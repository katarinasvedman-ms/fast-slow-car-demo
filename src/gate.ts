import type { Config } from './config.js';
import type { ActionEnvelope, GateDecision, GateRefusal } from './types.js';

export function evaluateGate(
  envelope: ActionEnvelope,
  currentTick: number,
  currentSpeedKmh: number,
  policy: Pick<Config, 'stalenessLimitTicks' | 'swerveSpeedLimit'>,
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
      detail: `Swerve at ${currentSpeedKmh.toFixed(1)} km/h exceeds ${policy.swerveSpeedLimit} km/h.`,
    });
  }
  const [first, ...rest] = reasons;
  return first ? { allowed: false, reasons: [first, ...rest] } : { allowed: true };
}
