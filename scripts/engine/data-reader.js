/**
 * Data Reader — extracts structured encounter data from dnd5e actors.
 *
 * Reads Foundry actor objects and normalises them into the PartyMember
 * and ThreatEntry shapes used by the analysis engine.
 *
 * Designed to be extremely defensive — every property access is guarded
 * so that unexpected actor data structures never crash the reader.
 *
 * @module engine/data-reader
 */

import { xpForCR } from "./xp-calculator.js";
import { tagMonster, tagCharacter } from "./auto-tagger.js";

const LOG = "Encounter Architect | DataReader";

/* ── Helpers ───────────────────────────────────────────────────────────── */

function dig(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((o, k) => (o != null ? o[k] : fallback), obj);
  } catch { return fallback; }
}

function setToArray(val) {
  try {
    if (val instanceof Set) return [...val];
    if (Array.isArray(val)) return val;
  } catch { /* ignore */ }
  return [];
}

function safeItems(actor) {
  try {
    // actor.items can be a Map, Collection, or Array depending on Foundry version
    if (actor.items?.contents) return actor.items.contents;
    if (actor.items?.[Symbol.iterator]) return [...actor.items];
    if (Array.isArray(actor.items)) return actor.items;
  } catch (err) {
    console.warn(`${LOG} | Could not iterate actor items for ${actor?.name}:`, err);
  }
  return [];
}

/* ── Ability modifier shorthand ────────────────────────────────────────── */

function abilityMod(actor, ability) {
  return dig(actor, `system.abilities.${ability}.mod`, 0) ?? 0;
}

/* ── Saving throw proficiency + modifier ───────────────────────────────── */

function savingThrows(actor) {
  const saves = {};
  const abilities = ["str", "dex", "con", "int", "wis", "cha"];
  for (const ab of abilities) {
    try {
      const prof = dig(actor, `system.abilities.${ab}.proficient`, 0);
      const mod  = dig(actor, `system.abilities.${ab}.save`, null) ??
                   dig(actor, `system.abilities.${ab}.mod`, 0) ?? 0;
      saves[ab] = { proficient: !!prof, modifier: mod };
    } catch {
      saves[ab] = { proficient: false, modifier: 0 };
    }
  }
  return saves;
}

/* ── Estimate DPR from weapons and cantrips ────────────────────────────── */

function estimateDPR(actor) {
  let bestDPR = 0;
  let burstDPR = 0;
  const dmgTypes = [];
  const items = safeItems(actor);

  for (const item of items) {
    try {
      if (!item?.type || !["weapon", "spell"].includes(item.type)) continue;

      // For spells, only count cantrips (level 0) toward sustained DPR
      if (item.type === "spell" && (dig(item, "system.level", 0) ?? 0) > 0) {
        // Levelled spells contribute to burst only
        const spellDmg = estimateItemDamage(item, actor);
        burstDPR = Math.max(burstDPR, spellDmg.avg);
        dmgTypes.push(...spellDmg.types);
        continue;
      }

      const dmg = estimateItemDamage(item, actor);
      bestDPR = Math.max(bestDPR, dmg.avg);
      dmgTypes.push(...dmg.types);
    } catch (err) {
      console.warn(`${LOG} | Error parsing item ${item?.name}:`, err);
    }
  }

  // Check for multi-attack: multiply best attack DPR
  const hasMultiAttack = items.some(i => {
    const n = (i?.name ?? "").toLowerCase();
    return /\bmultiattack\b/.test(n) || /\bextra attack\b/.test(n);
  });
  const attackCount = hasMultiAttack ? 2 : 1;

  return {
    estimatedDPR: Math.round(bestDPR * attackCount),
    burstDamage: Math.round(Math.max(burstDPR, bestDPR * attackCount)),
    primaryTypes: [...new Set(dmgTypes)]
  };
}

/**
 * Estimate average damage from a single item, handling both old
 * (system.damage.parts) and new (system.damage.base) dnd5e formats.
 */
function estimateItemDamage(item, actor) {
  let avg = 0;
  const types = [];

  try {
    // Try the newer dnd5e 4.x+ base damage structure first
    const baseDmg = dig(item, "system.damage.base", null);
    if (baseDmg) {
      const dice = baseDmg.number ?? baseDmg.dice ?? 1;
      const die  = baseDmg.denomination ?? baseDmg.die ?? 6;
      const bonus = parseInt(baseDmg.bonus) || 0;
      avg = dice * ((die + 1) / 2) + bonus;

      // Extract types
      const baseTypes = baseDmg.types ?? baseDmg.damageType;
      if (baseTypes instanceof Set) types.push(...baseTypes);
      else if (Array.isArray(baseTypes)) types.push(...baseTypes);
      else if (typeof baseTypes === "string" && baseTypes) types.push(baseTypes);

      return { avg, types: types.filter(Boolean) };
    }

    // Fall back to legacy system.damage.parts
    const parts = dig(item, "system.damage.parts", null);
    if (parts != null) {
      // parts can be an Array (old dnd5e), an Object/Map (new dnd5e), or something else
      let partsArray = [];
      if (Array.isArray(parts)) {
        partsArray = parts;
      } else if (parts instanceof Map) {
        partsArray = [...parts.values()];
      } else if (typeof parts === "object" && parts !== null) {
        // Object with numeric keys or named keys
        partsArray = Object.values(parts);
      }

      if (partsArray.length > 0) {
        for (const part of partsArray) {
          try {
            const formula = Array.isArray(part) ? part[0] : (part?.formula ?? part?.number ? `${part.number}d${part.denomination ?? 6}` : "");
            const type    = Array.isArray(part) ? part[1] : (part?.type ?? part?.damageType ?? "");
            avg += estimateFormula(formula, actor);
            if (type) types.push(typeof type === "string" ? type : "");
          } catch { /* skip bad part */ }
        }
        return { avg, types: types.filter(Boolean) };
      }
    }
  } catch (err) {
    console.warn(`${LOG} | Error estimating damage for ${item?.name}:`, err);
  }

  return { avg: 0, types: [] };
}

/**
 * Rough average of a dice formula string like "2d6+4" or "1d8+@mod".
 */
function estimateFormula(formula, actor) {
  if (!formula || typeof formula !== "string") return 0;
  try {
    // Replace common variables
    let resolved = formula
      .replace(/@mod/gi, String(abilityMod(actor, bestAbility(actor))))
      .replace(/@abilities\.(\w+)\.mod/gi, (_, ab) => String(abilityMod(actor, ab)))
      .replace(/@prof/gi, String(dig(actor, "system.attributes.prof", 2) ?? 2));

    let total = 0;
    // Match dice expressions: NdM
    const diceRegex = /(\d+)d(\d+)/gi;
    let match;
    while ((match = diceRegex.exec(resolved)) !== null) {
      total += parseInt(match[1]) * ((parseInt(match[2]) + 1) / 2);
    }

    // Evaluate numeric bonuses
    const numericPart = resolved.replace(/\d+d\d+/gi, "0");
    const bonusMatch = numericPart.match(/[+\-]\s*\d+/g);
    if (bonusMatch) {
      for (const b of bonusMatch) {
        total += parseInt(b.replace(/\s/g, ""));
      }
    }

    return Math.max(0, total);
  } catch { return 0; }
}

function bestAbility(actor) {
  const abilities = ["str", "dex", "con", "int", "wis", "cha"];
  let best = "str", bestVal = -99;
  for (const ab of abilities) {
    const val = abilityMod(actor, ab);
    if (val > bestVal) { bestVal = val; best = ab; }
  }
  return best;
}

/* ── Healing estimation ────────────────────────────────────────────────── */

function estimateHealing(actor) {
  let healingOutput = 0;
  const items = safeItems(actor);
  for (const item of items) {
    try {
      if (item?.type !== "spell") continue;
      const name = (item.name ?? "").toLowerCase();
      if (!/\bheal|cure|restore|revivify\b/.test(name)) continue;
      const dmg = estimateItemDamage(item, actor);
      healingOutput += dmg.avg;
    } catch { /* skip */ }
  }
  return Math.round(healingOutput);
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

  const items = safeItems(actor);
  for (const item of items) {
    try {
      if (item?.type !== "spell") continue;
      const name = (item.name ?? "").toLowerCase();
      for (const [spell, conditions] of Object.entries(spellMap)) {
        if (name.includes(spell)) removal.push(...conditions);
      }
    } catch { /* skip */ }
  }
  return [...new Set(removal)];
}

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Read a player character actor into a PartyMember structure.
 */
export function readPartyMember(actor, isAlly = false) {
  console.log(`${LOG} | Reading party member: ${actor?.name} (id: ${actor?.id})`);

  const sys = actor?.system ?? {};

  // Get classes
  const classes = {};
  const items = safeItems(actor);
  for (const item of items) {
    try {
      if (item?.type === "class") {
        classes[item.name] = dig(item, "system.levels", 1) ?? 1;
      }
    } catch { /* skip */ }
  }

  const level = dig(sys, "details.level", 0) ??
                Object.values(classes).reduce((a, b) => a + b, 0) || 1;

  let dmgProfile = { estimatedDPR: 0, burstDamage: 0, primaryTypes: [] };
  try { dmgProfile = estimateDPR(actor); }
  catch (err) { console.warn(`${LOG} | DPR estimation failed for ${actor?.name}:`, err); }

  let threatTags = [];
  try { threatTags = tagCharacter(actor); }
  catch (err) { console.warn(`${LOG} | Tagging failed for ${actor?.name}:`, err); }

  const result = {
    actorId:            actor.id,
    name:               actor.name,
    level,
    classes,
    ac:                 dig(sys, "attributes.ac.value", 10) ?? 10,
    hp:                 dig(sys, "attributes.hp.max", 1) ?? 1,
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

    // Action economy helpers
    hasBonusActionAttack: threatTags.includes("bonus-action-attack"),
    legendaryActions:     0,
    hasMeaningfulReaction: false,
    hasLairActions:        false
  };

  console.log(`${LOG} | Party member ${actor.name}: Lv${level}, AC ${result.ac}, HP ${result.hp}, DPR ~${dmgProfile.estimatedDPR}`);
  return result;
}

/**
 * Read a monster/NPC actor into a ThreatEntry structure.
 */
export function readThreat(actor, quantity = 1) {
  console.log(`${LOG} | Reading threat: ${actor?.name} (id: ${actor?.id})`);

  const sys = actor?.system ?? {};
  const cr = dig(sys, "details.cr", 0) ?? 0;
  const movement = dig(sys, "attributes.movement", {}) ?? {};

  let threatTags = [];
  try { threatTags = tagMonster(actor); }
  catch (err) { console.warn(`${LOG} | Tagging failed for ${actor?.name}:`, err); }

  let dmgProfile = { estimatedDPR: 0, burstDamage: 0, primaryTypes: [] };
  try { dmgProfile = estimateDPR(actor); }
  catch (err) { console.warn(`${LOG} | DPR estimation failed for ${actor?.name}:`, err); }

  const la = dig(sys, "attributes.legendary.max", 0) ??
             dig(sys, "resources.legact.max", 0) ?? 0;
  const lr = dig(sys, "attributes.legendary.lr", 0) ??
             dig(sys, "resources.legres.max", 0) ?? 0;

  // Check for legendary resistance via items
  const items = safeItems(actor);
  const lrFromItems = items.some(i => /\blegendary resistance\b/i.test(i?.name ?? ""));

  // Spellcaster level (highest spell level found)
  let spellLevel = null;
  for (const tag of threatTags) {
    const m = tag.match(/^spell-level-(\d+)$/);
    if (m) spellLevel = Math.max(spellLevel ?? 0, parseInt(m[1]));
  }

  // Build action summaries from items
  const actions = [];
  for (const item of items) {
    try {
      if (!item?.type || !["weapon", "feat"].includes(item.type)) continue;
      const desc = dig(item, "system.description.value", "") ?? "";
      const dmg = estimateItemDamage(item, actor);
      const range = dig(item, "system.range.long", 0) ?? dig(item, "system.range.value", 0) ?? 5;
      const isAOE = /\b(cone|line|sphere|cube|radius|cylinder|emanation)\b/i.test(desc);

      actions.push({
        name:          item.name,
        type:          item.type === "weapon" ? (range > 10 ? "ranged" : "melee") : "special",
        damageType:    dmg.types[0] ?? "",
        averageDamage: dmg.avg,
        isAOE,
        range,
        saveDC:        dig(item, "system.save.dc", null),
        saveAbility:   dig(item, "system.save.ability", null),
        conditions:    [],
        recharge:      dig(item, "system.recharge.value", null)
                         ? `${dig(item, "system.recharge.value", "")}-6` : null,
        isMultiAttack: /\bmultiattack\b/i.test(item.name ?? ""),
        multiAttackCount: 1
      });
    } catch (err) {
      console.warn(`${LOG} | Error parsing action ${item?.name}:`, err);
    }
  }

  const result = {
    actorId:              actor.id,
    name:                 actor.name,
    cr,
    xp:                   xpForCR(cr),
    quantity,
    ac:                   dig(sys, "attributes.ac.value", 10) ?? 10,
    hp:                   dig(sys, "attributes.hp.max", 1) ?? 1,
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
    hasBonusActionAttack:  false,
    hasMeaningfulReaction: actorHasReaction(actor),

    // DPR for round estimation
    estimatedDPR:         dmgProfile.estimatedDPR
  };

  console.log(`${LOG} | Threat ${actor.name}: CR ${cr}, AC ${result.ac}, HP ${result.hp}, DPR ~${dmgProfile.estimatedDPR}`);
  return result;
}

/**
 * Check if a monster has a meaningful reaction ability.
 */
function actorHasReaction(actor) {
  const items = safeItems(actor);
  for (const item of items) {
    try {
      const name = (item?.name ?? "").toLowerCase();
      if (/\bparry\b|\bcounterspell\b|\bshield\b|\breaction\b/.test(name)) return true;
      const activation = dig(item, "system.activation.type", "");
      if (activation === "reaction") return true;
    } catch { /* skip */ }
  }
  return false;
}
