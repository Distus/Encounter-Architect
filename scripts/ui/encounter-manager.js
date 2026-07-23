/**
 * Encounter Manager — list view for saved encounters.
 *
 * Follows the same singleton pattern as The Merchant's Guild ShopManager.
 *
 * @module ui/encounter-manager
 */

import { EncounterBuilder } from "./encounter-builder.js";

const MODULE_ID = "encounter-architect";

export class EncounterManager extends Application {

  static _instance = null;

  static get defaultOptions() {
    return foundry.utils.mergeObject(super.defaultOptions, {
      id: "encounter-manager",
      title: "Encounter Architect",
      template: `modules/${MODULE_ID}/templates/encounter-manager.hbs`,
      classes: ["encounter-architect", "encounter-manager"],
      width: 480,
      height: 560,
      resizable: true
    });
  }

  /**
   * Singleton accessor.
   */
  static open() {
    if (!this._instance) this._instance = new EncounterManager();
    this._instance.render(true);
  }

  /* ── Data ──────────────────────────────────────────────────────────── */

  getData() {
    const encounters = game.settings.get(MODULE_ID, "encounters") ?? {};
    const list = Object.values(encounters).sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "")
    );
    return { encounters: list, isEmpty: list.length === 0 };
  }

  /* ── Event Listeners ───────────────────────────────────────────────── */

  activateListeners(html) {
    super.activateListeners(html);

    html.find(".ea-new-encounter").click(() => this._createEncounter());
    html.find(".ea-open-encounter").click(ev => {
      const id = ev.currentTarget.closest("[data-id]").dataset.id;
      this._openEncounter(id);
    });
    html.find(".ea-duplicate-encounter").click(ev => {
      const id = ev.currentTarget.closest("[data-id]").dataset.id;
      this._duplicateEncounter(id);
    });
    html.find(".ea-delete-encounter").click(ev => {
      const id = ev.currentTarget.closest("[data-id]").dataset.id;
      this._deleteEncounter(id);
    });
    html.find(".ea-search-input").on("input", ev => {
      const query = ev.currentTarget.value.toLowerCase();
      html.find(".ea-encounter-row").each((_, row) => {
        const name = row.dataset.name?.toLowerCase() ?? "";
        const tags = row.dataset.tags?.toLowerCase() ?? "";
        row.style.display = (name.includes(query) || tags.includes(query)) ? "" : "none";
      });
    });
  }

  /* ── Actions ───────────────────────────────────────────────────────── */

  async _createEncounter() {
    const id = foundry.utils.randomID();
    const encounter = {
      id,
      name: "New Encounter",
      partyMembers: [],
      threats: [],
      partyResourceState: 1.0,
      notes: "",
      tags: [],
      createdAt: Date.now(),
      lastModified: Date.now()
    };

    const encounters = foundry.utils.deepClone(
      game.settings.get(MODULE_ID, "encounters") ?? {}
    );
    encounters[id] = encounter;
    await game.settings.set(MODULE_ID, "encounters", encounters);

    this.render();
    EncounterBuilder.open(id);
  }

  _openEncounter(id) {
    EncounterBuilder.open(id);
  }

  async _duplicateEncounter(id) {
    const encounters = foundry.utils.deepClone(
      game.settings.get(MODULE_ID, "encounters") ?? {}
    );
    const original = encounters[id];
    if (!original) return;

    const newId = foundry.utils.randomID();
    const copy = foundry.utils.deepClone(original);
    copy.id = newId;
    copy.name = `${original.name} (Copy)`;
    copy.createdAt = Date.now();
    copy.lastModified = Date.now();

    encounters[newId] = copy;
    await game.settings.set(MODULE_ID, "encounters", encounters);
    this.render();
  }

  async _deleteEncounter(id) {
    const confirmed = await Dialog.confirm({
      title: "Delete Encounter",
      content: "<p>Are you sure you want to delete this encounter?</p>"
    });
    if (!confirmed) return;

    const encounters = foundry.utils.deepClone(
      game.settings.get(MODULE_ID, "encounters") ?? {}
    );
    delete encounters[id];
    await game.settings.set(MODULE_ID, "encounters", encounters);
    this.render();
  }
}
