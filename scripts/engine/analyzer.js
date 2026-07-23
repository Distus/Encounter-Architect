/**
 * Analysis Aggregator — combines all engine layers into a single
 * AnalysisResult that the UI consumes.
 *
 * @module engine/analyzer
 */

import { calculateXPBudget, xpDifficulty, adjustDifficulty } from "./xp-calculator.js";
import { calculateActionEconomy } from "./action-economy.js";
import { estimateRounds, estimatePartyDPR, estimateEnemyDPR } from "./round-estimator.js";
import { generateWarnings } from "./warnings.js";

/**
 * Run a full encounter analysis.
 *
 * @param {object[]} party   - Array of PartyMember objects (from data-reader)
 * @param {object[]} threats - Array of ThreatEntry objects (from data-reader)
 * @param {number} resourceState - Party resource state (0.10 – 1.0, default 1.0)
 * @param {object} [options]
 * @param {string} [options.depth="full"] - "basic", "standard", or "full"
 * @param {number} [options.minutesPerRound=5]
 * @returns {object} AnalysisResult
 */
export function analyzeEncounter(party, threats, resourceState = 1.0, options = {}) {
  const depth = options.depth ?? "full";
  const minutesPerRound = options.minutesPerRound ?? 5;

  /* ── XP Budget & Difficulty ──────────────────────────────────────────── */

  const levels = party.map(m => m.level);
  const xpBudget = calculateXPBudget(levels);
  const totalMonsterXP = threats.reduce((s, t) => s + t.xp * t.quantity, 0);
  const rawDifficulty = xpDifficulty(totalMonsterXP, xpBudget);

  // Basic analysis stops here
  if (depth === "basic") {
    return {
      xpBudget,
      totalMonsterXP,
      xpDifficulty: rawDifficulty,
      adjustedDifficulty: rawDifficulty,
      resourceState,
      resourceAdjustedDifficulty: rawDifficulty,
      warnings: [],
      partySummary: buildPartySummary(party),
      threatSummary: buildThreatSummary(threats)
    };
  }

  /* ── Action Economy ──────────────────────────────────────────────────── */

  const actionEconomy = calculateActionEconomy(party, threats);
  const adjustedDifficulty = adjustDifficulty(rawDifficulty, actionEconomy.adjustment);

  // Standard analysis stops here
  if (depth === "standard") {
    return {
      xpBudget,
      totalMonsterXP,
      xpDifficulty: rawDifficulty,
      partyActions:         actionEconomy.partyActions,
      enemyActions:         actionEconomy.enemyActions,
      actionRatio:          actionEconomy.ratio,
      actionEconomyVerdict: actionEconomy.verdict,
      difficultyAdjustment: actionEconomy.adjustment,
      adjustedDifficulty,
      resourceState,
      resourceAdjustedDifficulty: adjustedDifficulty,
      warnings: [],
      partySummary: buildPartySummary(party),
      threatSummary: buildThreatSummary(threats)
    };
  }

  /* ── Full Analysis ───────────────────────────────────────────────────── */

  // Resource-state adjusted difficulty
  let resourceAdjustment = 0;
  if (resourceState <= 0.25) resourceAdjustment = 1;
  else if (resourceState <= 0.50) resourceAdjustment = 0.5;
  const resourceAdjustedDifficulty = adjustDifficulty(adjustedDifficulty, resourceAdjustment);

  // Round estimation
  const roundEstimate = estimateRounds(party, threats, resourceState, minutesPerRound);

  // DPR summaries
  const partyEffectiveDPR = estimatePartyDPR(party, threats, resourceState);
  const enemyEffectiveDPR = estimateEnemyDPR(threats, party);

  // Warnings
  const warnings = generateWarnings(party, threats, actionEconomy, resourceState, roundEstimate);

  // Add resource state + difficulty cross-reference warnings
  if (resourceState <= 0.50 && ["High", "Deadly"].includes(rawDifficulty)) {
    warnings.unshift({
      severity: "danger",
      category: "resource-state",
      message: `Party is at ${Math.round(resourceState * 100)}% resources facing a ${rawDifficulty} difficulty encounter — strong risk of party members going down.`,
      details: null
    });
  }

  // Quick stats comparison
  const partySummary = buildPartySummary(party);
  const threatSummary = buildThreatSummary(threats);
  const quickStats = buildQuickStats(partySummary, threatSummary, partyEffectiveDPR, enemyEffectiveDPR);

  return {
    xpBudget,
    totalMonsterXP,
    xpDifficulty: rawDifficulty,
    partyActions:         actionEconomy.partyActions,
    enemyActions:         actionEconomy.enemyActions,
    actionRatio:          actionEconomy.ratio,
    actionEconomyVerdict: actionEconomy.verdict,
    difficultyAdjustment: actionEconomy.adjustment,
    adjustedDifficulty,
    resourceState,
    resourceAdjustedDifficulty,
    estimatedRounds:      roundEstimate,
    partyEffectiveDPR,
    enemyEffectiveDPR,
    warnings,
    partySummary,
    threatSummary,
    quickStats
  };
}

/* ── Summary Builders ──────────────────────────────────────────────────── */

function buildPartySummary(party) {
  const totalHP = party.reduce((s, m) => s + m.hp, 0);
  const avgAC = party.length > 0
    ? Math.round(party.reduce((s, m) => s + m.ac, 0) / party.length)
    : 0;
  const totalHealing = party.reduce((s, m) => s + (m.healingCapability ?? 0), 0);
  const totalDPR = party.reduce((s, m) => s + (m.damageCapabilities?.estimatedDPR ?? 0), 0);

  return {
    count: party.length,
    totalHP,
    avgAC,
    totalHealing,
    totalDPR,
    avgLevel: party.length > 0
      ? Math.round(party.reduce((s, m) => s + m.level, 0) / party.length * 10) / 10
      : 0
  };
}

function buildThreatSummary(threats) {
  const totalHP = threats.reduce((s, t) => s + t.hp * t.quantity, 0);
  const totalCount = threats.reduce((s, t) => s + t.quantity, 0);
  const avgAC = totalCount > 0
    ? Math.round(threats.reduce((s, t) => s + t.ac * t.quantity, 0) / totalCount)
    : 0;
  const totalXP = threats.reduce((s, t) => s + t.xp * t.quantity, 0);
  const totalDPR = threats.reduce((s, t) => s + (t.estimatedDPR ?? 0) * t.quantity, 0);

  // Collect all unique threat tags
  const allTags = new Set();
  for (const t of threats) {
    for (const tag of t.threatTags ?? []) allTags.add(tag);
  }

  return {
    count: totalCount,
    uniqueCreatures: threats.length,
    totalHP,
    avgAC,
    totalXP,
    totalDPR,
    keyTags: [...allTags]
  };
}

function buildQuickStats(partySummary, threatSummary, partyDPR, enemyDPR) {
  return {
    partyAvgAC: partySummary.avgAC,
    enemyAvgAC: threatSummary.avgAC,
    partyTotalHP: partySummary.totalHP,
    enemyTotalHP: threatSummary.totalHP,
    partyDPR,
    enemyDPR,
    roundsToDefeat: enemyDPR > 0 ? Math.ceil(partySummary.totalHP / enemyDPR) : 99,
    roundsToBeDefeated: partyDPR > 0 ? Math.ceil(threatSummary.totalHP / partyDPR) : 99
  };
}
