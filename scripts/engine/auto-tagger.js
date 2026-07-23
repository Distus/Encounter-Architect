/**
 * Auto-Tag Engine.
 *
 * Reads Foundry dnd5e actor data and generates standardised threat tags
 * used by the warning rules engine for cross-referencing.
 *
 * @module engine/auto-tagger
 */

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

/**
 * Safely read a nested property, returning a fallback on failure.
 */
function dig(obj, path, fallback = undefined) {
  return path.split(".").reduce((o, k) => (o != null ? o[k] : fallback), obj);
}

/**
 * Search an actor's item descriptions for a keyword (case-insensitive).
 */
function actorHasFeatureMatch(actor, regex) {
  for (const item of actor.items ?? []) {
    const desc = dig(item, "system.description.value", "");
    const name = item.name ?? "";
    if (regex.test(name) || regex.test(desc)) return true;
  }
  return false;
}

/* ── Monster Tagging ───────────────────────────────────────────────────── */

/**
 * Generate threat tags for a monster actor.
 *
 * @param {Actor5e} actor - Foundry dnd5e NPC actor
 * @returns {string[]} Array of threat tag strings
 */
export function tagMonster(actor) {
  const tags = [];
  const sys = actor.system ?? {};

  // ── Movement speeds ─────────────────────────────────────────────────
  const movement = dig(sys, "attributes.movement", {});
  if (movement.fly)    tags.push("flying");
  if (movement.burrow) tags.push("burrowing");
  if (movement.swim)   tags.push("swimming");

  // ── Damage resistances & immunities ─────────────────────────────────
  // dnd5e 2024 stores these as Sets; fall back to arrays for older data
  const dr = dig(sys, "traits.dr.value", []);
  const di = dig(sys, "traits.di.value", []);
  const ci = dig(sys, "traits.ci.value", []);

  const drArr = dr instanceof Set ? [...dr] : (Array.isArray(dr) ? dr : []);
  const diArr = di instanceof Set ? [...di] : (Array.isArray(di) ? di : []);
  const ciArr = ci instanceof Set ? [...ci] : (Array.isArray(ci) ? ci : []);

  for (const r of drArr) tags.push(`resistance-${r}`);
  for (const i of diArr) tags.push(`immunity-${i}`);
  for (const c of ciArr) tags.push(`condition-immunity-${c}`);

  // ── AC / HP stat tags ───────────────────────────────────────────────
  const ac = dig(sys, "attributes.ac.value", 0);
  if (ac >= 18) tags.push("high-ac");

  // ── Feature / item scanning ─────────────────────────────────────────
  for (const item of actor.items ?? []) {
    const name = (item.name ?? "").toLowerCase();
    const desc = dig(item, "system.description.value", "") ?? "";

    // Core feature detection
    if (/\bmultiattack\b/i.test(name))            tags.push("multi-attack");
    if (/\bpack tactics\b/i.test(name))            tags.push("pack-tactics");
    if (/\blegendary resistance\b/i.test(name))    tags.push("legendary-resistance");
    if (/\bmagic resistance\b/i.test(name))        tags.push("magic-resistance");
    if (/\bregenerat/i.test(name))                 tags.push("regeneration");
    if (/\bshapechange|change shape\b/i.test(name)) tags.push("shapechanger");
    if (/\binvisib/i.test(name) || /\binvisib/i.test(desc)) tags.push("invisible");
    if (/\bteleport|misty step|dimension door\b/i.test(name) ||
        /\bteleport/i.test(desc))                  tags.push("teleport");
    if (/\bsummon/i.test(name) || /\bsummon/i.test(desc)) tags.push("summon");

    // AOE detection
    if (AOE_KEYWORDS.test(desc)) tags.push("aoe-damage");

    // Condition infliction detection
    for (const [keyword, tag] of Object.entries(CONDITION_MAP)) {
      if (desc.toLowerCase().includes(keyword)) tags.push(tag);
    }

    // Ranged attack detection
    const range = dig(item, "system.range.long", 0) || dig(item, "system.range.value", 0);
    if (range >= 60) tags.push("ranged");
    if (dig(item, "system.reach", 0) > 5 || /reach/i.test(desc)) tags.push("reach");

    // Spellcasting detection
    if (item.type === "spell") {
      tags.push("spellcaster");
      const lvl = dig(item, "system.level", 0);
      if (lvl > 0) tags.push(`spell-level-${lvl}`);
    }
  }

  // Legendary actions (stored on the actor)
  const la = dig(sys, "attributes.legendary.max", 0) || dig(sys, "resources.legact.max", 0);
  if (la > 0) tags.push("legendary-actions");

  // Swarm detection
  const creatureType = dig(sys, "details.type.value", "") ?? "";
  const subtype = dig(sys, "details.type.subtype", "") ?? "";
  if (/swarm/i.test(creatureType) || /swarm/i.test(subtype) || /swarm/i.test(actor.name)) {
    tags.push("swarm");
  }

  // Deduplicate
  return [...new Set(tags)];
}

/* ── Player Character Tagging ──────────────────────────────────────────── */

/**
 * Generate threat tags for a player character actor.
 *
 * @param {Actor5e} actor - Foundry dnd5e character actor
 * @returns {string[]} Array of threat tag strings
 */
export function tagCharacter(actor) {
  const tags = [];
  const sys = actor.system ?? {};

  let hasHealing = false;
  let hasConditionRemoval = false;
  let hasAOE = false;
  let hasRanged = false;
  let hasBonusActionAttack = false;
  let primaryDamageTypes = [];

  for (const item of actor.items ?? []) {
    const name = (item.name ?? "").toLowerCase();
    const desc = dig(item, "system.description.value", "") ?? "";

    // ── Spells ────────────────────────────────────────────────────────
    if (item.type === "spell") {
      tags.push("spellcaster");
      const lvl = dig(item, "system.level", 0);
      if (lvl > 0) tags.push(`spell-level-${lvl}`);

      // Healing spells
      if (/\bheal|restore|cure|revivify|mass heal/i.test(name)) hasHealing = true;

      // Condition removal
      if (/\blesser restoration|remove curse|dispel|greater restoration\b/i.test(name)) {
        hasConditionRemoval = true;
      }

      // AOE
      if (AOE_KEYWORDS.test(desc)) hasAOE = true;

      // Damage type from spell
      const dmgType = dig(item, "system.damage.parts.0.1", null) ??
                       dig(item, "system.damage.base.types", null);
      if (dmgType) {
        const types = Array.isArray(dmgType) ? dmgType : [dmgType];
        primaryDamageTypes.push(...types);
      }
    }

    // ── Weapons ───────────────────────────────────────────────────────
    if (item.type === "weapon") {
      const range = dig(item, "system.range.long", 0) || dig(item, "system.range.value", 0);
      if (range >= 30) hasRanged = true;

      const wpnDmgType = dig(item, "system.damage.parts.0.1", null) ??
                          dig(item, "system.damage.base.types.0", null);
      if (wpnDmgType) primaryDamageTypes.push(wpnDmgType);

      // Check for magic weapon properties
      const magical = dig(item, "system.properties", new Set());
      const magSet = magical instanceof Set ? magical : new Set(Object.keys(magical));
      if (magSet.has("mgc") || /\+\d/i.test(item.name)) {
        tags.push("has-magic-weapon");
      }
    }

    // ── Class features ────────────────────────────────────────────────
    if (/\btwo-weapon|dual wield|flurry of blows|bonus action attack\b/i.test(name) ||
        /\btwo-weapon|dual wield|flurry of blows\b/i.test(desc)) {
      hasBonusActionAttack = true;
    }
    if (/\baction surge\b/i.test(name)) tags.push("action-surge");
    if (/\bchannel divinity\b/i.test(name)) tags.push("channel-divinity");
    if (/\bextra attack\b/i.test(name)) tags.push("multi-attack");
  }

  if (hasHealing)          tags.push("healer");
  if (hasConditionRemoval) tags.push("condition-removal");
  if (hasAOE)              tags.push("aoe-damage");
  if (hasRanged)           tags.push("ranged");
  if (hasBonusActionAttack) tags.push("bonus-action-attack");

  // Primary damage types (deduplicated, most frequent first)
  const typeCounts = {};
  for (const t of primaryDamageTypes) {
    if (typeof t === "string") typeCounts[t] = (typeCounts[t] || 0) + 1;
  }
  const sorted = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0) tags.push(`primary-damage-${sorted[0][0]}`);

  return [...new Set(tags)];
}
