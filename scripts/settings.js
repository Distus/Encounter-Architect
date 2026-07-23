/**
 * Module settings registration.
 * @module settings
 */

const MODULE_ID = "encounter-architect";

export function registerSettings() {

  game.settings.register(MODULE_ID, "analysisDepth", {
    name: "Analysis Depth",
    hint: "How deep the encounter analysis goes. Basic = XP only. Standard = XP + action economy. Full = XP + action economy + ability analysis + tactical warnings.",
    scope: "world",
    config: true,
    type: String,
    choices: {
      basic: "Basic (XP Only)",
      standard: "Standard (XP + Action Economy)",
      full: "Full Analysis"
    },
    default: "full"
  });

  game.settings.register(MODULE_ID, "autoLoadParty", {
    name: "Auto-Load Party Members",
    hint: "Automatically populate the Party panel with active player characters when opening the encounter builder.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "showXPValues", {
    name: "Show XP Values",
    hint: "Display XP budget numbers on the difficulty gauge. Disable if you use milestone levelling and don't want players thinking about XP.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "minutesPerRound", {
    name: "Minutes per Combat Round (Real Time)",
    hint: "Average real-world minutes per combat round, used for the estimated duration display.",
    scope: "world",
    config: true,
    type: Number,
    default: 5,
    range: {
      min: 2,
      max: 15,
      step: 1
    }
  });

  /* ── Hidden settings (world-scoped data storage) ─────────────────────── */

  game.settings.register(MODULE_ID, "encounters", {
    name: "Saved Encounters",
    scope: "world",
    config: false,
    type: Object,
    default: {}
  });
}
