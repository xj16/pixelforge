extends CanvasLayer
## Minimal heads-up display: a health bar, a transient message line (for mod
## messages / events), and a hint about the mod-browser hotkey.

@onready var _health_bar: ProgressBar = $Root/HealthBar
@onready var _message: Label = $Root/Message
@onready var _hint: Label = $Root/Hint

var _message_timer := 0.0

func _ready() -> void:
	_hint.text = "[M] Mods   [R] Reload mods   A/D move  Space jump  J attack  K dash"
	EventBus.player_spawned.connect(_on_player_spawned)
	EventBus.player_damaged.connect(_on_player_hp_changed)
	EventBus.game_event.connect(_on_game_event)

func _process(delta: float) -> void:
	if _message_timer > 0.0:
		_message_timer -= delta
		if _message_timer <= 0.0:
			_message.text = ""

func _on_player_spawned(player: Node) -> void:
	if player.has_method("get_max_health"):
		_health_bar.max_value = player.get_max_health()
		_health_bar.value = player.get_health()

func _on_player_hp_changed(_amount: int, current_health: int) -> void:
	_health_bar.value = current_health

func _on_game_event(event_name: String, data: Dictionary) -> void:
	match event_name:
		"player_healed":
			_health_bar.value = int(data.get("health", _health_bar.value))
		"mod_message":
			_flash(str(data.get("text", "")))
		"item_collected":
			_flash("Picked up: %s" % str(data.get("item_id", "?")))
		"enemy_killed":
			pass

func _flash(text: String) -> void:
	_message.text = text
	_message_timer = 2.5
