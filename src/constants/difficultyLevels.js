/** Stored in question_bank.difficulty_level */
export const DIFFICULTY_NOT_RATED = "not Rated";

export const DIFFICULTY_LEVELS = ["Low", "Medium", "High"];

export function isRatedDifficulty(level) {
  return level && level !== DIFFICULTY_NOT_RATED && DIFFICULTY_LEVELS.includes(level);
}

export function normalizeDifficultyLevel(level) {
  if (isRatedDifficulty(level)) return level;
  return DIFFICULTY_NOT_RATED;
}
