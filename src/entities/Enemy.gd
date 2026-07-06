extends CharacterBody2D
class_name Enemy
## A data-driven enemy. Its stats and behavior come from an
## `ModApi.EnemyArchetype`, which may be a built-in or supplied by a Lua mod.
##
## Movement decisions can be delegated to the archetype's optional Lua `think`
## function: each AI tick we hand it a small, plain-Dictionary context and it
## returns an action (move direction, whether to jump, etc.). If no `think`
## function is provided, a competent default chase-and-drop AI runs, using the
## C# NavGrid for pathfinding on grounded enemies.

var archetype                     # ModApi.EnemyArchetype
var _health: int
var _think_accum := 0.0
var _think_interval := 0.15
var _state := {}                  # persistent per-enemy scratch space for Lua
var _target: Node2D
var _world                        # World node (holds NavGrid + CombatResolver)

@onready var _sprite: Polygon2D = $Body

const TILE := 16.0

func setup(arch, world) -> void:
	archetype = arch
	_world = world

func _ready() -> void:
	add_to_group("enemy")
	_health = int(archetype.max_health * GameConfig.enemy_health_scale)
	_sprite.color = archetype.color
	_target = get_tree().get_first_node_in_group("player")
	EventBus.enemy_spawned.emit(self)

func _physics_process(delta: float) -> void:
	if not is_instance_valid(_target):
		_target = get_tree().get_first_node_in_group("player")

	if not archetype.can_fly and not is_on_floor():
		velocity.y = minf(velocity.y + GameConfig.GRAVITY * delta, GameConfig.MAX_FALL_SPEED)

	_think_accum += delta
	if _think_accum >= _think_interval:
		_think_accum = 0.0
		_decide()

	move_and_slide()
	_check_contact_damage()

func _decide() -> void:
	if _target == null:
		return
	var ctx := {
		"self_pos": global_position,
		"target_pos": _target.global_position,
		"distance": global_position.distance_to(_target.global_position),
		"health": _health,
		"on_floor": is_on_floor(),
		"state": _state,
	}
	# Delegate to the mod's Lua brain if it provided one.
	if archetype.think != null:
		var action = ModApi._call_lua(archetype.think, [ctx])
		if action != null:
			_apply_action(ModApi._as_dict(action))
			return
	_default_ai()

func _apply_action(action: Dictionary) -> void:
	# Persist any state the Lua brain handed back so it survives to next tick.
	if action.has("state"):
		_state = ModApi._as_dict(action["state"])
	var move_x := float(action.get("move_x", 0.0))
	velocity.x = clampf(move_x, -1.0, 1.0) * archetype.speed
	if archetype.can_fly:
		var move_y := float(action.get("move_y", 0.0))
		velocity.y = clampf(move_y, -1.0, 1.0) * archetype.speed
	elif bool(action.get("jump", false)) and is_on_floor():
		velocity.y = GameConfig.PLAYER_JUMP_VELOCITY * 0.8

func _default_ai() -> void:
	if _target == null:
		return
	var to_target := _target.global_position - global_position
	if archetype.can_fly:
		# Flyers home in directly.
		velocity = to_target.normalized() * archetype.speed
		return
	# Grounded enemies use the C# NavGrid to route toward the player.
	var dir := signf(to_target.x)
	if _world != null and _world.has_method("next_path_step"):
		var step = _world.next_path_step(global_position, _target.global_position)
		if step != Vector2.ZERO:
			dir = signf(step.x - global_position.x)
	velocity.x = dir * archetype.speed
	# Hop over small ledges when blocked horizontally.
	if is_on_wall() and is_on_floor():
		velocity.y = GameConfig.PLAYER_JUMP_VELOCITY * 0.7

func _check_contact_damage() -> void:
	if _target == null or not _target.has_method("take_damage"):
		return
	if global_position.distance_to(_target.global_position) < 14.0:
		var dmg := _resolve_contact_damage()
		_target.take_damage(dmg)

func _resolve_contact_damage() -> int:
	var base := archetype.contact_damage * GameConfig.enemy_damage_scale
	if _world != null and _world.has_method("resolve_damage"):
		var res: Dictionary = _world.resolve_damage({
			"base_damage": base,
			"element": archetype.element,
			"variance": 0.15,
		})
		return int(res.get("amount", base))
	return int(base)

## Called by the player's attack. Applies a fixed player hit and dies at zero.
func take_hit(source: Node) -> void:
	var dmg := 18
	if _world != null and _world.has_method("resolve_damage"):
		var res: Dictionary = _world.resolve_damage({
			"base_damage": 18,
			"element": "physical",
			"crit_chance": 0.2,
			"crit_mult": 2.0,
		})
		dmg = int(res.get("amount", 18))
	_health -= dmg
	# Small knockback away from the attacker.
	if source != null:
		var away := signf(global_position.x - source.global_position.x)
		velocity.x = away * 120.0
	if _health <= 0:
		_kill()

func _kill() -> void:
	EventBus.enemy_killed.emit(archetype.id, global_position)
	EventBus.emit_game_event("enemy_killed", {
		"enemy_id": archetype.id, "position": global_position,
	})
	queue_free()
