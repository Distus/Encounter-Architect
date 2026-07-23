/**
 * Data Reader — extracts structured encounter data from dnd5e actors.
 *
 * Reads Foundry actor objects and normalises them into the PartyMember
 * and ThreatEntry shapes used by the analysis engine.
 *
 * @module engine/data-reader
 */

import { xpForCR } from "./xp-calculator.js";
import { tagMonster, tagCharacter } from "./auto-tagger.js";

/* ── Helpers ───────────────────────────────────────────────────────────── */

function dig(obj, path, fallback = undefined) {
  return path.split(".").reduce((o, k) => (o != null ? o[k] : fallback), obj);
}

function setToArray(val) {
  if (val instanceof Set) return [...val];
  if (Array.isArray(val)) return val;
  return [];
}

/* ── Ability modifier shorthand ────────────────────────────────────────── */

function abilityMod(actor, ability) {
  return dig(actor, `system.abilities.${ability}.mod`, 0);
}

/* ── Saving throw proficiency + modifier ───────────────────────────────── */

function savingThrows(actor) {
  const saves = {};
  const abilities = ["str", "dex", "con", "int", "wis", "cha"];
  for (const ab of abilities) {
    const prof = dig(actor, `system.abilities.${ab}.proficient`, 0);
    const mod  = dig(actor, `system.abilities.${ab}.save`, null) ??
                 dig(actor, `system.abilities.${ab}.mod`, 0);
    saves[ab] = { proficient: !!prof, modifier: mod };
  }
  return saves;
}

/* ── Estimate DPR from weapons and cantrips ────────────────────────────── */

function estimateDPR(actor) {
  let bestDPR = 0;
  let burstDPR = 0;
  const dmgTypes = [];

  for (const item of actor.items ?? []) {
    if (!["weapon", "spell"].includes(item.type)) continue;

    // For spells, only count cantrips (level 0) toward sustained DPR
    if (item.type === "spell" && dig(item, "system.level", 0) > 0) {
      // Levelled spells contribute to burst only
      const parts = dig(item, "system.damage.parts", []) ??
                    dig(item, "system.damage.base.custom", []) ?? [];
      let spellDmg = 0;
      for (const part of parts) {
        const formula = Array.isArray(part) ? part[0] : (part.formula ?? "");
        spellDmg += estimateFormula(formula, actor);
      }
      burstDPR = Math.max(burstDPR, spellDmg);
      continue;
    }

    const parts = dig(item, "system.damage.parts", []) ??
                  dig(item, "system.damage.base.custom", []) ?? [];
    let itemDmg = 0;
    for (const part of parts) {
      const formula = Array.isArray(part) ? part[0] : (part.formula ?? "");
      const type = Array.isArray(part) ? part[1] : (part.type ?? "");
      itemDmg += estimateFormula(formula, actor);
      if (type) dmgTypes.push(type);
    }

    // Also check the simplified damage structure (dnd5e 4.x+)
    const baseDmg = dig(item, "system.damage.base", null);
    if (baseDmg && !parts.length) {
      const dice = baseDmg.number ?? 1;
      const die  = baseDmg.denomination ?? 6;
      const bonus = baseDmg.bonus ?? "";
      const avgDice = dice * ((die + 1) / 2);
      const bonusNum = parseInt(bonus) || 0;
      itemDmg = avgDice + bonusNum;
      if (baseDmg.types) {
        const types = baseDmg.types instanceof Set ? [...baseDmg.types] : (baseDmg.types ?? []);
        dmgTypes.push(...types);
      }
    }

    bestDPR = Math.max(bestDPR, itemDmg);
  }

  // Check for multi-attack: multiply best attack DPR
  const hasMultiAttack = (actor.items ?? []).some(
    i => /\bmultiattack\b/i.test(i.name ?? "") || /\bextra attack\b/i.test(i.name ?? "")
  );
  const attackCount = hasMultiAttack ? 2 : 1;

  return {
    estimatedDPR: bestDPR * attackCount,
    burstDamage: Math.max(burstDPR, bestDPR * attackCount),
    primaryTypes: [...new Set(dmgTypes)]
  };
}

/**
 * Rough average of a dice formula string like "2d6+4" or "1d8+3".
 */
function estimateFormula(formula, actor) {
  if (!formula || typeof formula !== "string") return 0;

  // Replace @mod, @abilities.X.mod etc. with best guess
  let resolved = formula
    .replace(/@mod/gi, String(abilityMod(actor, bestAbility(actor))))
    .replace(/@abilities\.(\w+)\.mod/gi, (_, ab) => String(abilityMod(actor, ab)))
    .replace(/@prof/gi, String(dig(actor, "system.attributes.prof", 2)));

  let total = 0;
  // Match dice expressions: NdM
  const diceRegex = /(\d+)d(\d+)/gi;
  let match;
  while ((match = diceRegex.exec(resolved)) !== null) {
    const num  = parseInt(match[1]);
    const die  = parseInt(match[2]);
    total += num * ((die + 1) / 2);
  }

  // Remove dice expressions and evaluate remaining numeric portions
  const numericPart = resolved.replace(/\d+d\d+/gi, "0");
  try {
    // Simple arithmetic eval for bonus portions like "+4" or "+3+2"
    const bonusMatch = numericPart.match(/[+\-]\s*\d+/g);
    if (bonusMatch) {
      for (const b of bonusMatch) {
        total += parseInt(b.replace(/\s/g, ""));
      }
    }
  } catch { /* ignore parse failures */ }

  return Math.max(0, total);
}

/**
 * Guess the actor's "best" ability for @mod replacement.
 */
function bestAbility(actor) {
  const abilities = ["str", "dex", "con", "int", "wis", "cha"];
  let best = "str", bestVal = -99;
  for (const ab of abilities) {
    const val = dig(actor, `system.abilities.${ab}.mod`, -99);
    if (val > bestVal) { bestVal = val; best = ab; }
  }
  return best;
}

/* ── Healing estimation ────────────────────────────────────────────────── */

function estimateHealing(actor) {
  let healingOutput = 0;
  for (const item of actor.items ?? []) {
    if (item.type !== "spell") continue;
    const name = (item.name ?? "").toLowerCase();
    if (!/\bheal|cure|restore|revivify\b/.test(name)) continue;
    const parts = dig(item, "system.damage.parts", []) ?? [];
    for (const part of parts) {
      const formula = Array.isArray(part) ? part[0] : (part.formula ?? "");
      healingOutput += estimateFormula(formula, actor);
    }
  }
  return healingOutput;
}

/* ── Condition removal detection ───────────────────────────────────────── */

function getConditionRemoval(actor) {
  const removal = [];
  const spellMap = {
    "lesser restoration": ["poisoned", "blinded", "deafened", "paralyzed"],
    "greater restoration": ["charmed", "petrified", "cursed", "exhaustion", "stunned"],
    "remove curse":        ["cursed"],
    "dispel magic":        ["charmed", "frightened"],
    "calm emotions":       ["charmed", "frightened"],
    "heroes' feast":       ["frightened", "poisoned"]
  };

  for (const item of actor.items ?? []) {
    if (item.type !== "spell") continue;
    const name = (item.name ?? "").toLowerCase();
    for (const [spell, conditions] of Object.entries(spellMap)) {
      if (name.includes(spell)) removal.push(...conditions);
    }
  }
  return [...new Set(removal)];
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Read a player character actor into a PartyMember structure.
 *
 * @param {Actor5e} actor - Foundry dnd5e character actor
 * @param {boolean} [isAlly=false] - True if this is an NPC ally
 * @returns {object} PartyMember data
 */
export function readPartyMember(actor, isAlly = false) {
  const sys = actor.system ?? {};
  const classes = {};
  for (const item of actor.items ?? []) {
    if (item.type === "class") {
      classes[item.name] = dig(item, "system.levels", 1);
    }
  }

  const level = dig(sys, "details.level", 0) ||
                Object.values(classes).reduce((a, b) => a + b, 0) || 1;

  const dmgProfile = estimateDPR(actor);
  const threatTags = tagCharacter(actor);

  return {
    actorId:            actor.id,
    name:               actor.name,
    level,
    classes,
    ac:                 dig(sys, "attributes.ac.value", 10),
    hp:                 dig(sys, "attributes.hp.max", 1),
    savingThrows:       savingThrows(actor),
    damageCapabilities: {
      primaryTypes:  dmgProfile.primaryTypes,
      hasRanged:     threatTags.includes("ranged"),
      hasAOE:        threatTags.includes("aoe-damage"),
      estimatedDPR:  dmgProfile.estimatedDPR,
      burstDamage:   dmgProfile.burstDamage
    },
    healingCapability:  estimateHealing(actor),
    conditionRemoval:   getConditionRemoval(actor),
    hasRangedAttack:    threatTags.includes("ranged"),
    threatTags,
    isAlly,

    // Action economy helpers (consumed by action-economy.js)
    hasBonusActionAttack: threatTags.includes("bonus-action-attack"),
    legendaryActions:     0,
    hasMeaningfulReaction: false,
    hasLairActions:        false
  };
}

/**
 * Read a monster/NPC actor into a ThreatEntry structure.
 *
 * @param {Actor5e} actor - Foundry dnd5e NPC actor
 * @param {number} [quantity=1] - How many of this creature
 * @returns {object} ThreatEntry data
 */
export function readThreat(actor, quantity = 1) {
  const sys = actor.system ?? {};
  const cr = dig(sys, "details.cr", 0) ?? 0;
  const movement = dig(sys, "attributes.movement", {});

  const threatTags = tagMonster(actor);
  const dmgProfile = estimateDPR(actor);

  const la = dig(sys, "attributes.legendary.max", 0) ||
             dig(sys, "resources.legact.max", 0);
  const lr = dig(sys, "attributes.legendary.lr", 0) ||
             dig(sys, "resources.legres.max", 0) || 0;
  // Check for legendary resistance via items too
  const lrFromItems = (actor.items ?? []).some(
    i => /\blegendary resistance\b/i.test(i.name ?? "")
  );

  // Spellcaster level (highest spell level found)
  let spellLevel = null;
  for (const tag of threatTags) {
    const m = tag.match(/^spell-level-(\d+)$/);
    if (m) spellLevel = Math.max(spellLevel ?? 0, parseInt(m[1]));
  }

  // Build action summaries from items
  const actions = [];
  for (const item of actor.items ?? []) {
    if (!["weapon", "feat"].includes(item.type)) continue;
    const desc = dig(item, "system.description.value", "") ?? "";
    const dmgParts = dig(item, "system.damage.parts", []) ?? [];
    let avgDmg = 0;
    let dmgType = "";
    for (const part of dmgParts) {
      const formula = Array.isArray(part) ? part[0] : (part.formula ?? "");
      const type    = Array.isArray(part) ? part[1] : (part.type ?? "");
      avgDmg += estimateFormula(formula, actor);
      if (!dmgType && type) dmgType = type;
    }

    // Simplified base damage (dnd5e 4.x+)
    const baseDmg = dig(item, "system.damage.base", null);
    if (baseDmg && !dmgParts.length) {
      const dice = baseDmg.number ?? 1;
      const die  = baseDmg.denomination ?? 6;
      avgDmg = dice * ((die + 1) / 2) + (parseInt(baseDmg.bonus) || 0);
      const types = baseDmg.types instanceof Set ? [...baseDmg.types] : (baseDmg.types ?? []);
      if (types.length) dmgType = types[0];
    }

    const range = dig(item, "system.range.long", 0) || dig(item, "system.range.value", 0) || 5;
    const isAOE = /\b(cone|line|sphere|cube|radius|cylinder|emanation)\b/i.test(desc);

    actions.push({
      name:          item.name,
      type:          item.type === "weapon" ? (range > 10 ? "ranged" : "melee") : "special",
      damageType:    dmgType,
      averageDamage: avgDmg,
      isAOE,
      range,
      saveDC:        dig(item, "system.save.dc", null),
      saveAbility:   dig(item, "system.save.ability", null),
      conditions:    [], // populated by tag engine
      recharge:      dig(item, "system.recharge.value", null)
                       ? `${dig(item, "system.recharge.value", "")}-6` : null,
      isMultiAttack: /\bmultiattack\b/i.test(item.name ?? ""),
      multiAttackCount: 1
    });
  }

  return {
    actorId:              actor.id,
    name:                 actor.name,
    cr,
    xp:                   xpForCR(cr),
    quantity,
    ac:                   dig(sys, "attributes.ac.value", 10),
    hp:                   dig(sys, "attributes.hp.max", 1),
    speed: {
      walk:   movement.walk ?? 30,
      fly:    movement.fly ?? 0,
      swim:   movement.swim ?? 0,
      burrow: movement.burrow ?? 0,
      climb:  movement.climb ?? 0
    },
    damageResistances:    setToArray(dig(sys, "traits.dr.value", [])),
    damageImmunities:     setToArray(dig(sys, "traits.di.value", [])),
    conditionImmunities:  setToArray(dig(sys, "traits.ci.value", [])),
    actions,
    legendaryActions:     la,
    legendaryResistance:  lr || (lrFromItems ? 3 : 0),
    spellcastingLevel:    spellLevel,
    threatTags,
    hasLairActions:       false,

    // Action economy helpers
    hasBonusActionAttack:  false, // monsters rarely get "bonus action attacks" in the PC sense
    hasMeaningfulReaction: actorHasReaction(actor),

    // DPR for round estimation
    estimatedDPR:         dmgProfile.estimatedDPR
  };
}

/**
 * Check if a monster has a meaningful reaction ability.
 */
function actorHasReaction(actor) {
  for (const item of actor.items ?? []) {
    const name = (item.name ?? "").toLowerCase();
    if (/\bparry\b|\bcounterspell\b|\bshield\b|\breaction\b/.test(name)) return true;
    const activation = dig(item, "system.activation.type", "");
    if (activation === "reaction") return true;
  }
  return false;
}
