function laneInstructions(side: 'left' | 'right'): string {
  const offset = side === 'left' ? 'minus' : 'plus';
  return `Is the immediately adjacent lane to the ${side} of the stated ego lane traffic-clear as an escape route? ` +
    `The target is ego lane ${offset} one; road lanes are numbered 1 through 3. If this target does not exist, answer false. ` +
    'Judge only that target lane from the reported lane sensors. Require observed forward traffic clearance for at least 100 metres. ' +
    'Traffic in the ego lane or in another lane does not make the target lane occupied. ' +
    'For traffic behind in the target lane itself, consider its reported gap and relative closing speed; ' +
    'do not assume that vehicle will brake or that unreported clearance is clear. ' +
    'Assess target-lane traffic clearance only, not whether the entire driving situation is safe ' +
    'or whether the forward contact in the ego lane is dangerous.';
}

export const questions = [
  {
    type: 'predicate',
    name: 'major_damage_risk',
    instructions:
      'Would a collision with this obstacle cause major vehicle damage or ' +
      'injury to occupants? Consider mass and size only. Ignore road surface.',
  },
  {
    type: 'predicate',
    name: 'left_lane_clear',
    instructions: laneInstructions('left'),
  },
  {
    type: 'predicate',
    name: 'right_lane_clear',
    instructions: laneInstructions('right'),
  },
] satisfies { type: 'predicate'; name: string; instructions: string }[];

export function foundryQuestions(): Record<string, { type: 'noul'; instructions: string }> {
  return Object.fromEntries(questions.map((question) => [
    question.name,
    { type: 'noul' as const, instructions: question.instructions },
  ]));
}
