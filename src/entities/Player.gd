extends CharacterBody2D
class_name Player
## The player character: a responsive 2D platformer controller with the feel
## staples of a metroidvania — coyote time, jump buffering, a dash, and an
## attack hitbox. Health and damage flow through the EventBus so mods can react.

@export var max_health: int = 100

var _health: int
var _coyote := 0.0
var _jump_buffer := 0.0
var _dash_time := 0.0
var _dash_cooldown := 0.0
var _facing := 1
var _invuln := 0.0
var _attack_window := 0.0        # seconds the hitbox stays live after a swing
var _hit_this_swing := {}        # enemies already struck by the current swing

@onready var _sprite: Node2D = $Body
@onready var _attack_area: Area2D = $AttackArea
@onready var _attack_shape: CollisionShape2D = $AttackArea/Shape

func _ready() -> void:
	max_health = GameConfig.player_max_health
	_health = max_health
	add_to_group("player")
	_attack_area.monitoring = false
	# Register enemies as they enter the live hitbox. Using body_entered (rather
	# than polling overlaps the same frame the box turns on) means a hit lands
	# reliably on the physics step after the swing.
	_attack_area.body_entered.connect(_on_attack_body_entered)
	EventBus.player_spawned.emit(self)

func _physics_process(delta: float) -> void:
	_tick_timers(delta)
	_apply_gravity(delta)
	_handle_horizontal()
	_handle_jump()
	_handle_dash(delta)
	move_and_slide()
	_handle_attack(delta)

func _tick_timers(delta: float) -> void:
	_coyote = maxf(0.0, _coyote - delta)
	_jump_buffer = maxf(0.0, _jump_buffer - delta)
	_dash_cooldown = maxf(0.0, _dash_cooldown - delta)
	_invuln = maxf(0.0, _invuln - delta)
	if is_on_floor():
		_coyote = GameConfig.COYOTE_TIME

func _apply_gravity(delta: float) -> void:
	if _dash_time > 0.0:
		return # dash suspends gravity
	if not is_on_floor():
		velocity.y = minf(velocity.y + GameConfig.GRAVITY * delta, GameConfig.MAX_FALL_SPEED)

func _handle_horizontal() -> void:
	if _dash_time > 0.0:
		return
	var dir := Input.get_axis("move_left", "move_right")
	velocity.x = dir * GameConfig.PLAYER_SPEED
	if dir != 0.0:
		_facing = 1 if dir > 0.0 else -1
		_sprite.scale.x = absf(_sprite.scale.x) * _facing

func _handle_jump() -> void:
	if Input.is_action_just_pressed("jump"):
		_jump_buffer = GameConfig.JUMP_BUFFER_TIME
	if _jump_buffer > 0.0 and _coyote > 0.0:
		velocity.y = GameConfig.PLAYER_JUMP_VELOCITY
		_jump_buffer = 0.0
		_coyote = 0.0
	# Variable jump height: releasing early cuts the ascent.
	if Input.is_action_just_released("jump") and velocity.y < 0.0:
		velocity.y *= 0.45

func _handle_dash(delta: float) -> void:
	if Input.is_action_just_pressed("dash") and _dash_cooldown <= 0.0 and _dash_time <= 0.0:
		_dash_time = GameConfig.PLAYER_DASH_TIME
		_dash_cooldown = GameConfig.PLAYER_DASH_COOLDOWN
		_invuln = maxf(_invuln, GameConfig.PLAYER_DASH_TIME) # i-frames during dash
		EventBus.emit_game_event("player_dashed", {"facing": _facing})
	if _dash_time > 0.0:
		_dash_time -= delta
		velocity = Vector2(_facing * GameConfig.PLAYER_DASH_SPEED, 0.0)

func _handle_attack(delta: float) -> void:
	if Input.is_action_just_pressed("attack") and _attack_window <= 0.0:
		# Position the hitbox in front of the player and open the strike window.
		_attack_shape.position.x = absf(_attack_shape.position.x) * _facing
		_attack_area.monitoring = true
		_attack_window = 0.12
		_hit_this_swing.clear()
		EventBus.emit_game_event("player_attacked", {"facing": _facing})
		for body in _attack_area.get_overlapping_bodies():
			_try_hit(body)

	if _attack_window > 0.0:
		# Sweep overlaps each active frame so a stationary enemy inside the box
		# is still struck. Each enemy is hit at most once per swing.
		for body in _attack_area.get_overlapping_bodies():
			_try_hit(body)
		_attack_window -= delta
		if _attack_window <= 0.0:
			_attack_area.monitoring = false

func _on_attack_body_entered(body: Node) -> void:
	if _attack_window > 0.0:
		_try_hit(body)

func _try_hit(body: Node) -> void:
	if body == null or not body.is_in_group("enemy") or not body.has_method("take_hit"):
		return
	# One hit per enemy per swing.
	if _hit_this_swing.has(body.get_instance_id()):
		return
	_hit_this_swing[body.get_instance_id()] = true
	body.take_hit(self)

## Apply damage to the player. `amount` has already been resolved by the C#
## CombatResolver. Ignored while invulnerable (e.g. mid-dash).
func take_damage(amount: int) -> void:
	if _invuln > 0.0 or _health <= 0:
		return
	_health = max(0, _health - amount)
	_invuln = 0.5
	EventBus.player_damaged.emit(amount, _health)
	EventBus.emit_game_event("player_damaged", {"amount": amount, "health": _health})
	if _health <= 0:
		_die()

func heal(amount: int) -> void:
	_health = min(max_health, _health + amount)
	EventBus.emit_game_event("player_healed", {"amount": amount, "health": _health})

func get_health() -> int:
	return _health

func get_max_health() -> int:
	return max_health

func _die() -> void:
	EventBus.player_died.emit()
	EventBus.emit_game_event("player_died", {"position": global_position})
	# Respawn to full after a short beat so a playtest loop keeps going.
	await get_tree().create_timer(1.0).timeout
	_health = max_health
	global_position = _spawn_point()
	velocity = Vector2.ZERO

func _spawn_point() -> Vector2:
	var world := get_tree().get_first_node_in_group("world")
	if world != null and world.has_method("get_spawn_point"):
		return world.get_spawn_point()
	return global_position
