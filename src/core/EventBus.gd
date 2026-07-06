extends Node
## Decoupled, game-wide signal hub.
##
## Autoloaded as `EventBus`. Gameplay systems and mods communicate through
## these signals instead of holding hard references to each other. Mods
## subscribe by name through `ModApi.on(event_name, lua_callback)`.

## Emitted after a mod-visible game event fires. `data` is a Dictionary so it
## can be handed to Lua as a table without translating custom classes.
signal game_event(event_name: String, data: Dictionary)

# --- Strongly typed convenience signals used by native GDScript systems ---
signal player_spawned(player: Node)
signal player_damaged(amount: int, current_health: int)
signal player_died
signal enemy_spawned(enemy: Node)
signal enemy_killed(enemy_id: String, position: Vector2)
signal item_collected(item_id: String)
signal mods_reloaded(active_mod_ids: PackedStringArray)

## Fire a mod-visible event. Native code should call this (in addition to any
## typed signal) so subscribed mods are notified. `data` must contain only
## Variant-compatible values (numbers, strings, bools, Vector2, Dictionaries).
func emit_game_event(event_name: String, data: Dictionary = {}) -> void:
	game_event.emit(event_name, data)
