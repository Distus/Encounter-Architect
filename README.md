# Encounter Architect

A FoundryVTT module for D&D 5e (2024 ruleset) that provides a visual encounter building and analysis tool.

Drag party members and enemies onto a split-panel interface and get live difficulty ratings, action economy analysis, threat assessment, and specific tactical warnings based on actual character sheets and stat blocks.

## Features

- **2024 DMG Difficulty System** — XP budget calculator using the updated per-character thresholds (no group-size multipliers)
- **Action Economy Analysis** — Counts meaningful actions per side and adjusts difficulty accordingly
- **Auto-Tagging Engine** — Reads actor data to identify capabilities, resistances, immunities, and special features
- **Tactical Warning System** — Cross-references party and threat data to flag mismatches, vulnerabilities, and risks
- **DPR & Round Estimation** — Predicts combat duration based on damage math, accounting for hit probability, healing, and regeneration
- **Party Resource State** — Adjusts analysis based on how depleted the party is (Fresh → Critical)
- **Drag & Drop** — Drag actors from the sidebar directly into the encounter builder
- **Save & Organize** — Save encounters with tags, duplicate, export as JSON

## Installation

### Manifest URL (Recommended)

1. In Foundry, go to **Settings → Manage Modules → Install Module**
2. Paste this manifest URL:
   ```
   https://github.com/Distus/encounter-architect/releases/latest/download/module.json
   ```
3. Click **Install**

### Manual Installation

1. Download the latest release zip from [Releases](https://github.com/Distus/encounter-architect/releases)
2. Extract to your Foundry `Data/modules/` directory
3. Restart Foundry and enable the module in Module Management

## Requirements

- **Foundry VTT** v11+ (verified on v14)
- **D&D 5e System** (2024 ruleset)

## Usage

1. As GM, click the **crossed swords** icon in the Token Controls toolbar
2. Create a new encounter or open an existing one
3. Drag player characters from the Actors sidebar into the **Party** panel
4. Drag monsters/NPCs into the **Threats** panel (or use the Add Monster search)
5. Set the party's **Resource State** (Fresh, Lightly Taxed, Half Spent, etc.)
6. Review the live analysis in the centre panel

## Module Settings

| Setting | Default | Description |
|---|---|---|
| Analysis Depth | Full | Basic (XP only), Standard (+ action economy), or Full (+ warnings + round estimation) |
| Auto-Load Party | On | Auto-populate party panel with player characters |
| Show XP Values | On | Display XP budget numbers (disable for milestone games) |
| Minutes per Round | 5 | Real-time estimate per combat round |

## License

MIT License — see [LICENSE](LICENSE)

## Author

Shawn Preston — [GitHub](https://github.com/Distus)
