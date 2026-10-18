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
    name: 'adjacent_lane_clear',
    instructions:
      'Is at least one adjacent lane free of other vehicles for the next ' +
      '100 metres?',
  },
] satisfies { type: 'predicate'; name: string; instructions: string }[];

export function foundryQuestions(): Record<string, { type: 'noul'; instructions: string }> {
  return Object.fromEntries(questions.map((question) => [
    question.name,
    { type: 'noul' as const, instructions: question.instructions },
  ]));
}
