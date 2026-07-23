/**
 * Action Economy Calculator.
 *
 * Counts meaningful offensive actions each side can take per round
 * and computes the ratio / verdict / difficulty adjustment.
 *
 * @module engine/action-economy
 */

/**
 * Count actions for a single creature / character.
 *
 * Base:  1 (standard action)
 * +1    bonus-action attack (Two-Weapon Fighting, Flurry, etc.)
 * +1    per legendary action
 * +0.5  meaningful reaction (Parry, Sentinel, Counterspell …)
 * +1    lair actions (DM toggle)
 *
 * Multi-attack counts as 1 action (it is one action that makes
 * multiple attacks — it doesn't change the action count).
 *
 * @param {object} creature
 * @param {boolean} [creature.hasBonusActionAttack=false]
 * @param {number}  [creature.legendaryActions=0]
 * @param {boolean} [creature.hasMeaningfulReaction=false]
 * @param {boolean} [creature.hasLairActions=false]
 * @returns {number} Total actions per round
 */
export function countActions(creature) {
  let actions = 1; // base action
  if (creature.hasBonusActionAttack) actions += 1;
  actions += (creature.legendaryActions ?? 0);
  if (creature.hasMeaningfulReaction) actions += 0.5;
  if (creature.hasLairActions) actions += 1;
  return actions;
}

/**
 * Calculate total action counts for each side and derive the verdict.
 *
 * @param {object[]} party   - Array of party member action data
 * @param {object[]} threats - Array of threat action data (each with .quantity)
 * @returns {{
 *   partyActions: number,
 *   enemyActions: number,
 *   ratio: number,
 *   verdict: string,
 *   adjustment: number
 * }}
 */
export function calculateActionEconomy(party, threats) {
  const partyActions = party.reduce((sum, m) => sum + countActions(m), 0);
  const enemyActions = threats.reduce(
    (sum, t) => sum + countActions(t) * (t.quantity ?? 1), 0
  );

  // Avoid division by zero
  const ratio = enemyActions > 0 ? partyActions / enemyActions : 99;

  let verdict, adjustment;
  if (ratio > 2.0) {
    verdict = "Heavily favors party";
    adjustment = -1;
  } else if (ratio > 1.5) {
    verdict = "Favors party";
    adjustment = -0.5;
  } else if (ratio >= 0.75) {
    verdict = "Balanced";
    adjustment = 0;
  } else if (ratio >= 0.5) {
    verdict = "Favors enemies";
    adjustment = 0.5;
  } else {
    verdict = "Heavily favors enemies";
    adjustment = 1;
  }

  return { partyActions, enemyActions, ratio, verdict, adjustment };
}
