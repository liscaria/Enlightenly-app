/** Paper helpers mirrored from questionBankUtils (server-side). */

export function stampPaperExpectedTotal(questions, expectedCount) {
  if (!expectedCount || !questions?.length) return questions;
  return questions.map((q) => ({
    ...q,
    metadata: {
      ...(q.metadata || {}),
      totalQuestions: expectedCount,
    },
  }));
}
