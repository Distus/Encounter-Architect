/**
 * Warning Rules Engine.
 *
 * Runs cross-reference checks between party and threat data, emitting
 * tactical warnings with severity, category, and human-readable text
 * referencing specific characters and creatures by name.
 *
 * @module engine/warnings
 */

/**
 * Run all warning rules and return an array of Warning objects.
 *
 * @param {object[]} party   - Array of PartyMember objects
 * @param {object[]} threats - Array of ThreatEntry objects
 * @param {object} actionEconomy - Output of calculateActionEconomy()
 * @param {number} resourceState - Party resource state (0.10 – 1.0)
 * @param {object} roundEstimate - Output of estimateRounds()
 * @returns {object[]} Array of { severity, category, message, details }
 */
export function generateWarnings(party, threats, actionEconomy, resourceState, roundEstimate) {
  const warnings = [];
  const w = (severity, category, message, details = null) =>
    warnings.push({ severity, category, message, details });

  // Flatten threats for per-creature iteration
  const allThreats = threats.flatMap(t =>
    Array.from({ length: t.quantity }, () => t)
  );
  const totalEnemyCount = allThreats.length;
  const partyCount = party.length;

  /* ── Action Economy Rules ────────────────────────────────────────────── */

  const { partyActions, enemyActions, ratio } = actionEconomy;

  if (ratio < 0.5) {
    w("danger", "action-economy",
      `Enemies have ${enemyActions} actions/round vs the party's ${partyActions} — significant risk of being overwhelmed.`);
  } else if (ratio < 0.75) {
    w("caution", "action-economy",
      `Enemies have ${enemyActions} actions/round vs the party's ${partyActions} — action economy favors enemies.`);
  }

  // Solo monster risk
  if (totalEnemyCount === 1 && partyCount >= 4) {
    const solo = threats[0];
    if (solo.legendaryActions > 0) {
      w("info", "action-economy",
        `Solo monster encounter — legendary actions partially offset the action economy disadvantage (+${solo.legendaryActions} actions/round).`);
    } else {
      w("info", "action-economy",
        `Solo monster vs ${partyCount} party members — prone to being trivialized by action economy despite high CR.`);
    }
  }

  /* ── Damage Mismatch Rules ───────────────────────────────────────────── */

  for (const member of party) {
    const primaryTypes = member.damageCapabilities?.primaryTypes ?? [];
    if (!primaryTypes.length) continue;

    for (const threat of threats) {
      // Immunity vs primary damage
      for (const dmgType of primaryTypes) {
        if (threat.damageImmunities.includes(dmgType)) {
          w("caution", "damage-mismatch",
            `${member.name}'s primary damage type is ${dmgType} — ${threat.name} is immune to ${dmgType}.`);
        } else if (threat.damageResistances.includes(dmgType)) {
          w("info", "damage-mismatch",
            `${member.name} deals mainly ${dmgType} — ${threat.name} has resistance to ${dmgType} (damage halved).`);
        }
      }

      // No magical weapons vs nonmagical resistance
      if (threat.threatTags.includes("resistance-nonmagical") &&
          !member.threatTags.includes("has-magic-weapon") &&
          !member.threatTags.includes("spellcaster")) {
        w("caution", "damage-mismatch",
          `${member.name}'s weapons appear nonmagical — damage will be halved against ${threat.name}.`);
      }
    }
  }

  // Party lacks ranged vs flyers
  const flyingThreats = threats.filter(t => t.threatTags.includes("flying"));
  const partyHasRanged = party.some(m => m.hasRangedAttack);
  if (flyingThreats.length > 0 && !partyHasRanged) {
    const flyers = flyingThreats.map(t => t.name).join(", ");
    w("danger", "damage-mismatch",
      `No party member has reliable ranged attacks — ${flyers} can stay airborne and unreachable in melee.`);
  }

  // Party lacks AOE vs many enemies
  const partyHasAOE = party.some(m => m.damageCapabilities?.hasAOE);
  if (totalEnemyCount >= 6 && !partyHasAOE) {
    w("caution", "damage-mismatch",
      `Facing ${totalEnemyCount} enemies with no AOE damage capability — risk of being surrounded and overwhelmed.`);
  }

  /* ── Condition Threat Rules ──────────────────────────────────────────── */

  const partyConditionRemoval = new Set(party.flatMap(m => m.conditionRemoval ?? []));

  for (const threat of threats) {
    const tags = threat.threatTags;

    // Paralyze cascade
    if (tags.includes("cc-paralyze") && !partyConditionRemoval.has("paralyzed")) {
      w("danger", "condition-threat",
        `${threat.name} can paralyze — no party member can remove paralysis. Failed saves could cascade into a TPK.`);
    }

    // Stun threat targeting weak Con saves
    if (tags.includes("cc-stun")) {
      const weakCon = party.filter(m => (m.savingThrows?.con?.modifier ?? 0) <= 1);
      if (weakCon.length > 0) {
        const names = weakCon.map(m => m.name).join(", ");
        w("caution", "condition-threat",
          `${threat.name} can stun — ${names} ${weakCon.length === 1 ? "has" : "have"} weak Constitution saves.`);
      }
    }

    // Charm threat
    if (tags.includes("cc-charm")) {
      const weakWis = party.filter(m => !m.savingThrows?.wis?.proficient);
      if (weakWis.length > party.length / 2) {
        w("caution", "condition-threat",
          `${threat.name} can charm — most of the party lacks Wisdom save proficiency.`);
      }
    }

    // Frighten with no removal
    if (tags.includes("cc-frighten") && !partyConditionRemoval.has("frightened")) {
      w("info", "condition-threat",
        `${threat.name} can frighten — no party member has Calm Emotions or similar to end it.`);
    }

    // Petrify
    if (tags.includes("cc-petrify")) {
      w("danger", "condition-threat",
        `${threat.name} can petrify — failed save means instant removal from combat.`);
    }
  }

  /* ── Defensive Gap Rules ─────────────────────────────────────────────── */

  if (party.length >= 2) {
    const avgAC = party.reduce((s, m) => s + m.ac, 0) / party.length;
    const avgHP = party.reduce((s, m) => s + m.hp, 0) / party.length;

    for (const member of party) {
      if (member.ac < avgAC - 4) {
        w("info", "defensive-gap",
          `${member.name}'s AC (${member.ac}) is well below the party average (${Math.round(avgAC)}) — likely to be focused.`);
      }
      if (member.hp < avgHP * 0.6) {
        w("info", "defensive-gap",
          `${member.name} has significantly less HP (${member.hp}) than the party average (${Math.round(avgHP)}) — vulnerable to burst damage.`);
      }
    }
  }

  // No healing
  const hasHealer = party.some(m => m.threatTags.includes("healer"));
  if (!hasHealer) {
    w("caution", "defensive-gap",
      "No healing capability in the party — consider providing healing potions or reducing encounter difficulty.");
  }

  // Save weakness vs specific threat abilities
  for (const threat of threats) {
    for (const action of threat.actions ?? []) {
      if (!action.saveAbility) continue;
      const ab = action.saveAbility.toLowerCase().substring(0, 3);
      const nonProf = party.filter(m => !m.savingThrows?.[ab]?.proficient);
      if (nonProf.length > party.length / 2) {
        w("caution", "defensive-gap",
          `${threat.name}'s ${action.name} targets ${action.saveAbility} saves — only ${party.length - nonProf.length} of ${party.length} party members are proficient.`);
      }
    }
  }

  /* ── Tactical Rules ──────────────────────────────────────────────────── */

  for (const threat of threats) {
    const tags = threat.threatTags;

    if (tags.includes("pack-tactics") && threat.quantity >= 2) {
      w("caution", "tactical",
        `Pack Tactics gives ${threat.name} near-permanent advantage when adjacent to allies — avoid clustering.`);
    }

    if (tags.includes("regeneration")) {
      w("info", "tactical",
        `${threat.name} has regeneration — ensure the party can deal the damage type that stops it.`);
    }

    if (tags.includes("magic-resistance")) {
      const casterCount = party.filter(m => m.threatTags.includes("spellcaster")).length;
      if (casterCount > party.length / 2) {
        w("caution", "tactical",
          `${threat.name} has Magic Resistance — spellcasters will have reduced effectiveness (advantage on saves).`);
      }
    }

    if (tags.includes("swarm") && !partyHasAOE) {
      w("info", "tactical",
        `${threat.name} is a swarm — resistant to single-target weapon damage. AOE or area effects are more effective.`);
    }

    if (tags.includes("teleport")) {
      w("info", "tactical",
        `${threat.name} can teleport — difficult to pin down in melee.`);
    }

    if (tags.includes("summon")) {
      w("caution", "tactical",
        `${threat.name} can summon reinforcements — action economy could shift mid-fight.`);
    }
  }

  /* ── Resource State Rules ────────────────────────────────────────────── */

  // We'll use the XP difficulty from the caller for cross-referencing
  // These rules use resourceState and roundEstimate

  if (resourceState <= 0.50) {
    // This is handled by the caller passing the xpDifficulty
    // We flag attrition concerns here
    if (roundEstimate && roundEstimate.toPartyWipe < roundEstimate.toDefeatEnemies) {
      w("danger", "resource-state",
        `At current resources, enemies outlast the party — the party goes down before defeating the threats.`);
    }

    if (roundEstimate && roundEstimate.toDefeatEnemies > 5) {
      w("caution", "resource-state",
        `This fight is estimated at ${roundEstimate.toDefeatEnemies}+ rounds — at current resources, the party may not sustain a prolonged engagement.`);
    }
  }

  if (resourceState <= 0.25) {
    if (hasHealer) {
      w("caution", "resource-state",
        "Primary healer likely has few spell slots remaining — limited ability to sustain the party.");
    }

    const burstReliant = party.some(m =>
      m.threatTags.includes("action-surge") || m.threatTags.includes("spellcaster")
    );
    if (burstReliant) {
      w("caution", "resource-state",
        "Party's burst damage options (Action Surge, high-level spells) are likely expended — DPR will be significantly lower.");
    }
  }

  if (resourceState >= 1.0 && roundEstimate?.trivial) {
    w("info", "resource-state",
      "This encounter poses minimal threat to a fully rested party — consider adding enemies or environmental challenges.");
  }

  // Sort by severity: danger first, then caution, then info
  const severityOrder = { danger: 0, caution: 1, info: 2 };
  warnings.sort((a, b) => (severityOrder[a.severity] ?? 3) - (severityOrder[b.severity] ?? 3));

  return warnings;
}
