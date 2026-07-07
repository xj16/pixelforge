# Changelog

All notable changes to PixelForge are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-07-07

This release closes the gaps between the pitch and the code: the sandboxed Lua
modding layer is now **executed and tested end-to-end in CI**, it enforces a real
**CPU budget** so a runaway mod can't freeze the game, and there is a **live,
dependency-free in-browser demo** so a reviewer can feel the whole thing in ten
seconds without installing Godot.

### Added

- **Sandbox execution budget (the missing security guarantee).** Each mod's
  `LuaState` now runs under a wall-clock budget enforced by an instruction-count
  debug hook installed by a privileged preamble; the preamble then deletes the
  `debug` library and the timing hook from the sandbox so a mod can neither see
  nor disable them. A `while true do end` in a mod's `on_load`, `think`, or any
  event/hook is aborted, the mod is disabled, and the error surfaces in the mod
  browser — the game keeps running. (`src/modding/ModLoader.gd`, `ModApi.gd`)
- **Live in-browser modding demo** under [`demo/`](demo/): a dependency-free
  JavaScript twin of the whole runtime — a small Lua-5.4-subset interpreter, the
  deterministic RNG, damage math, status engine, and A\* — that runs the **real
  bundled mods unchanged** on a `<canvas>` game with a hand-authored cave level,
  a live Lua editor, a hot-reload button, and a "💣 inject infinite loop" button
  that proves the sandbox survives. This is the portfolio's live demo; the native
  Godot web export can't run the mod layer because `lua-gdextension` is a native
  GDExtension, so the pure-JS twin is the honest browser story.
- **Status effects** (`PixelForge.Core.StatusEngine`): stacking frost **slow**
  and fire **burn** DoT, driven by elements and mods, ticked deterministically.
  Wired through `CombatResolver`, `World.gd`, and `Enemy.gd` so a struck
  frost enemy visibly chills and crawls. New `game.register_status{…}` mod API.
- **Deterministic replay recorder** (`PixelForge.Core.ReplayRecorder` +
  `demo/engine/replay.js`): records the startup seed and a delta-compressed input
  stream, serializes to a compact text format, and replays it. The demo's
  "▶ Replay last run" re-runs your inputs against the same seed — proving the
  seeded RNG the README always claimed.
- **Flagship tests.** A Node test suite (`tests/js/`) drives the modding runtime
  end-to-end: loads the three bundled mods, asserts their archetypes/items/status
  register, calls a `think` brain and checks the action shape, toggles a mod off
  and asserts its registrations are forgotten, and feeds a path-traversal /
  infinite-loop mod and asserts it is rejected/killed. New C# xUnit suites cover
  `StatusEngine`, `ReplayRecorder`, and a **golden test** that runs every bundled
  `mod.json` through the C# `ModManifestValidator`.
- **Coverage + CI jobs.** The C# job now collects Coverlet coverage; a new
  `js-runtime` CI job runs the Node suite (~94% line coverage of the JS runtime)
  and fails if the inlined mods are stale. A `pages.yml` workflow publishes the
  static demo to GitHub Pages.

### Changed

- **A\* is now allocation-free on re-plan.** `AStarPathfinder` reuses its
  `gScore`/`cameFrom`/heap buffers across searches via a generational "visited"
  stamp instead of allocating several full-grid arrays per call — the game
  re-plans every ~0.15 s per grounded enemy, so this removes steady-state GC
  pressure. Same results; added regression tests for repeated/interleaved plans.
- Player strikes now carry the enemy archetype's element, so a mod-registered
  status is applied on hit.
- Bumped project version `0.1.0 → 1.0.0`.

### Security

- Mods can no longer hang the frame (instruction/wall-clock budget, above).
- The sandbox opens `LUA_DEBUG` **only** to install the budget hook, then strips
  it — the library set a mod actually sees is unchanged.

[1.0.0]: https://github.com/xj16/pixelforge/releases/tag/v1.0.0
