# PixelForge Modding Guide

PixelForge mods are small Lua packages that add enemies, items, and rules to the
game. Every mod runs in its **own sandboxed `LuaState`** and reaches the engine
only through a single injected global table: **`game`**.

- [Where mods live](#where-mods-live)
- [Anatomy of a mod](#anatomy-of-a-mod)
- [The sandbox](#the-sandbox)
- [The `game` API](#the-game-api)
- [Contexts & data types](#contexts--data-types)
- [Hot-reload lifecycle](#hot-reload-lifecycle)
- [Debugging](#debugging)

---

## Where mods live

| Location | Purpose | Writable |
| --- | --- | --- |
| `res://mods/` | Mods that ship with the game (the bundled examples). | No (read-only at runtime) |
| `user://mods/` | Community mods you install. Created on first launch. | Yes |

The mod browser's **Open Mods Folder** button opens `user://mods/` in your file
manager. On desktop that resolves to a per-user app-data directory (e.g.
`%APPDATA%\Godot\app_userdata\PixelForge\mods` on Windows).

## Anatomy of a mod

A mod is a folder containing at least a manifest and an entry script:

```
my_mod/
├── mod.json     # required manifest
└── main.lua     # required entry script (name set by "entry")
```

### `mod.json`

```json
{
  "id": "my_mod",
  "name": "My Mod",
  "version": "1.0.0",
  "author": "your name",
  "description": "What this mod does.",
  "entry": "main.lua",
  "api_requires": ["enemy", "item"]
}
```

| Field | Required | Notes |
| --- | --- | --- |
| `id` | ✅ | Lowercase slug `[a-z0-9_-]`, ≤ 64 chars. Must be unique; later mods override earlier ones on a clash. |
| `name` | ✅ | Human-readable display name. |
| `version` | | Semver-ish string. Defaults to `0.0.0`. |
| `author` | | Shown in the mod browser. |
| `description` | | Shown in the mod browser. |
| `entry` | | Bare `.lua` filename inside the mod folder. Defaults to `main.lua`. Path separators and `..` are rejected. |
| `api_requires` | | Informational list of API areas the mod uses. |

The same validation rules are implemented (and unit-tested) in
`PixelForge.Core.ModManifestValidator`.

## The sandbox

Each mod's `LuaState` opens **only** this library subset:

- **Lua stdlib:** `base`, `table`, `string`, `math`, `coroutine`, `utf8`
- **Godot data helpers:** Variant construction (`Vector2`, `Color`, …), utility
  functions (`lerp`, `deg_to_rad`, …), and global enums.

Deliberately **not** available: `io`, `os`, `package`/`require`, `debug`, the
LuaJIT `ffi`, and Godot singletons/classes/local-path loaders. A mod therefore
**cannot** read or write files, run processes, load native code, or grab
arbitrary engine objects. Everything it can affect goes through `game.*`.

## The `game` API

> In Lua, call methods on values with `:` but call these top-level `game`
> functions with `.` — e.g. `game.log("hi")`.

### Logging

```lua
game.log(message)    -- prints "[mod:<id>] message"
game.warn(message)   -- push_warning with the same prefix
```

### Registering an enemy

```lua
local id = game.register_enemy({
  id       = "frost_slime",   -- required, unique
  name     = "Frost Slime",   -- display name
  health   = 30,              -- default 20
  speed    = 40,              -- pixels/sec, default 40
  damage   = 10,              -- contact damage, default 8
  element  = "frost",         -- damage element, default "physical"
  color    = "#5bc9e6",       -- hex string or Color, default white
  fly      = false,           -- true = flyer (ignores gravity & ground rule)
  think    = function(ctx) ... end,  -- optional Lua AI brain, see below
})
```

If `think` is omitted, the enemy uses the built-in chase AI (C# A\* pathing for
walkers, direct homing for flyers).

### Registering an item

```lua
game.register_item({
  id    = "healing_orb",
  name  = "Healing Orb",
  color = "#66e08a",
  on_collect = function(player_state)
    -- player_state = { health = <int>, max_health = <int> } (read-only)
    return { heal = 25, message = "Healed!" }   -- effects table, all keys optional
  end,
})
```

`on_collect` returns an **effects table**. Supported keys:

| Key | Effect |
| --- | --- |
| `heal` | Integer HP restored to the player. |
| `message` | String flashed on the HUD. |

### Damage elements

```lua
game.register_element("frost", 1.25)  -- new/overridden global damage multiplier
```

Registered elements feed the C# `CombatResolver`, so any attack using that
element is scaled accordingly.

### Config tweaks

```lua
game.set_config("enemy_damage_scale", 1.5)   -- float
game.set_config("enemy_health_scale", 1.35)  -- float
game.set_config("player_max_health", 120)    -- int
local v = game.get_config("enemy_damage_scale")
```

### Events

```lua
game.on("player_damaged", function(event_name, data) ... end)
game.emit("mod_message", { text = "Hello from my mod!" })
```

Built-in event names you can subscribe to:

| Event | `data` fields |
| --- | --- |
| `player_dashed` | `facing` |
| `player_attacked` | `facing` |
| `player_damaged` | `amount`, `health` |
| `player_healed` | `amount`, `health` |
| `player_died` | `position` |
| `enemy_killed` | `enemy_id`, `position` |
| `item_collected` | `item_id` |
| `mod_message` | `text` (consumed by the HUD) |

### Lifecycle hooks

```lua
game.set_hook("on_load",   function() ... end)  -- after the script runs
game.set_hook("on_unload", function() ... end)  -- just before a hot-reload
```

### Constants

```lua
game.mod_id    -- this mod's id (string)
game.version   -- game version (string)
```

## Contexts & data types

### Enemy `think(ctx)`

Called on each AI tick (~every 0.15 s). Receives:

| `ctx` field | Type | Meaning |
| --- | --- | --- |
| `self_pos` | `Vector2` | This enemy's world position. |
| `target_pos` | `Vector2` | The player's world position. |
| `distance` | number | Distance between them. |
| `on_floor` | boolean | Whether the enemy is grounded. |
| `health` | number | Current HP. |
| `state` | table | Persistent scratch space you own across ticks. |

Return an **action table**:

| Key | Type | Effect |
| --- | --- | --- |
| `move_x` | number | Horizontal intent, clamped to `-1..1`, scaled by `speed`. |
| `move_y` | number | Vertical intent (flyers only). |
| `jump` | boolean | Request a hop (walkers, only when `on_floor`). |
| `state` | table | Persisted back to you next tick. |

`Vector2` and `Color` are real Godot values inside the sandbox — use `ctx.self_pos.x`,
`Vector2(1, 0)`, etc.

## Hot-reload lifecycle

1. `ModLoader` scans `res://mods` then `user://mods`.
2. For each mod it validates `mod.json`, spins up a fresh sandbox, injects
   `game`, and runs the entry script.
3. Registrations are tracked per mod id.
4. On **Reload** (`R` / mod-browser button), every sandbox's `on_unload` runs,
   all registrations are forgotten, and step 1 repeats. The world then re-spawns
   from the new definitions.

Because state is per-mod and torn down cleanly, reloads are safe at runtime.

## Debugging

- `game.log` / `game.warn` output appears in Godot's **Output** panel, prefixed
  with your mod id.
- Syntax or runtime errors during load are shown **inline in the mod browser**
  for that mod, and the mod is left disabled rather than crashing the game.
- Run `luacheck mods` locally (same check CI runs) to catch mistakes early.

See the three bundled examples under [`mods/`](../mods) for complete, working
references: `example_frost_slime` (custom AI + element), `example_healing_orb`
(item + `on_collect`), and `example_hard_mode` (config + events).
