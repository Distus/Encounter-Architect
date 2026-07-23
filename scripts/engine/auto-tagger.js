/**
 * Auto-Tag Engine.
 *
 * Reads Foundry dnd5e actor data and generates standardised threat tags
 * used by the warning rules engine for cross-referencing.
 *
 * @module engine/auto-tagger
 */

const LOG = "Encounter Architect | AutoTagger";

/* ── Helpers ───────────────────────────────────────────────────────────── */

const AOE_KEYWORDS = /\b(cone|line|sphere|cube|radius|cylinder|emanation)\b/i;
const CONDITION_MAP = {
  stunned:       "cc-stun",
  paralyzed:     "cc-paralyze",
  charmed:       "cc-charm",
  frightened:    "cc-frighten",
  restrained:    "cc-restrain",
  prone:         "cc-prone",
  incapacitated: "cc-incapacitate",
  petrified:     "cc-petrify",
  banished:      "cc-banish",
  banishment:    "cc-banish"
};

function dig(obj, path, fallback = undefined) {
  try {
    return path.split(".").reduce((o, k) => (o != null ? o[k] : fallback), obj);
  } catch { return fallback; }
}

function safeItems(actor) {
  try {
    if (actor.items?.contents) return actor.items.contents;
    if (actor.items?.[Symbol.iterator]) return [...actor.items];
    if (Array.isArray(actor.items)) return actor.items;
  } catch { /* ignore */ }
  return [];
}

function setToArray(val) {
  try {
    if (val instanceof Set) return [...val];
    if (Array.isArray(val)) return val;
  } catch { /* ignore */ }
  return [];
}

/* ── Monster Tagging ───────────────────────────────────────────────────── */

export function tagMonster(actor) {
  const tags = [];
  const sys = actor?.system ?? {};

  try {
    // Movement speeds
    const movement = dig(sys, "attributes.movement", {}) ?? {};
    if (movement.fly)    tags.push("flying");
    if (movement.burrow) tags.push("burrowing");
    if (movement.swim)   tags.push("swimming");
  } catch { /* skip */ }

  try {
    // Damage resistances & immunities
    const drArr = setToArray(dig(sys, "traits.dr.value", []));
    const diArr = setToArray(dig(sys, "traits.di.value", []));
    const ciArr = setToArray(dig(sys, "traits.ci.value", []));

    for (const r of drArr) tags.push(`resistance-${r}`);
    for (const i of diArr) tags.push(`immunity-${i}`);
    for (const c of ciArr) tags.push(`condition-immunity-${c}`);
  } catch { /* skip */ }

  try {
    // AC tag
    const ac = dig(sys, "attributes.ac.value", 0) ?? 0;
    if (ac >= 18) tags.push("high-ac");
  } catch { /* skip */ }

  // Feature / item scanning
  const items = safeItems(actor);
  for (const item of items) {
    try {
      const name = (item?.name ?? "").toLowerCase();
      const desc = dig(item, "system.description.value", "") ?? "";

      if (/\bmultiattack\b/i.test(name))              tags.push("multi-attack");
      if (/\bpack tactics\b/i.test(name))              tags.push("pack-tactics");
      if (/\blegendary resistance\b/i.test(name))      tags.push("legendary-resistance");
      if (/\bmagic resistance\b/i.test(name))          tags.push("magic-resistance");
      if (/\bregenerat/i.test(name))                   tags.push("regeneration");
      if (/\bshapechange|change shape\b/i.test(name))  tags.push("shapechanger");
      if (/\binvisib/i.test(name) || /\binvisib/i.test(desc)) tags.push("invisible");
      if (/\bteleport|misty step|dimension door\b/i.test(name) ||
          /\bteleport/i.test(desc))                    tags.push("teleport");
      if (/\bsummon/i.test(name) || /\bsummon/i.test(desc)) tags.push("summon");

      if (AOE_KEYWORDS.test(desc)) tags.push("aoe-damage");

      for (const [keyword, tag] of Object.entries(CONDITION_MAP)) {
        if (desc.toLowerCase().includes(keyword)) tags.push(tag);
      }

      const range = dig(item, "system.range.long", 0) ?? dig(item, "system.range.value", 0) ?? 0;
      if (range >= 60) tags.push("ranged");
      if ((dig(item, "system.reach", 0) ?? 0) > 5 || /reach/i.test(desc)) tags.push("reach");

      if (item.type === "spell") {
        tags.push("spellcaster");
        const lvl = dig(item, "system.level", 0) ?? 0;
        if (lvl > 0) tags.push(`spell-level-${lvl}`);
      }
    } catch (err) {
      console.warn(`${LOG} | Error scanning monster item ${item?.name}:`, err);
    }
  }

  try {
    const la = dig(sys, "attributes.legendary.max", 0) ?? dig(sys, "resources.legact.max", 0) ?? 0;
    if (la > 0) tags.push("legendary-actions");
  } catch { /* skip */ }

  try {
    const creatureType = dig(sys, "details.type.value", "") ?? "";
    const subtype = dig(sys, "details.type.subtype", "") ?? "";
    if (/swarm/i.test(creatureType) || /swarm/i.test(subtype) || /swarm/i.test(actor?.name ?? "")) {
      tags.push("swarm");
    }
  } catch { /* skip */ }

  return [...new Set(tags)];
}

/* ── Player Character Tagging ──────────────────────────────────────────── */

export function tagCharacter(actor) {
  const tags = [];

  let hasHealing = false;
  let hasConditionRemoval = false;
  let hasAOE = false;
  let hasRanged = false;
  let hasBonusActionAttack = false;
  const primaryDamageTypes = [];

  const items = safeItems(actor);
  for (const item of items) {
    try {
      const name = (item?.name ?? "").toLowerCase();
      const desc = dig(item, "system.description.value", "") ?? "";

      // Spells
      if (item.type === "spell") {
        tags.push("spellcaster");
        const lvl = dig(item, "system.level", 0) ?? 0;
        if (lvl > 0) tags.push(`spell-level-${lvl}`);

        if (/\bheal|restore|cure|revivify|mass heal/i.test(name)) hasHealing = true;
        if (/\blesser restoration|remove curse|dispel|greater restoration\b/i.test(name)) {
          hasConditionRemoval = true;
        }
        if (AOE_KEYWORDS.test(desc)) hasAOE = true;
      }

      // Weapons
      if (item.type === "weapon") {
        const range = dig(item, "system.range.long", 0) ?? dig(item, "system.range.value", 0) ?? 0;
        if (range >= 30) hasRanged = true;

        // Check for magic weapon
        const props = dig(item, "system.properties", null);
        if (props) {
          const propSet = props instanceof Set ? props : new Set(Object.keys(props));
          if (propSet.has("mgc") || /\+\d/.test(item.name ?? "")) {
            tags.push("has-magic-weapon");
          }
        }
      }

      // Class features
      if (/\btwo-weapon|dual wield|flurry of blows|bonus action attack\b/i.test(name) ||
          /\btwo-weapon|dual wield|flurry of blows\b/i.test(desc)) {
        hasBonusActionAttack = true;
      }
      if (/\baction surge\b/i.test(name)) tags.push("action-surge");
      if (/\bchannel divinity\b/i.test(name)) tags.push("channel-divinity");
      if (/\bextra attack\b/i.test(name)) tags.push("multi-attack");
    } catch (err) {
      console.warn(`${LOG} | Error scanning character item ${item?.name}:`, err);
    }
  }

  if (hasHealing)          tags.push("healer");
  if (hasConditionRemoval) tags.push("condition-removal");
  if (hasAOE)              tags.push("aoe-damage");
  if (hasRanged)           tags.push("ranged");
  if (hasBonusActionAttack) tags.push("bonus-action-attack");

  return [...new Set(tags)];
}
