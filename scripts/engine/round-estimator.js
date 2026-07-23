/**
 * Round Estimator — predicts combat duration based on DPR math.
 *
 * Factors in:
 *  - Attack bonus vs AC (hit probability)
 *  - Resource state scaling (HP, healing, spell DPR, burst)
 *  - Healing output extending party survival
 *  - Regeneration extending enemy survival
 *
 * @module engine/round-estimator
 */

/**
 * Estimate the hit probability given an attack bonus and target AC.
 * D20 roll: need (AC - bonus) or higher to hit. Min 5% (nat 20), max 95%.
 *
 * @param {number} attackBonus
 * @param {number} targetAC
 * @returns {number} Probability 0.05–0.95
 */
export function hitProbability(attackBonus, targetAC) {
  const needed = targetAC - attackBonus;
  const prob = (21 - needed) / 20;
  return Math.max(0.05, Math.min(0.95, prob));
}

/**
 * Resource state modifiers — scale party capabilities based on how
 * depleted they are.
 *
 * @param {number} state - 0.10 to 1.0
 * @returns {{ hpMod: number, healMod: number, spellDPRMod: number, burstMod: number }}
 */
export function resourceModifiers(state) {
  return {
    hpMod:       state >= 1.0 ? 1.0  : state >= 0.75 ? 0.85 : state >= 0.50 ? 0.60 : state >= 0.25 ? 0.35 : 0.15,
    healMod:     state >= 1.0 ? 1.0  : state >= 0.75 ? 0.75 : state >= 0.50 ? 0.50 : state >= 0.25 ? 0.25 : 0.05,
    spellDPRMod: state >= 1.0 ? 1.0  : state >= 0.75 ? 0.85 : state >= 0.50 ? 0.65 : state >= 0.25 ? 0.40 : 0.20,
    burstMod:    state >= 1.0 ? 1.0  : state >= 0.75 ? 0.80 : state >= 0.50 ? 0.50 : state >= 0.25 ? 0.20 : 0.05
  };
}

/**
 * Estimate party effective DPR against a set of threats.
 *
 * @param {object[]} party   - PartyMember objects
 * @param {object[]} threats - ThreatEntry objects
 * @param {number} resourceState
 * @returns {number} Estimated party DPR
 */
export function estimatePartyDPR(party, threats, resourceState) {
  const mods = resourceModifiers(resourceState);

  // Average enemy AC for hit probability
  const totalEnemies = threats.reduce((s, t) => s + t.quantity, 0);
  const avgEnemyAC = totalEnemies > 0
    ? threats.reduce((s, t) => s + t.ac * t.quantity, 0) / totalEnemies
    : 10;

  let totalDPR = 0;
  for (const member of party) {
    const rawDPR = member.damageCapabilities?.estimatedDPR ?? 0;

    // Estimate attack bonus from proficiency + best ability mod
    const prof = 2 + Math.floor((member.level - 1) / 4); // approximate prof bonus
    const bestSaveMod = Math.max(
      ...Object.values(member.savingThrows ?? {}).map(s => s.modifier ?? 0)
    );
    const estimatedAttackBonus = prof + Math.floor(bestSaveMod * 0.8); // rough proxy

    const hitProb = hitProbability(estimatedAttackBonus, avgEnemyAC);

    // Split DPR into cantrip (always available) and spell-based (resource-dependent)
    const isSpellcaster = member.threatTags?.includes("spellcaster");
    let effectiveDPR;
    if (isSpellcaster) {
      // Assume ~40% of DPR is cantrip/weapon, 60% is levelled spells
      const baseDPR = rawDPR * 0.4;
      const spellDPR = rawDPR * 0.6 * mods.spellDPRMod;
      effectiveDPR = (baseDPR + spellDPR) * hitProb;
    } else {
      effectiveDPR = rawDPR * hitProb;
    }

    totalDPR += effectiveDPR;
  }

  return totalDPR;
}

/**
 * Estimate enemy effective DPR against the party.
 *
 * @param {object[]} threats - ThreatEntry objects
 * @param {object[]} party   - PartyMember objects
 * @returns {number} Estimated enemy DPR
 */
export function estimateEnemyDPR(threats, party) {
  const avgPartyAC = party.length > 0
    ? party.reduce((s, m) => s + m.ac, 0) / party.length
    : 10;

  let totalDPR = 0;
  for (const threat of threats) {
    const rawDPR = threat.estimatedDPR ?? 0;

    // Estimate attack bonus from CR (rough: prof = 2 + floor(CR/4), + ability ~3-5)
    const estimatedBonus = Math.floor(threat.cr / 4) + 2 + Math.min(5, Math.max(3, Math.floor(threat.cr / 2)));
    const hitProb = hitProbability(estimatedBonus, avgPartyAC);

    totalDPR += rawDPR * hitProb * threat.quantity;
  }

  return totalDPR;
}

/**
 * Estimate combat duration in rounds and determine the attrition winner.
 *
 * @param {object[]} party   - PartyMember objects
 * @param {object[]} threats - ThreatEntry objects
 * @param {number} resourceState - 0.10 to 1.0
 * @param {number} minutesPerRound - Real-world minutes per combat round
 * @returns {{
 *   toDefeatEnemies: number,
 *   toPartyWipe: number,
 *   estimatedDuration: number,
 *   realTimeMinutes: number,
 *   attritionWinner: string,
 *   trivial: boolean
 * }}
 */
export function estimateRounds(party, threats, resourceState, minutesPerRound = 5) {
  const mods = resourceModifiers(resourceState);

  // Total effective party HP (scaled by resource state + healing buffer)
  const rawPartyHP = party.reduce((s, m) => s + m.hp, 0);
  const effectivePartyHP = rawPartyHP * mods.hpMod;
  const healingPerRound = party.reduce((s, m) => s + (m.healingCapability ?? 0), 0)
                          * mods.healMod / 3; // spread healing across ~3 rounds

  // Total enemy HP (including regeneration buffer)
  const totalEnemyHP = threats.reduce((s, t) => s + t.hp * t.quantity, 0);
  const enemyRegenPerRound = threats.reduce((s, t) => {
    if (t.threatTags?.includes("regeneration")) return s + 10 * t.quantity; // ~10 HP regen typical
    return s;
  }, 0);

  // DPR calculations
  const partyDPR = estimatePartyDPR(party, threats, resourceState);
  const enemyDPR = estimateEnemyDPR(threats, party);

  // Effective DPR accounting for regen/healing
  const effectivePartyDPRvsEnemies = Math.max(1, partyDPR - enemyRegenPerRound);
  const effectiveEnemyDPRvsParty   = Math.max(1, enemyDPR - healingPerRound);

  // Rounds to defeat
  const toDefeatEnemies = Math.ceil(totalEnemyHP / effectivePartyDPRvsEnemies);
  const toPartyWipe     = Math.ceil(effectivePartyHP / effectiveEnemyDPRvsParty);

  // The actual fight ends when one side drops
  const estimatedDuration = Math.min(toDefeatEnemies, toPartyWipe);
  const realTimeMinutes = estimatedDuration * minutesPerRound;

  let attritionWinner;
  if (toPartyWipe > toDefeatEnemies * 1.5) {
    attritionWinner = "Party (comfortable margin)";
  } else if (toPartyWipe > toDefeatEnemies) {
    attritionWinner = "Party (close)";
  } else if (toPartyWipe === toDefeatEnemies) {
    attritionWinner = "Coin flip";
  } else {
    attritionWinner = "Enemies (party at risk)";
  }

  const trivial = toDefeatEnemies <= 2 && toPartyWipe > 10;

  return {
    toDefeatEnemies,
    toPartyWipe,
    estimatedDuration,
    realTimeMinutes,
    attritionWinner,
    trivial
  };
}
