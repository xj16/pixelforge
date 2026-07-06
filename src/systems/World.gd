extends Node2D
class_name World
## Owns the level: builds the C# NavGrid from the tilemap, holds the C#
## CombatResolver, registers built-in content, and spawns enemies and items —
## whether they come from GDScript built-ins or from Lua mods.

const TILE := 16

@export var enemy_scene: PackedScene
@export var pickup_scene: PackedScene

var _nav                          # NavGrid (C#)
var _combat                       # CombatResolver (C#)
var _spawn_point := Vector2(64, 200)
var _rng := RandomNumberGenerator.new()

@onready var _terrain: Node2D = $Terrain
@onready var _spawns: Node2D = $Spawns

func _ready() -> void:
	add_to_group("world")
	_rng.randomize()
	_build_collision()
	_setup_csharp_systems()
	_register_builtin_content()
	# Load mods AFTER built-ins so a mod can override a built-in id.
	ModLoader.reload_all()
	_build_nav_grid()
	_populate()
	EventBus.mods_reloaded.connect(_on_mods_reloaded)

## Generate a StaticBody2D with a rectangle collider for every ColorRect under
## $Terrain, so the visible platforms are also solid. Authoring the level as a
## handful of ColorRects keeps the .tscn readable while still giving real
## physics and a nav grid that agree with what the player sees.
func _build_collision() -> void:
	for platform in _terrain.get_children():
		if not (platform is ColorRect):
			continue
		var body := StaticBody2D.new()
		body.collision_layer = 1
		body.collision_mask = 0
		var shape := CollisionShape2D.new()
		var rect := RectangleShape2D.new()
		rect.size = platform.size
		shape.shape = rect
		shape.position = platform.position + platform.size / 2.0
		body.add_child(shape)
		_terrain.add_child(body)

func _setup_csharp_systems() -> void:
	# Instantiate the C# nodes by class name so the project works even when the
	# C# assembly hasn't been rebuilt yet (graceful degradation in the editor).
	if ClassDB.class_exists("NavGrid"):
		_nav = ClassDB.instantiate("NavGrid")
		add_child(_nav)
	if ClassDB.class_exists("CombatResolver"):
		_combat = ClassDB.instantiate("CombatResolver")
		add_child(_combat)
		_combat.call("Seed", _rng.randi())

func get_spawn_point() -> Vector2:
	return _spawn_point

# --- C# bridge methods used by entities ------------------------------------

## Resolve a damage packet through the C# CombatResolver. Falls back to the raw
## base damage if the C# assembly isn't loaded.
func resolve_damage(packet: Dictionary) -> Dictionary:
	if _combat != null:
		return _combat.call("Resolve", packet)
	return {"amount": int(packet.get("base_damage", 0)), "is_crit": false,
		"element": packet.get("element", "physical"), "blocked": false}

## Register/override a global element multiplier (used by ModApi).
func set_element_scale(element: String, scale: float) -> void:
	if _combat != null:
		_combat.call("SetElementScale", element, scale)

## Return a world-space step vector toward `to`, routed by the C# NavGrid.
func next_path_step(from: Vector2, to: Vector2) -> Vector2:
	if _nav == null:
		return Vector2.ZERO
	var s := _world_to_cell(from)
	var t := _world_to_cell(to)
	var path: Array = _nav.call("FindPath", s.x, s.y, t.x, t.y)
	if path.is_empty():
		return Vector2.ZERO
	var next: Vector2i = path[0]
	return _cell_to_world(next)

func _world_to_cell(p: Vector2) -> Vector2i:
	return Vector2i(int(p.x) / TILE, int(p.y) / TILE)

func _cell_to_world(c: Vector2i) -> Vector2:
	return Vector2(c.x * TILE + TILE / 2, c.y * TILE + TILE / 2)

# --- Nav grid construction -------------------------------------------------

# Grid dimensions in tiles for the level. Kept fixed and generous so enemies
# can path across the whole playfield.
const GRID_W := 48
const GRID_H := 28

func _build_nav_grid() -> void:
	if _nav == null:
		return
	_nav.call("Configure", GRID_W, GRID_H, false)
	# Rasterize every solid platform (a ColorRect under $Terrain marks the tiles
	# it covers) into the grid as blocked cells.
	var solid := {}
	for platform in _terrain.get_children():
		if platform is ColorRect:
			var r: Rect2 = Rect2(platform.position, platform.size)
			var x0 := int(floor(r.position.x / TILE))
			var y0 := int(floor(r.position.y / TILE))
			var x1 := int(ceil((r.position.x + r.size.x) / TILE))
			var y1 := int(ceil((r.position.y + r.size.y) / TILE))
			for ty in range(y0, y1):
				for tx in range(x0, x1):
					solid[Vector2i(tx, ty)] = true
	for y in range(GRID_H):
		for x in range(GRID_W):
			var cell := Vector2i(x, y)
			_nav.call("SetBlocked", x, y, solid.has(cell))
			var has_ground: bool = solid.has(Vector2i(x, y + 1))
			_nav.call("SetGroundBelow", x, y, has_ground)

# --- Content registration & spawning ---------------------------------------

func _register_builtin_content() -> void:
	# Built-in "grunt": a grounded chaser that uses the default AI.
	var grunt := ModApi.EnemyArchetype.new()
	grunt.id = "builtin_grunt"
	grunt.mod_id = "builtin"
	grunt.display_name = "Cave Grunt"
	grunt.max_health = 24
	grunt.speed = 46.0
	grunt.contact_damage = 8
	grunt.color = Color("#b5533c")
	ModApi.enemy_archetypes[grunt.id] = grunt

	# Built-in "bat": a flyer that homes in.
	var bat := ModApi.EnemyArchetype.new()
	bat.id = "builtin_bat"
	bat.mod_id = "builtin"
	bat.display_name = "Cave Bat"
	bat.max_health = 12
	bat.speed = 62.0
	bat.contact_damage = 5
	bat.can_fly = true
	bat.color = Color("#7a5ea8")
	ModApi.enemy_archetypes[bat.id] = bat

func _populate() -> void:
	_clear_dynamic()
	# Spawn built-ins plus a couple of any mod-registered enemies for showcase.
	_spawn_enemy("builtin_grunt", Vector2(220, 180))
	_spawn_enemy("builtin_bat", Vector2(320, 120))
	for id in ModApi.enemy_archetypes.keys():
		var arch = ModApi.enemy_archetypes[id]
		if arch.mod_id != "builtin":
			_spawn_enemy(id, Vector2(_rng.randf_range(200, 480), 160))
	# Spawn every mod-registered item so its effect is testable in-game.
	var ix := 260
	for id in ModApi.item_defs.keys():
		_spawn_item(id, Vector2(ix, 200))
		ix += 40

func _spawn_enemy(archetype_id: String, pos: Vector2) -> void:
	var arch = ModApi.enemy_archetypes.get(archetype_id, null)
	if arch == null or enemy_scene == null:
		return
	var e = enemy_scene.instantiate()
	e.setup(arch, self)
	e.global_position = pos
	_spawns.add_child(e)

func _spawn_item(item_id: String, pos: Vector2) -> void:
	var def = ModApi.item_defs.get(item_id, null)
	if def == null or pickup_scene == null:
		return
	var p = pickup_scene.instantiate()
	p.setup(def)
	p.global_position = pos
	_spawns.add_child(p)

func _clear_dynamic() -> void:
	for child in _spawns.get_children():
		child.queue_free()

func _on_mods_reloaded(_active: PackedStringArray) -> void:
	# Rebuild the population so newly loaded mods appear immediately (hot reload).
	_populate()
