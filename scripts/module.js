/**
 * Encounter Architect — FoundryVTT Module
 * Visual encounter builder and analysis tool for D&D 5e (2024).
 *
 * @module encounter-architect
 * @author Shawn Preston
 */

const MODULE_ID = "encounter-architect";

/* ───────────────────────── Lazy Imports ────────────────────────────────── */
// Defer imports so a broken engine file can't prevent the toolbar from loading

let EncounterManager = null;

async function ensureImports() {
  if (EncounterManager) return true;
  try {
    const managerMod = await import("./ui/encounter-manager.js");
    EncounterManager = managerMod.EncounterManager;
    console.log("Encounter Architect | All modules loaded successfully");
    return true;
  } catch (err) {
    console.error("Encounter Architect | FATAL — failed to load modules:", err);
    ui.notifications.error("Encounter Architect failed to load. Check the console (F12) for details.");
    return false;
  }
}

/* ───────────────────────── Initialisation ──────────────────────────────── */

Hooks.once("init", () => {
  console.log("Encounter Architect | Initialising");
  try {
    game.settings.register(MODULE_ID, "analysisDepth", {
      name: "Analysis Depth",
      hint: "How deep the encounter analysis goes.",
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
      hint: "Automatically populate the Party panel with active player characters.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "showXPValues", {
      name: "Show XP Values",
      hint: "Display XP budget numbers on the difficulty gauge.",
      scope: "world",
      config: true,
      type: Boolean,
      default: true
    });

    game.settings.register(MODULE_ID, "minutesPerRound", {
      name: "Minutes per Combat Round (Real Time)",
      hint: "Average real-world minutes per combat round.",
      scope: "world",
      config: true,
      type: Number,
      default: 5,
      range: { min: 2, max: 15, step: 1 }
    });

    game.settings.register(MODULE_ID, "encounters", {
      name: "Saved Encounters",
      scope: "world",
      config: false,
      type: Object,
      default: {}
    });

    console.log("Encounter Architect | Settings registered");
  } catch (err) {
    console.error("Encounter Architect | Error registering settings:", err);
  }
});

Hooks.once("ready", () => {
  console.log("Encounter Architect | Ready");
  // Pre-load imports in background
  ensureImports();
});

/* ───────────────────────── Toolbar Button ──────────────────────────────── */

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  console.log("Encounter Architect | Registering toolbar button, controls type:", typeof controls, Array.isArray(controls) ? "array" : "object");

  const openManager = async () => {
    const ready = await ensureImports();
    if (ready) EncounterManager.open();
  };

  try {
    if (Array.isArray(controls)) {
      // v11-13: add as a new control group
      controls.push({
        name: "encounter-architect",
        title: "Encounter Architect",
        icon: "fas fa-swords",
        layer: "controls",
        visible: true,
        tools: [
          {
            name: "open-manager",
            title: "Encounter Manager",
            icon: "fas fa-swords",
            button: true,
            onClick: openManager
          }
        ]
      });
      console.log("Encounter Architect | Toolbar registered (v11-13 array mode)");
    } else {
      // v14+: add tool to the Token Controls group
      const tokenControls = controls.tokens?.tools ?? controls.token?.tools;
      console.log("Encounter Architect | Token controls found:", !!tokenControls);

      if (tokenControls) {
        tokenControls["encounter-architect"] = {
          name: "encounter-architect",
          title: "Encounter Architect",
          icon: "fas fa-swords",
          button: true,
          onChange: () => {},
          onClick: openManager
        };
        console.log("Encounter Architect | Toolbar registered (v14 object mode)");
      } else {
        console.warn("Encounter Architect | Could not find token controls group. Keys available:", Object.keys(controls));
      }
    }
  } catch (err) {
    console.error("Encounter Architect | Error registering toolbar:", err);
  }
});

export { MODULE_ID };
