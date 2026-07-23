/**
 * Encounter Architect — FoundryVTT Module
 * Visual encounter builder and analysis tool for D&D 5e (2024).
 *
 * @module encounter-architect
 * @author Shawn Preston
 */

import { EncounterBuilder } from "./ui/encounter-builder.js";
import { EncounterManager } from "./ui/encounter-manager.js";
import { registerSettings } from "./settings.js";

const MODULE_ID = "encounter-architect";

/* ───────────────────────── Initialisation ──────────────────────────────── */

Hooks.once("init", () => {
  console.log("Encounter Architect | Initialising");
  registerSettings();
});

Hooks.once("ready", () => {
  console.log("Encounter Architect | Ready");
});

/* ───────────────────────── Toolbar Button ──────────────────────────────── */

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  // v14 passes an object with grouped controls; v11-13 passes an array
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
          onClick: () => {
            EncounterManager.open();
          }
        }
      ]
    });
  } else {
    // v14+: add tool to the Token Controls group
    const tokenControls = controls.tokens?.tools ?? controls.token?.tools;
    if (tokenControls) {
      tokenControls["encounter-architect"] = {
        name: "encounter-architect",
        title: "Encounter Architect",
        icon: "fas fa-swords",
        button: true,
        onChange: () => {},
        onClick: () => {
          EncounterManager.open();
        }
      };
    }
  }
});

export { MODULE_ID };
