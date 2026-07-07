extends Node
## The curated, sandbox-safe API surface exposed to Lua mods.
##
## Autoloaded as `ModApi`. `ModLoader` calls `install(lua_state, mod_id)` for
## each mod's sandbox, which injects a global Lua table named `game`. Mods only
## ever touch the engine through the callables registered here — they never get
## a raw reference to a Node, the SceneTree, or the filesystem.
##
## Everything a mod registers is tracked per mod id so a hot-reload can forget
## the old registrations before the new script runs.

## A mod-registered enemy archetype. The game reads these when spawning.
class EnemyArchetype:
	var id: String
	var mod_id: String
	var display_name: String
	var max_health: int = 20
	var speed: float = 40.0
	var contact_damage: int = 8
	var color: Color = Color.WHITE
	var can_fly: bool = false
	var element: String = "physical"
	var think: Object          # optional LuaFunction: think(self_state, ctx) -> action dict

## A mod-registered collectible item.
class ItemDef:
	var id: String
	var mod_id: String
	var display_name: String
	var color: Color = Color.YELLOW
	var on_collect: Object      # optional LuaFunction: on_collect(player_state)

# Registries keyed by id. Mods that share an id override in load order.
var enemy_archetypes: Dictionary = {}   # id -> EnemyArchetype
var item_defs: Dictionary = {}          # id -> ItemDef
var _event_handlers: Dictionary = {}    # event_name -> Array[ {mod_id, fn} ]
var _mod_hooks: Dictionary = {}         # mod_id -> { hook_name: LuaFunction }
var _ownership: Dictionary = {}         # mod_id -> { enemies:[], items:[] }

func _ready() -> void:
	# Relay engine events into subscribed mods.
	EventBus.game_event.connect(_dispatch_event)

## Install the `game` table into a mod's sandboxed LuaState.
func install(lua: Object, mod_id: String) -> void:
	_ownership[mod_id] = {"enemies": [], "items": []}
	var g = lua.globals
	# Build the `game` table from GDScript. Values may be Callables (bridged to
	# Lua functions by lua-gdextension) or plain data.
	var api := {
		"mod_id": mod_id,

		# Logging -----------------------------------------------------------
		"log": func(msg): print("[mod:%s] %s" % [mod_id, str(msg)]),
		"warn": func(msg): push_warning("[mod:%s] %s" % [mod_id, str(msg)]),

		# Registration ------------------------------------------------------
		"register_enemy": func(spec): return _register_enemy(mod_id, spec),
		"register_item": func(spec): return _register_item(mod_id, spec),
		"register_element": func(name, scale): _register_element(name, scale),
		"register_status": func(element, spec): _register_status(mod_id, element, spec),

		# Config tweaks -----------------------------------------------------
		"set_config": func(key, value): _set_config(mod_id, key, value),
		"get_config": func(key): return _get_config(key),

		# Events ------------------------------------------------------------
		"on": func(event_name, fn): _subscribe(mod_id, str(event_name), fn),
		"emit": func(event_name, data): EventBus.emit_game_event(str(event_name), _as_dict(data)),

		# Lifecycle hooks the mod may define; ModLoader invokes them.
		"set_hook": func(hook_name, fn): _set_hook(mod_id, str(hook_name), fn),

		# Read-only constants a mod can reference.
		"version": ProjectSettings.get_setting("application/config/version", "0.0.0"),
	}
	# Build a proper LuaTable from the dictionary (this bridges the Callables to
	# Lua functions) and expose it as the global `game`.
	if lua.has_method("create_table"):
		g["game"] = lua.create_table(api)
	else:
		g["game"] = api

## Forget everything a mod registered (called before reload / on unload).
func forget_mod(mod_id: String) -> void:
	var owned: Dictionary = _ownership.get(mod_id, {})
	for eid in owned.get("enemies", []):
		enemy_archetypes.erase(eid)
	for iid in owned.get("items", []):
		item_defs.erase(iid)
	_ownership.erase(mod_id)
	_mod_hooks.erase(mod_id)
	for event_name in _event_handlers.keys():
		var handlers: Array = _event_handlers[event_name]
		handlers = handlers.filter(func(h): return h["mod_id"] != mod_id)
		_event_handlers[event_name] = handlers

## Invoke a named lifecycle hook (on_load / on_unload) if the mod set one.
## `mod_id` identifies which sandbox's hook to run.
func invoke_mod_hook_for(mod_id: String, hook_name: String) -> void:
	var hooks: Dictionary = _mod_hooks.get(mod_id, {})
	if hooks.has(hook_name):
		_call_lua(hooks[hook_name], [])

# --- Registration internals ------------------------------------------------

func _register_enemy(mod_id: String, spec) -> String:
	var d := _as_dict(spec)
	var arch := EnemyArchetype.new()
	arch.mod_id = mod_id
	arch.id = str(d.get("id", ""))
	if arch.id.is_empty():
		push_error("[ModApi] register_enemy requires an 'id'")
		return ""
	arch.display_name = str(d.get("name", arch.id))
	arch.max_health = int(d.get("health", 20))
	arch.speed = float(d.get("speed", 40.0))
	arch.contact_damage = int(d.get("damage", 8))
	arch.can_fly = bool(d.get("fly", false))
	arch.element = str(d.get("element", "physical"))
	arch.color = _as_color(d.get("color", "#ffffff"))
	arch.think = d.get("think", null)
	enemy_archetypes[arch.id] = arch
	_ownership[mod_id]["enemies"].append(arch.id)
	return arch.id

func _register_item(mod_id: String, spec) -> String:
	var d := _as_dict(spec)
	var item := ItemDef.new()
	item.mod_id = mod_id
	item.id = str(d.get("id", ""))
	if item.id.is_empty():
		push_error("[ModApi] register_item requires an 'id'")
		return ""
	item.display_name = str(d.get("name", item.id))
	item.color = _as_color(d.get("color", "#ffd24a"))
	item.on_collect = d.get("on_collect", null)
	item_defs[item.id] = item
	_ownership[mod_id]["items"].append(item.id)
	return item.id

func _register_element(name, scale) -> void:
	var world := get_tree().get_first_node_in_group("world")
	if world != null and world.has_method("set_element_scale"):
		world.set_element_scale(str(name), float(scale))

## Register the on-hit status an element carries. `spec` is a table:
##   { kind = "slow"|"burn", magnitude = <float>, duration = <float>, interval = <float> }
## Slow magnitude is a 0..1 speed reduction; burn magnitude is damage per tick.
func _register_status(mod_id: String, element, spec) -> void:
	var world := get_tree().get_first_node_in_group("world")
	if world == null or not world.has_method("set_element_status"):
		return
	var d := _as_dict(spec)
	var kind := str(d.get("kind", "slow"))
	var magnitude := float(d.get("magnitude", 0.0))
	var duration := float(d.get("duration", 2.0))
	var interval := float(d.get("interval", 0.5))
	world.set_element_status(str(element), kind, magnitude, duration, interval)

func _set_config(mod_id: String, key, value) -> void:
	var k := str(key)
	match k:
		"enemy_damage_scale":
			GameConfig.enemy_damage_scale = float(value)
		"enemy_health_scale":
			GameConfig.enemy_health_scale = float(value)
		"player_max_health":
			GameConfig.player_max_health = int(value)
		_:
			push_warning("[ModApi] mod '%s' set unknown config key '%s'" % [mod_id, k])

func _get_config(key):
	match str(key):
		"enemy_damage_scale": return GameConfig.enemy_damage_scale
		"enemy_health_scale": return GameConfig.enemy_health_scale
		"player_max_health": return GameConfig.player_max_health
		_: return null

func _set_hook(mod_id: String, hook_name: String, fn) -> void:
	if not _mod_hooks.has(mod_id):
		_mod_hooks[mod_id] = {}
	_mod_hooks[mod_id][hook_name] = fn

func _subscribe(mod_id: String, event_name: String, fn) -> void:
	if not _event_handlers.has(event_name):
		_event_handlers[event_name] = []
	_event_handlers[event_name].append({"mod_id": mod_id, "fn": fn})

func _dispatch_event(event_name: String, data: Dictionary) -> void:
	var handlers: Array = _event_handlers.get(event_name, [])
	for h in handlers:
		_call_lua(h["fn"], [event_name, data])

# --- Lua/GDScript marshalling helpers --------------------------------------

## Call a bridged Lua function (LuaFunction) or a plain Callable, tolerating a
## missing addon by no-op'ing. lua-gdextension's LuaFunction exposes `invokev`
## (array form) and `invoke` (vararg); we use `invokev`.
##
## Every Lua-side call is wrapped in the sandbox execution budget so a runaway
## `think`/hook/event handler aborts instead of freezing the frame. The budget
## is armed on the owning LuaState before the call and disarmed after.
func _call_lua(fn, args: Array) -> Variant:
	if fn == null:
		return null
	if fn is Callable:
		return fn.callv(args)
	if fn is Object and is_instance_valid(fn):
		var lua = _lua_state_of(fn)
		if lua != null:
			ModLoader.arm_budget(lua)
		var out: Variant = null
		if fn.has_method("invokev"):
			out = fn.invokev(args)
		elif fn.has_method("invoke"):
			out = fn.callv("invoke", args)
		if lua != null:
			ModLoader.disarm_budget(lua)
		return out
	return null

## Best-effort lookup of the LuaState that owns a bridged LuaFunction so we can
## arm its execution budget. lua-gdextension exposes it as `lua_state`.
func _lua_state_of(fn) -> Object:
	if fn is Object and is_instance_valid(fn):
		if "lua_state" in fn:
			return fn.lua_state
		if fn.has_method("get_lua_state"):
			return fn.get_lua_state()
	return null

## Coerce a Lua table (LuaTable) or Dictionary into a plain Dictionary.
func _as_dict(value) -> Dictionary:
	if value is Dictionary:
		return value
	if value is Object and is_instance_valid(value) and value.has_method("to_dictionary"):
		return value.to_dictionary()
	return {}

func _as_color(value) -> Color:
	if value is Color:
		return value
	if value is String:
		return Color.from_string(value, Color.WHITE)
	return Color.WHITE
