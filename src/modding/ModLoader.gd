extends Node
## Discovers, validates, sandboxes, and hot-reloads community Lua mods.
##
## Autoloaded as `ModLoader`. Each mod gets its OWN sandboxed `LuaState`
## (from the `lua-gdextension` addon) so a misbehaving mod cannot reach into
## the engine or another mod. The only bridge a mod is given is the curated
## `ModApi` surface, injected as a Lua global table called `game`.
##
## A mod folder must contain a `mod.json` manifest and a Lua entry script.
## See docs/MODDING.md for the full format and the sample mods under `mods/`.

## One loaded mod: its manifest metadata plus its live sandboxed state.
class Mod:
	var id: String
	var name: String
	var version: String
	var author: String
	var description: String
	var entry: String
	var dir: String            # absolute res:// or user:// path to the mod folder
	var source: String         # "builtin" or "user"
	var enabled: bool = true
	var lua_state: Object       # LuaState, or null when the addon is absent
	var error: String = ""     # non-empty if the mod failed to load

	func to_dict() -> Dictionary:
		return {
			"id": id, "name": name, "version": version, "author": author,
			"description": description, "source": source, "enabled": enabled,
			"error": error,
		}

var mods: Array[Mod] = []
## True when the lua-gdextension addon is installed and `LuaState` is available.
## The game runs fine without it — mods are simply skipped and reported.
var lua_available: bool = false
## Mod ids the player has explicitly disabled. Persists across reloads so a
## toggle in the mod browser sticks (fresh Mod objects default to enabled).
var _disabled_ids: Dictionary = {}

## The sandbox library bitfield handed to `LuaState.open_libraries`.
##
## These are the bit values of lua-gdextension's `LuaState.Library` enum. We
## deliberately open ONLY the safe subset:
##   LUA_BASE(1<<0) TABLE(1<<6) STRING(1<<3) MATH(1<<5) COROUTINE(1<<2) UTF8(1<<12)
## plus the Godot data helpers a mod legitimately needs:
##   GODOT_VARIANT(1<<13) GODOT_UTILITY_FUNCTIONS(1<<14) GODOT_ENUMS(1<<17)
##
## We intentionally OMIT LUA_IO, LUA_OS, LUA_PACKAGE, LUA_FFI,
## GODOT_SINGLETONS, GODOT_CLASSES and GODOT_LOCAL_PATHS so a mod cannot read the
## filesystem, spawn processes, load native modules, or grab arbitrary engine
## singletons/classes. This is the security boundary of the modding sandbox.
##
## LUA_DEBUG(1<<7) IS opened, but ONLY so our privileged budget preamble can
## install an instruction-count hook (see BUDGET_PREAMBLE). The preamble then
## deletes the `debug` table from the sandbox globals, so a mod can neither see
## it nor clear its own hook — it just pays the CPU budget we set.
const SANDBOX_LIBRARIES: int = (
	(1 << 0)   # LUA_BASE
	| (1 << 6) # LUA_TABLE
	| (1 << 3) # LUA_STRING
	| (1 << 5) # LUA_MATH
	| (1 << 2) # LUA_COROUTINE
	| (1 << 7) # LUA_DEBUG (consumed by the budget preamble, then removed)
	| (1 << 12) # LUA_UTF8
	| (1 << 13) # GODOT_VARIANT
	| (1 << 14) # GODOT_UTILITY_FUNCTIONS
	| (1 << 17) # GODOT_ENUMS
)

## Per-call wall-clock budget in milliseconds. A mod chunk (load, `think`, or a
## hook) that runs longer than this is aborted with an error instead of freezing
## the frame. 250ms is generous for real work yet a `while true do end` trips it
## almost immediately (the hook fires every 1000 VM instructions).
const CALL_BUDGET_MS: int = 250

## Privileged Lua preamble prepended to every mod's entry chunk. It installs an
## instruction-count debug hook that, every 1000 VM instructions, asks the
## engine (via the injected `__pf_deadline` callable) whether this call's
## wall-clock budget is spent and errors if so. It then captures the callable
## into the hook's closure and DELETES both `debug` and `__pf_deadline` from the
## sandbox, so a mod can neither disable the hook nor reach the timing callable.
## GDScript re-arms the deadline before every guarded call — see arm_budget().
const BUDGET_PREAMBLE: String = """
do
	local dbg = rawget(_G, "debug")
	local deadline = rawget(_G, "__pf_deadline")
	-- Only arm the guard when both facilities are present; otherwise degrade to
	-- an unguarded (but still library-restricted) sandbox rather than failing.
	if type(dbg) == "table" and type(dbg.sethook) == "function" and type(deadline) == "function" then
		local sethook = dbg.sethook
		local function guard()
			if deadline() then
				error("execution budget exceeded (possible infinite loop) -- mod aborted", 2)
			end
		end
		sethook(guard, "", 1000)
	end
	-- Slam the sandbox door: the mod must never see debug or the timing hook.
	debug = nil
	_G.debug = nil
	__pf_deadline = nil
	_G.__pf_deadline = nil
end
"""

func _ready() -> void:
	lua_available = ClassDB.class_exists("LuaState")
	_ensure_user_mods_dir()
	if not lua_available:
		push_warning("[ModLoader] lua-gdextension not installed; mods disabled. "
			+ "Install the addon to enable Lua modding.")

## (Re)scan all mod directories and load every enabled, valid mod.
## Safe to call at any time — existing states are torn down first, giving
## a true hot-reload when the player edits a mod on disk.
func reload_all() -> void:
	_unload_all()
	mods.clear()

	var discovered := _discover(GameConfig.BUILTIN_MODS_DIR, "builtin")
	discovered.append_array(_discover(GameConfig.USER_MODS_DIR, "user"))

	for mod in discovered:
		# Apply any persisted disable so a browser toggle survives the reload.
		if _disabled_ids.has(mod.id):
			mod.enabled = false
		mods.append(mod)
		if mod.enabled and mod.error.is_empty():
			_load_mod(mod)

	var active := PackedStringArray()
	for mod in mods:
		if mod.enabled and mod.error.is_empty():
			active.append(mod.id)
	EventBus.mods_reloaded.emit(active)
	print("[ModLoader] Reloaded. Active mods: ", active)

## Toggle a mod on/off by id and hot-reload so the change takes effect now.
## The choice is remembered across reloads (see `_disabled_ids`).
func set_mod_enabled(id: String, enabled: bool) -> void:
	if enabled:
		_disabled_ids.erase(id)
	else:
		_disabled_ids[id] = true
	reload_all()

func get_mod(id: String) -> Mod:
	for mod in mods:
		if mod.id == id:
			return mod
	return null

# --- Discovery -------------------------------------------------------------

func _discover(root: String, source: String) -> Array[Mod]:
	var found: Array[Mod] = []
	if not DirAccess.dir_exists_absolute(root):
		return found
	var dir := DirAccess.open(root)
	if dir == null:
		return found
	dir.list_dir_begin()
	var name := dir.get_next()
	while name != "":
		if dir.current_is_dir() and not name.begins_with("."):
			var mod_dir := root.path_join(name)
			var mod := _read_manifest(mod_dir, source)
			if mod != null:
				found.append(mod)
		name = dir.get_next()
	dir.list_dir_end()
	return found

func _read_manifest(mod_dir: String, source: String) -> Mod:
	var manifest_path := mod_dir.path_join("mod.json")
	if not FileAccess.file_exists(manifest_path):
		return null
	var text := FileAccess.get_file_as_string(manifest_path)
	var json := JSON.new()
	var err := json.parse(text)
	var mod := Mod.new()
	mod.dir = mod_dir
	mod.source = source
	if err != OK or typeof(json.data) != TYPE_DICTIONARY:
		mod.id = mod_dir.get_file()
		mod.name = mod.id
		mod.error = "invalid mod.json (%s at line %d)" % [json.get_error_message(), json.get_error_line()]
		return mod

	var data: Dictionary = json.data
	mod.id = str(data.get("id", mod_dir.get_file()))
	mod.name = str(data.get("name", mod.id))
	mod.version = str(data.get("version", "0.0.0"))
	mod.author = str(data.get("author", "unknown"))
	mod.description = str(data.get("description", ""))
	mod.entry = str(data.get("entry", "main.lua"))

	# Validate: id slug and safe, in-folder entry path.
	if not _is_valid_id(mod.id):
		mod.error = "invalid id '%s' (need lowercase [a-z0-9_-])" % mod.id
	elif mod.entry.contains("..") or mod.entry.contains("/") or mod.entry.contains("\\"):
		mod.error = "entry must be a bare filename inside the mod folder"
	elif not mod.entry.to_lower().ends_with(".lua"):
		mod.error = "entry must be a .lua file"
	elif not FileAccess.file_exists(mod_dir.path_join(mod.entry)):
		mod.error = "entry script '%s' not found" % mod.entry
	return mod

func _is_valid_id(id: String) -> bool:
	if id.is_empty() or id.length() > 64:
		return false
	for c in id:
		var ok := (c >= "a" and c <= "z") or (c >= "0" and c <= "9") or c == "_" or c == "-"
		if not ok:
			return false
	return true

# --- Sandboxed loading -----------------------------------------------------

func _load_mod(mod: Mod) -> void:
	if not lua_available:
		mod.error = "lua-gdextension not installed"
		return

	# Create a fresh, per-mod sandbox and open only the safe library subset
	# (see SANDBOX_LIBRARIES). This omits io/os/package so a mod cannot touch
	# the filesystem, spawn processes, or pull in arbitrary Lua C modules.
	var lua = ClassDB.instantiate("LuaState")
	lua.open_libraries(SANDBOX_LIBRARIES)

	# Inject the curated modding surface as the global `game` table.
	ModApi.install(lua, mod.id)

	# Install the wall-clock budget guard: expose the deadline callable, run the
	# preamble to arm the debug hook, then the preamble deletes the callable and
	# the debug library so the mod can neither reach nor disable them.
	_install_budget_guard(lua)

	var entry_path := mod.dir.path_join(mod.entry)
	var script := FileAccess.get_file_as_string(entry_path)
	# Arm the budget for the load chunk (the preamble + the mod's top level), then
	# run both as one chunk so a runaway on_load aborts instead of freezing.
	arm_budget(lua)
	var guarded := BUDGET_PREAMBLE + "\n" + script
	# do_string(chunk, chunkname) — chunkname makes Lua error messages readable.
	var result = lua.do_string(guarded, "%s/%s" % [mod.id, mod.entry])
	disarm_budget(lua)
	if _is_lua_error(result):
		mod.error = "Lua error: " + str(result)
		mod.lua_state = null
		push_error("[ModLoader] %s failed: %s" % [mod.id, mod.error])
		return

	mod.lua_state = lua
	# Give the mod a chance to run its registration hook if it defined one.
	ModApi.invoke_mod_hook_for(mod.id, "on_load")

# --- Sandbox execution budget ---------------------------------------------

## Per-LuaState deadline (msec since engine start). >0 means a guarded call is in
## flight; the injected `__pf_deadline` callable compares against Time.get_ticks_msec().
var _deadlines: Dictionary = {}   # LuaState -> int deadline_msec

## Give the sandbox a `__pf_deadline()` global that returns true once this call's
## wall-clock budget is spent. The preamble captures it and then removes it.
func _install_budget_guard(lua: Object) -> void:
	if lua == null:
		return
	var self_ref := self
	var check := func() -> bool:
		var d: int = self_ref._deadlines.get(lua, 0)
		return d > 0 and Time.get_ticks_msec() > d
	lua.globals["__pf_deadline"] = check

## Start the budget clock for the next guarded call on this sandbox.
func arm_budget(lua: Object) -> void:
	if lua == null or not lua_available:
		return
	_deadlines[lua] = Time.get_ticks_msec() + CALL_BUDGET_MS

## Stop the budget clock (call finished). Leaves the hook installed but idle.
func disarm_budget(lua: Object) -> void:
	if lua == null:
		return
	_deadlines[lua] = 0

func _unload_all() -> void:
	for mod in mods:
		if mod.lua_state != null:
			ModApi.invoke_mod_hook_for(mod.id, "on_unload")
			ModApi.forget_mod(mod.id)
			_deadlines.erase(mod.lua_state)
			mod.lua_state = null

func _is_lua_error(value) -> bool:
	# LuaState.do_string / do_file return a LuaError instance on failure.
	if value is Object and is_instance_valid(value):
		return value.is_class("LuaError")
	return false

func _ensure_user_mods_dir() -> void:
	if not DirAccess.dir_exists_absolute(GameConfig.USER_MODS_DIR):
		DirAccess.make_dir_recursive_absolute(GameConfig.USER_MODS_DIR)
