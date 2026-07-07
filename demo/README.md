# PixelForge — live in-browser demo

A **dependency-free** JavaScript twin of PixelForge's sandboxed Lua modding
runtime. It runs the **real bundled mods** from [`../mods`](../mods) unchanged, on
a `<canvas>` game, with a live Lua editor and hot-reload — no Godot, no install,
no build step, no server dependency.

Open `index.html` through any static server:

```bash
python -m http.server 4178 --directory .   # then http://localhost:4178
```

## Why a JS twin instead of a Godot web export?

The desktop game's Lua runtime is [`lua-gdextension`](https://github.com/gilzoide/lua-gdextension),
a **native GDExtension**. It has no WebAssembly build, so the mod layer — the
whole point of the project — can't run in a Godot HTML5 export. Rather than fake a
demo, `demo/engine/` re-implements the runtime in pure JS:

| File | Mirrors |
| --- | --- |
| `engine/lua-lite.js` | the sandboxed `LuaState` (a Lua-5.4-subset interpreter **with an instruction budget**) |
| `engine/runtime.js` + `loader.js` | `src/modding/ModApi.gd` + `ModLoader.gd` |
| `engine/damage.js` · `status.js` · `astar.js` · `rng.js` · `manifest.js` · `replay.js` | `PixelForge.Core.*` |
| `engine/game-engine.js` | `World.gd` + `Enemy.gd` + `Player.gd` |

The ports are line-for-line faithful and covered by [`../tests/js`](../tests/js),
so the demo and the desktop game agree on every deterministic value.

## Keeping the bundled mods in sync

`engine/mods.generated.js` inlines the real `mods/*/mod.json` + `main.lua`. It is
generated — never hand-edit it. After changing anything under `mods/`:

```bash
npm run gen:mods    # or: node demo/build/gen-mods.mjs
```

CI fails if this file is stale.
