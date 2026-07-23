/**
 * Encounter Builder — the main split-panel workspace.
 *
 * Left panel:  Party members (auto-load or drag)
 * Right panel: Threats (search/drag to add)
 * Centre:      Live analysis dashboard
 *
 * @module ui/encounter-builder
 */

import { readPartyMember, readThreat } from "../engine/data-reader.js";
import { analyzeEncounter } from "../engine/analyzer.js";

const MODULE_ID = "encounter-architect";

export class EncounterBuilder extends Application {

  static _instances = {};

  /**
   * Open (or focus) the builder for a specific encounter ID.
   */
  static open(encounterId) {
    if (!this._instances[encounterId]) {
      this._instances[encounterId] = new EncounterBuilder(encounterId);
    }
    this._instances[encounterId].render(true);
  }

  constructor(encounterId) {
    super();
    this.encounterId = encounterId;
    this._partyData = [];
    this._threatData = [];
    this._analysis = null;
  }

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "encounter-builder",
      title: "Encounter Builder",
      template: `modules/${MODULE_ID}/templates/encounter-builder.hbs`,
      classes: ["encounter-architect", "encounter-builder"],
      width: 960,
      height: 700,
      resizable: true,
      dragDrop: [{ dropSelector: ".ea-party-panel, .ea-threats-panel" }]
    });
  }

  get title() {
    return `Encounter Architect — ${this._encounter?.name ?? "New Encounter"}`;
  }

  /* ── Data ──────────────────────────────────────────────────────────── */

  get _encounter() {
    const encounters = game.settings.get(MODULE_ID, "encounters") ?? {};
    return encounters[this.encounterId];
  }

  async getData() {
    const enc = this._encounter;
    if (!enc) return { error: true };

    // Auto-load party if setting enabled and party is empty
    if (game.settings.get(MODULE_ID, "autoLoadParty") && enc.partyMembers.length === 0) {
      await this._autoLoadParty();
    }

    // Build live data from stored actor IDs
    this._partyData = this._buildPartyData(enc.partyMembers);
    this._threatData = this._buildThreatData(enc.threats);

    // Run analysis
    const depth = game.settings.get(MODULE_ID, "analysisDepth");
    const minutesPerRound = game.settings.get(MODULE_ID, "minutesPerRound");
    this._analysis = analyzeEncounter(
      this._partyData,
      this._threatData,
      enc.partyResourceState ?? 1.0,
      { depth, minutesPerRound }
    );

    return {
      encounter: enc,
      party: this._partyData,
      threats: enc.threats ?? [],
      analysis: this._analysis,
      resourceState: enc.partyResourceState ?? 1.0,
      showXP: game.settings.get(MODULE_ID, "showXPValues"),
      difficultyColor: this._difficultyColor(this._analysis.resourceAdjustedDifficulty ?? this._analysis.adjustedDifficulty)
    };
  }

  /* ── Build Live Data ───────────────────────────────────────────────── */

  _buildPartyData(members) {
    return (members ?? []).map(m => {
      const actor = game.actors.get(m.actorId);
      if (!actor) return { ...m, missing: true };
      return readPartyMember(actor, m.isAlly ?? false);
    }).filter(m => !m.missing);
  }

  _buildThreatData(threats) {
    return (threats ?? []).map(t => {
      if (t.actorId) {
        const actor = game.actors.get(t.actorId);
        if (!actor) return { ...t, missing: true };
        const data = readThreat(actor, t.quantity ?? 1);
        data.hasLairActions = t.hasLairActions ?? false;
        return data;
      }
      return t; // manual entry
    }).filter(t => !t.missing);
  }

  async _autoLoadParty() {
    const enc = foundry.utils.deepClone(this._encounter);
    const pcs = game.actors.filter(
      a => a.type === "character" && a.hasPlayerOwner
    );
    enc.partyMembers = pcs.map(a => ({
      actorId: a.id,
      name: a.name,
      isAlly: false
    }));
    await this._saveEncounter(enc);
  }

  /* ── Event Listeners ───────────────────────────────────────────────── */

  activateListeners(html) {
    super.activateListeners(html);

    // Encounter name editing
    html.find(".ea-encounter-name").on("change", async (ev) => {
      const enc = foundry.utils.deepClone(this._encounter);
      enc.name = ev.currentTarget.value;
      await this._saveEncounter(enc);
    });

    // Resource state selector
    html.find(".ea-resource-state").on("change", async (ev) => {
      const enc = foundry.utils.deepClone(this._encounter);
      enc.partyResourceState = parseFloat(ev.currentTarget.value);
      await this._saveEncounter(enc);
      this.render();
    });

    // Remove party member
    html.find(".ea-remove-party").click(async (ev) => {
      const actorId = ev.currentTarget.closest("[data-actor-id]").dataset.actorId;
      const enc = foundry.utils.deepClone(this._encounter);
      enc.partyMembers = enc.partyMembers.filter(m => m.actorId !== actorId);
      await this._saveEncounter(enc);
      this.render();
    });

    // Threat quantity adjustment
    html.find(".ea-threat-qty").on("change", async (ev) => {
      const idx = parseInt(ev.currentTarget.closest("[data-threat-idx]").dataset.threatIdx);
      const enc = foundry.utils.deepClone(this._encounter);
      enc.threats[idx].quantity = Math.max(1, parseInt(ev.currentTarget.value) || 1);
      await this._saveEncounter(enc);
      this.render();
    });

    // Lair actions toggle
    html.find(".ea-lair-toggle").on("change", async (ev) => {
      const idx = parseInt(ev.currentTarget.closest("[data-threat-idx]").dataset.threatIdx);
      const enc = foundry.utils.deepClone(this._encounter);
      enc.threats[idx].hasLairActions = ev.currentTarget.checked;
      await this._saveEncounter(enc);
      this.render();
    });

    // Remove threat
    html.find(".ea-remove-threat").click(async (ev) => {
      const idx = parseInt(ev.currentTarget.closest("[data-threat-idx]").dataset.threatIdx);
      const enc = foundry.utils.deepClone(this._encounter);
      enc.threats.splice(idx, 1);
      await this._saveEncounter(enc);
      this.render();
    });

    // Add monster button (opens compendium browser)
    html.find(".ea-add-monster").click(() => this._openMonsterSearch(html));

    // Toggle expandable details
    html.find(".ea-expand-toggle").click(ev => {
      const detail = ev.currentTarget.closest(".ea-creature-card").querySelector(".ea-detail");
      if (detail) detail.classList.toggle("ea-hidden");
    });

    // Collapse warning categories
    html.find(".ea-warning-category-header").click(ev => {
      const section = ev.currentTarget.nextElementSibling;
      if (section) section.classList.toggle("ea-hidden");
      ev.currentTarget.classList.toggle("ea-collapsed");
    });

    // Notes
    html.find(".ea-notes-btn").click(() => this._editNotes());

    // Tags
    html.find(".ea-tags-input").on("change", async (ev) => {
      const enc = foundry.utils.deepClone(this._encounter);
      enc.tags = ev.currentTarget.value.split(",").map(t => t.trim()).filter(Boolean);
      await this._saveEncounter(enc);
    });

    // Save button (for explicit saves / name changes propagation)
    html.find(".ea-save-btn").click(() => {
      ui.notifications.info("Encounter saved.");
    });

    // Export JSON
    html.find(".ea-export-btn").click(() => this._exportJSON());
  }

  /* ── Drag and Drop ─────────────────────────────────────────────────── */

  _canDragDrop(selector) {
    return game.user.isGM;
  }

  async _onDrop(event) {
    let data;
    try {
      data = JSON.parse(event.dataTransfer.getData("text/plain"));
    } catch { return; }

    if (data.type !== "Actor") return;

    const actor = await fromUuid(data.uuid ?? `Actor.${data.id}`);
    if (!actor) return;

    const enc = foundry.utils.deepClone(this._encounter);
    const targetPanel = event.currentTarget.closest(".ea-party-panel, .ea-threats-panel");

    if (targetPanel?.classList.contains("ea-party-panel")) {
      // Add as party member (skip duplicates)
      if (enc.partyMembers.some(m => m.actorId === actor.id)) {
        ui.notifications.warn(`${actor.name} is already in the party.`);
        return;
      }
      enc.partyMembers.push({
        actorId: actor.id,
        name: actor.name,
        isAlly: actor.type !== "character"
      });

    } else if (targetPanel?.classList.contains("ea-threats-panel")) {
      // Add as threat (allow duplicates by bumping quantity)
      const existing = enc.threats.find(t => t.actorId === actor.id);
      if (existing) {
        existing.quantity = (existing.quantity ?? 1) + 1;
      } else {
        enc.threats.push({
          actorId: actor.id,
          name: actor.name,
          quantity: 1,
          hasLairActions: false
        });
      }
    }

    await this._saveEncounter(enc);
    this.render();
  }

  /* ── Monster Search (inline) ───────────────────────────────────────── */

  _openMonsterSearch(html) {
    // Simple prompt-based search for now; Phase 4 adds the full browser
    new Dialog({
      title: "Add Monster",
      content: `
        <form>
          <div class="form-group">
            <label>Search by Name</label>
            <input type="text" name="query" placeholder="e.g., Goblin, Dragon…" autofocus />
          </div>
        </form>`,
      buttons: {
        search: {
          icon: '<i class="fas fa-search"></i>',
          label: "Search",
          callback: (dialogHtml) => {
            const query = dialogHtml.find("[name=query]").val().toLowerCase();
            this._performMonsterSearch(query);
          }
        }
      },
      default: "search"
    }).render(true);
  }

  async _performMonsterSearch(query) {
    if (!query) return;

    // Search world actors
    const results = game.actors.filter(
      a => a.type === "npc" && a.name.toLowerCase().includes(query)
    );

    if (results.length === 0) {
      ui.notifications.info(`No monsters found matching "${query}".`);
      return;
    }

    // Let the DM pick from results
    const options = results.slice(0, 20).map(a => `<option value="${a.id}">${a.name} (CR ${a.system?.details?.cr ?? "?"})</option>`).join("");

    new Dialog({
      title: "Select Monster",
      content: `
        <form>
          <div class="form-group">
            <label>Found ${results.length} result${results.length !== 1 ? "s" : ""}</label>
            <select name="actorId">${options}</select>
          </div>
          <div class="form-group">
            <label>Quantity</label>
            <input type="number" name="qty" value="1" min="1" max="50" />
          </div>
        </form>`,
      buttons: {
        add: {
          icon: '<i class="fas fa-plus"></i>',
          label: "Add",
          callback: async (dialogHtml) => {
            const actorId = dialogHtml.find("[name=actorId]").val();
            const qty = parseInt(dialogHtml.find("[name=qty]").val()) || 1;
            const actor = game.actors.get(actorId);
            if (!actor) return;

            const enc = foundry.utils.deepClone(this._encounter);
            const existing = enc.threats.find(t => t.actorId === actorId);
            if (existing) {
              existing.quantity += qty;
            } else {
              enc.threats.push({
                actorId,
                name: actor.name,
                quantity: qty,
                hasLairActions: false
              });
            }
            await this._saveEncounter(enc);
            this.render();
          }
        }
      },
      default: "add"
    }).render(true);
  }

  /* ── Helpers ────────────────────────────────────────────────────────── */

  async _saveEncounter(enc) {
    enc.lastModified = Date.now();
    const encounters = foundry.utils.deepClone(
      game.settings.get(MODULE_ID, "encounters") ?? {}
    );
    encounters[enc.id] = enc;
    await game.settings.set(MODULE_ID, "encounters", encounters);
  }

  _difficultyColor(difficulty) {
    const colors = {
      Trivial:  "#888888",
      Low:      "#4CAF50",
      Moderate: "#FFC107",
      High:     "#FF9800",
      Deadly:   "#F44336"
    };
    return colors[difficulty] ?? "#888888";
  }

  async _editNotes() {
    const enc = this._encounter;
    new Dialog({
      title: "Encounter Notes",
      content: `<textarea name="notes" style="width:100%;height:200px">${enc.notes ?? ""}</textarea>`,
      buttons: {
        save: {
          label: "Save",
          callback: async (html) => {
            const updated = foundry.utils.deepClone(enc);
            updated.notes = html.find("[name=notes]").val();
            await this._saveEncounter(updated);
          }
        }
      },
      default: "save"
    }).render(true);
  }

  _exportJSON() {
    const enc = this._encounter;
    if (!enc) return;
    const data = JSON.stringify(enc, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const filename = `${enc.name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase()}.json`;
    saveDataToFile(data, "application/json", filename);
    ui.notifications.info(`Exported: ${filename}`);
  }
}
