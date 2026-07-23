/**
 * XP Budget Calculator — 2024 DMG difficulty system.
 *
 * The 2024 DMG uses per-character XP budgets:
 *   Low = level × 25, Moderate = level × 50,
 *   High = level × 75, Deadly = level × 100
 *
 * No group-size multiplier — total monster XP is compared directly.
 *
 * @module engine/xp-calculator
 */

/* ── Standard CR → XP mapping (2024 DMG / MM) ─────────────────────────── */

export const CR_XP_TABLE = {
  0:     10,
  0.125: 25,
  0.25:  50,
  0.5:   100,
  1:     200,
  2:     450,
  3:     700,
  4:     1100,
  5:     1800,
  6:     2300,
  7:     2900,
  8:     3900,
  9:     5000,
  10:    5900,
  11:    7200,
  12:    8400,
  13:    10000,
  14:    11500,
  15:    13000,
  16:    15000,
  17:    18000,
  18:    20000,
  19:    22000,
  20:    25000,
  21:    33000,
  22:    41000,
  23:    50000,
  24:    62000,
  25:    75000,
  26:    90000,
  27:    105000,
  28:    120000,
  29:    135000,
  30:    155000
};

/**
 * Look up XP value for a given CR.
 * @param {number} cr - Challenge rating (0, 0.125, 0.25, 0.5, 1-30)
 * @returns {number} XP value, or 0 if CR is unrecognised
 */
export function xpForCR(cr) {
  return CR_XP_TABLE[cr] ?? 0;
}

/**
 * Calculate the XP budget thresholds for a party.
 *
 * @param {number[]} levels - Array of character levels (one entry per PC/ally)
 * @returns {{ low: number, moderate: number, high: number, deadly: number }}
 */
export function calculateXPBudget(levels) {
  const budget = { low: 0, moderate: 0, high: 0, deadly: 0 };
  for (const lvl of levels) {
    budget.low     += lvl * 25;
    budget.moderate += lvl * 50;
    budget.high    += lvl * 75;
    budget.deadly  += lvl * 100;
  }
  return budget;
}

/**
 * Determine raw XP-based difficulty by comparing total monster XP to the
 * party's budget thresholds.
 *
 * @param {number} totalMonsterXP - Sum of all threat XP values
 * @param {{ low: number, moderate: number, high: number, deadly: number }} budget
 * @returns {string} "Trivial" | "Low" | "Moderate" | "High" | "Deadly"
 */
export function xpDifficulty(totalMonsterXP, budget) {
  if (totalMonsterXP >= budget.deadly)   return "Deadly";
  if (totalMonsterXP >= budget.high)     return "High";
  if (totalMonsterXP >= budget.moderate) return "Moderate";
  if (totalMonsterXP >= budget.low)      return "Low";
  return "Trivial";
}

/**
 * Numeric index for difficulty labels (used for step adjustments).
 */
export const DIFFICULTY_ORDER = ["Trivial", "Low", "Moderate", "High", "Deadly"];

/**
 * Shift a difficulty label by a number of steps (clamped to range).
 *
 * @param {string} difficulty - Current difficulty label
 * @param {number} steps - Steps to shift (+/- 0.5 or 1)
 * @returns {string} Adjusted difficulty label
 */
export function adjustDifficulty(difficulty, steps) {
  const idx = DIFFICULTY_ORDER.indexOf(difficulty);
  if (idx === -1) return difficulty;
  const adjusted = Math.round(Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, idx + steps)));
  return DIFFICULTY_ORDER[adjusted];
}
