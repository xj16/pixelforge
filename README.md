<h1 align="center">⚒️ PixelForge</h1>

<p align="center">
  <b>A Godot 4 action-platformer whose enemies, items, damage, and difficulty are all
  <i>sandboxed Lua mods</i> — hot-reloaded live, unable to freeze the game, and driven by a
  deterministic C#/.NET core.</b>
</p>

<p align="center">
  <a href="https://github.com/xj16/pixelforge/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/xj16/pixelforge/actions/workflows/ci.yml/badge.svg"></a>
  <a href="https://xj16.github.io/pixelforge/"><img alt="Live demo" src="https://img.shields.io/badge/live%20demo-play%20in%20browser-5bc9e6"></a>
  <img alt="JS runtime coverage" src="https://img.shields.io/badge/js%20runtime%20coverage-~94%25-3fb950">
  <img alt=".NET" src="https://img.shields.io/badge/core-.NET%208-512bd4">
  <img alt="Godot" src="https://img.shields.io/badge/engine-Godot%204.6%20.NET-478cbf">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-blue"></a>
</p>

<p align="center">
  <a href="https://xj16.github.io/pixelforge/"><b>▶ Try the live in-browser demo</b></a> — edit a Lua mod, hit reload,
  watch a new enemy spawn. No install.
</p>

---

## Why this exists

Most "moddable" indie games bolt scripting on late and end up handing mod authors
the whole engine — a security and stability nightmare. PixelForge is a compact,
opinionated reference for doing it **properly**:

- **Each mod gets its own sandboxed `LuaState`** with only a safe subset of the
  standard library — no `io`, `os`, `package`, or arbitrary engine
  singletons/classes. A misbehaving mod can't read your disk or crash a sibling.
- **Mods can't freeze the game.** Every mod call — load, `think`, event, hook —
  runs under an **instruction/wall-clock budget**. Paste a `while true do end`
  and the offending mod is aborted and disabled; the frame keeps ticking.
  ([try it in the demo](https://xj16.github.io/pixelforge/) — the 💣 button.)
- **Hot-reload is first-class.** Edit a `.lua`, hit *Reload* (or `R`), and the
  change is live — enemies re-spawn from the new definitions immediately.
- **The heavy lifting is deterministic C#.** Damage math, status effects, and A\*
  pathfinding are pure, seeded, and unit-tested on a plain .NET runner.

## See it move

The flagship system used to be invisible without a full Godot toolchain. Now the
entire runtime is ported to **dependency-free JavaScript** and runs in any
browser — the same Lua-subset sandbox, the same deterministic combat, running the
**exact bundled mods** from [`mods/`](mods/):

> **[xj16.github.io/pixelforge](https://xj16.github.io/pixelforge/)**

| In the demo you can… | which proves… |
| --- | --- |
| Edit `main.lua` and hit **Hot-reload** | live sandboxed hot-reload |
| Toggle a mod off in the browser | per-mod registration ownership |
| Press **💣 Inject infinite loop** | the sandbox CPU budget (game survives) |
| **Record** a run, then **Replay** it | the deterministic seeded RNG |

> The native Godot **web export can't run the mod layer** — `lua-gdextension` is a
> native GDExtension with no web build — so the browser demo ships a faithful
> pure-JS twin of the runtime instead of faking it. The desktop game uses the
> real addon; the two share the same rules (validated by the same tests).

## Features

| Area | What's implemented |
| --- | --- |
| **Platforming** | `CharacterBody2D` player with coyote time, jump buffering, variable jump height, an i-frame dash, and a melee hitbox. |
| **Enemies** | Data-driven archetypes. Walkers path with C# A\*; flyers home in. AI can be delegated to a mod-supplied Lua `think(ctx)` brain. |
| **Combat (C#)** | Deterministic, seeded damage: crits, armor, elemental scale, resistances, variance — reproducible for replays. |
| **Status effects (C#)** | Stacking frost **slow** and fire **burn** DoT, ticked deterministically and driven by elements/mods. |
| **Pathfinding (C#)** | 8-connected A\* with a binary min-heap, no diagonal corner-cutting, a "must stand on ground" rule for walkers, and **allocation-free re-planning** (pooled buffers + generational stamp). |
| **Lua modding** | Sandboxed per-mod `LuaState`; register enemies, items, damage elements, and **on-hit status**; subscribe to events; tweak config; lifecycle hooks. |
| **Sandbox budget** | Per-call instruction/wall-clock cap — a runaway mod is aborted and disabled, never hangs the frame. |
| **Replay** | Records seed + input stream; replays a run against the same seed for a byte-identical combat outcome. |
| **Mod browser** | In-game UI (`M`): every discovered mod with metadata, live registration counts, load errors, per-mod enable/disable, hot-reload. |
| **Sample mods** | Three real, documented example mods under [`mods/`](mods/). |

## Architecture

```
                 ┌───────────────────────────── Godot 4.6 (.NET) game ─────────────────────────────┐
   Lua mods  ──▶ │  ModLoader.gd  ──sandbox+budget──▶  per-mod LuaState                            │
 (user://mods)   │      │  (lua-gdextension)                 │  only bridge: the curated `game`     │
                 │      ▼                                     ▼        table (ModApi.gd)             │
                 │  ModApi.gd  ──registers──▶  enemy/item/element/status registries                 │
                 │      │                                                                            │
                 │  World.gd / Enemy.gd / Player.gd  ──call──▶  C# node adapters                     │
                 │                                             (CombatResolver, NavGrid)             │
                 └───────────────────────────────────────────────│──────────────────────────────────┘
                                                                  ▼
                          PixelForge.Core  (pure, Godot-free, unit-tested in CI)
                          DamageCalculator · StatusEngine · AStarPathfinder ·
                          DeterministicRng · ReplayRecorder · ModManifestValidator
                                                                  ▲
                 demo/engine/*.js  ── a dependency-free JS twin of the entire runtime ──┘
                 (lua-lite interpreter + the same math) powers the in-browser live demo
```

The pure algorithms live in **`PixelForge.Core`** (no Godot reference) so they are
fast to build and unit-tested on a plain .NET runner. Thin Godot nodes
(`CombatResolver`, `NavGrid`) marshal to/from engine types. The **`demo/engine/`**
JavaScript port mirrors the same rules, so the browser demo and the game agree on
every deterministic value — and both are covered by tests.

## Quickstart

### Play in the browser (0 installs)

Open **[xj16.github.io/pixelforge](https://xj16.github.io/pixelforge/)**, or serve
it locally:

```bash
git clone https://github.com/xj16/pixelforge.git
cd pixelforge
python -m http.server 4178 --directory demo   # then open http://localhost:4178
```

### Run the desktop game

**Requirements:** [Godot 4.6 **.NET** edition](https://godotengine.org/download) + the .NET 8 SDK.

```bash
bash scripts/fetch_addons.sh      # fetch the lua-gdextension modding addon
# ...or install "Lua GDExtension" from the Godot Asset Library in-editor.
# Open the project in the Godot 4.6 .NET editor and press Play (F5).
```

> **No addon?** The game still runs — the mod system detects the missing addon,
> disables Lua mods, and the browser shows a notice. Movement, combat, and the C#
> systems are unaffected.

### Controls

| Key | Action | | Key | Action |
| --- | --- | --- | --- | --- |
| `A` / `D` | Move | | `K` | Dash (i-frames) |
| `Space` | Jump (variable height) | | `M` | Toggle mod browser |
| `J` | Attack | | `R` | Hot-reload all mods |

## Modding in 30 seconds

Create `user://mods/my_mod/` with a `mod.json` and a `main.lua`:

```json
{ "id": "my_mod", "name": "My Mod", "version": "1.0.0", "author": "you", "entry": "main.lua" }
```

```lua
-- runs in a sandbox with a CPU budget; only the global `game` table bridges out.
game.register_enemy({
  id = "angry_cube", name = "Angry Cube",
  health = 40, speed = 70, damage = 12, color = "#ff5470",
  think = function(ctx)
    local dir = ctx.target_pos.x < ctx.self_pos.x and -1 or 1
    return { move_x = dir, jump = ctx.on_floor }
  end,
})
game.register_status("frost", { kind = "slow", magnitude = 0.4, duration = 2.0 })
```

Press `R` in-game (or in the demo) and your enemy spawns. Full API in
**[docs/MODDING.md](docs/MODDING.md)**.

## Testing & CI

```bash
# Pure C# core — no engine required:
dotnet test tests/PixelForge.Tests/PixelForge.Tests.csproj

# The modding runtime end-to-end (Node ≥ 20) — the flagship suite:
npm test
```

[GitHub Actions](.github/workflows/ci.yml) runs on every push:

1. **C# core** — build + xUnit (`DamageCalculator`, `StatusEngine`, `AStarPathfinder`, `ReplayRecorder`, `ModManifestValidator`) with Coverlet coverage.
2. **JS modding runtime** — the Node suite that actually *executes* the sandbox: loads the real mods, runs `think` brains, and asserts the budget kills a runaway mod. ~94% line coverage; fails if the inlined mods are stale.
3. **Lua lint** — `luacheck` over every mod.
4. **Godot import** — headless Godot 4.6 (.NET) import so any scene/script error fails the build.

A separate [`pages.yml`](.github/workflows/pages.yml) workflow publishes the live
demo to GitHub Pages.

## Project layout

```
pixelforge/
├── project.godot                 # autoloads, input map, C# feature
├── scenes/  src/                 # game scenes + GDScript (entities, UI, modding, systems)
├── csharp/                       # Godot node adapters: CombatResolver, NavGrid
├── core-lib/PixelForge.Core/     # pure, Godot-free: DamageCalculator, StatusEngine,
│                                 #   AStarPathfinder, DeterministicRng, ReplayRecorder, ModManifestValidator
├── tests/PixelForge.Tests/       # xUnit tests for the core
├── tests/js/                     # Node tests over the modding runtime (flagship)
├── demo/                         # dependency-free in-browser live demo (the JS twin)
│   └── engine/                   # lua-lite interpreter + JS ports of the core
├── mods/                         # bundled example mods (frost_slime, healing_orb, hard_mode)
└── docs/MODDING.md               # full modding API reference
```

## License

MIT © 2026 xj16. See [LICENSE](LICENSE).

The desktop modding runtime, [`lua-gdextension`](https://github.com/gilzoide/lua-gdextension),
is a separate MIT-licensed project by gilzoide, downloaded at setup time — not vendored here.
