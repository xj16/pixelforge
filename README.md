# PixelForge

**A Godot 4 2D action-platformer / metroidvania with a sandboxed Lua modding layer and C#/.NET performance systems.**

PixelForge is a small but genuinely working game built to showcase a real
**community modding pipeline**: enemy AI, items, damage elements, and difficulty
tuning are all exposed to **sandboxed Lua scripts** that the game **hot-reloads**
from an in-game **mod browser** — no restart, no recompile. Performance-sensitive
work (deterministic combat math, A\* enemy pathfinding) lives in **C#/.NET** and
is unit-tested independently of the engine.

> Source-only project. The game runs in the Godot 4.6 editor. The Lua modding
> layer is powered by the third-party [`lua-gdextension`](https://github.com/gilzoide/lua-gdextension)
> addon, fetched with a one-line script (see [Running](#running)).

---

## Why

Most "moddable" indie games bolt scripting on late and end up exposing the whole
engine to mod authors — a security and stability nightmare. PixelForge is a
compact reference for doing it properly:

- **Each mod gets its own sandboxed `LuaState`** with only a safe subset of
  standard libraries opened (no `io`, `os`, `package`, or arbitrary engine
  singletons/classes). A misbehaving mod can't read your disk or crash a
  sibling mod.
- **Mods touch the engine through one curated API** (`game.*`), never through
  raw `Node` references.
- **Hot-reload is first-class.** Edit a `.lua` file, hit *Reload* in the mod
  browser (or press `R`), and the change is live — enemies re-spawn from the new
  definitions immediately.
- **The heavy lifting is in C#.** Damage resolution and pathfinding are pure,
  deterministic, and unit-tested on a plain .NET runner, then wrapped in thin
  Godot nodes.

## Features

| Area | What's implemented |
| --- | --- |
| **Platforming** | `CharacterBody2D` player with coyote time, jump buffering, variable jump height, an i-frame dash, and a melee attack hitbox. |
| **Enemies** | Data-driven archetypes. Grounded enemies path with C# A\*; flyers home in. AI can be delegated to a mod-supplied Lua `think(ctx)` brain. |
| **Combat (C#)** | Deterministic, seeded damage math: crits, armor, elemental multipliers, resistances, variance. Reproducible for replays. |
| **Pathfinding (C#)** | 8-connected A\* over a tile grid with a binary min-heap, no diagonal corner-cutting, and a "must stand on ground" rule for walkers. |
| **Lua modding** | Sandboxed per-mod `LuaState`; register enemies, items, and damage elements; subscribe to game events; tweak global config; lifecycle hooks. |
| **Mod browser** | In-game UI (`M`) listing every discovered mod with metadata and load errors; per-mod enable/disable; hot-reload; open-mods-folder. |
| **Sample mods** | Three real, documented example mods under `mods/`. |

## Tech stack

- **Godot 4.6** (Forward+ renderer, `.NET`/Mono build) — engine, scenes, GDScript glue.
- **GDScript** — gameplay orchestration, entities, UI, and the mod loader/sandbox.
- **C# / .NET 8** — `PixelForge.Core` (Godot-free algorithms) + thin Godot node adapters (`CombatResolver`, `NavGrid`).
- **Lua 5.4** via **[`lua-gdextension`](https://github.com/gilzoide/lua-gdextension)** — sandboxed modding runtime.
- **xUnit** — unit tests for the pure C# core.
- **GitHub Actions** — C# build+test, Lua lint (`luacheck`), and a headless Godot project import.

## Project layout

```
pixelforge/
├── project.godot              # Godot project (autoloads, input map, C# feature)
├── PixelForge.sln / .csproj   # Godot .NET build (game C# nodes)
├── scenes/                    # Main, World, Player, Enemy, Pickup, HUD, ModBrowser
├── src/
│   ├── core/                  # GameConfig, EventBus (autoloads)
│   ├── entities/              # Player, Enemy, Pickup
│   ├── systems/               # World (nav grid build, spawning, C# bridge)
│   ├── modding/               # ModLoader (sandbox), ModApi (curated surface)
│   └── ui/                    # HUD, ModBrowser
├── csharp/                    # Godot node adapters: CombatResolver, NavGrid
├── core-lib/PixelForge.Core/  # Pure, Godot-free math: DamageCalculator, AStarPathfinder, ModManifestValidator
├── tests/PixelForge.Tests/    # xUnit tests for the core lib
├── mods/                      # Bundled example mods (frost_slime, healing_orb, hard_mode)
├── scripts/fetch_addons.sh    # Downloads the lua-gdextension addon
└── docs/MODDING.md            # Full modding API reference
```

## Running

**Requirements:** [Godot 4.6 **.NET** edition](https://godotengine.org/download) and the .NET 8 SDK.

```bash
# 1. Clone
git clone https://github.com/xj16/pixelforge.git
cd pixelforge

# 2. Fetch the Lua modding addon (Linux/macOS/Git-Bash)
bash scripts/fetch_addons.sh
#    ...or install "Lua GDExtension" from the Godot Asset Library in-editor.

# 3. Open the project in the Godot 4.6 .NET editor and press Play (F5).
#    Godot builds the C# assembly on first run.
```

> **No addon?** The game still runs. The modding system detects the missing
> addon, disables Lua mods, and the mod browser shows a notice. Movement,
> combat, and the C# systems are unaffected.

### Controls

| Key | Action |
| --- | --- |
| `A` / `D` | Move left / right |
| `Space` | Jump (hold for higher, tap for lower) |
| `J` | Attack |
| `K` | Dash (with brief invulnerability) |
| `M` | Toggle the mod browser (pauses the game) |
| `R` | Hot-reload all mods |

## Modding in 30 seconds

Create `user://mods/my_mod/` (the mod browser's *Open Mods Folder* button takes
you there) with a `mod.json` and a `main.lua`:

```json
{ "id": "my_mod", "name": "My Mod", "version": "1.0.0", "author": "you", "entry": "main.lua" }
```

```lua
-- main.lua — runs in a sandbox; only the global `game` table bridges to the engine.
game.register_enemy({
  id = "angry_cube", name = "Angry Cube",
  health = 40, speed = 55, damage = 12, color = "#ff5470",
  think = function(ctx)
    local dir = ctx.target_pos.x < ctx.self_pos.x and -1 or 1
    return { move_x = dir, jump = ctx.on_floor }
  end,
})
```

Press `R` in-game and your enemy spawns. Full API in **[docs/MODDING.md](docs/MODDING.md)**.

## Testing & CI

The pure C# core builds and tests with plain .NET — no engine required:

```bash
dotnet test tests/PixelForge.Tests/PixelForge.Tests.csproj
```

[GitHub Actions](.github/workflows/ci.yml) runs three jobs on every push:

1. **C# core** — build + xUnit tests (`DamageCalculator`, `AStarPathfinder`, `ModManifestValidator`).
2. **Lua lint** — `luacheck` over every mod.
3. **Godot import** — downloads Godot 4.6 (.NET) headless + the addon, builds the
   C# solution, and imports the project so any scene/script error fails the build.

## License

MIT © 2026 xj16. See [LICENSE](LICENSE).

The bundled modding runtime, [`lua-gdextension`](https://github.com/gilzoide/lua-gdextension),
is a separate MIT-licensed project by gilzoide and is downloaded at setup time,
not vendored here.
