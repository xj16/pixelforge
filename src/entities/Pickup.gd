extends Area2D
class_name Pickup
## A collectible item on the ground. Its appearance and effect come from an
## `ModApi.ItemDef` (built-in or mod-supplied). On touch it runs the item's
## optional Lua `on_collect` callback with a small player-state table.

var item_def                      # ModApi.ItemDef

@onready var _visual: Polygon2D = $Visual

func setup(def) -> void:
	item_def = def

func _ready() -> void:
	add_to_group("pickup")
	if item_def != null:
		_visual.color = item_def.color
	body_entered.connect(_on_body_entered)

func _on_body_entered(body: Node) -> void:
	if not body.is_in_group("player"):
		return
	if item_def != null and item_def.on_collect != null:
		# Hand the mod a mutable snapshot of the player's state.
		var player_state := {
			"health": body.get_health() if body.has_method("get_health") else 0,
			"max_health": body.get_max_health() if body.has_method("get_max_health") else 0,
		}
		var result = ModApi._call_lua(item_def.on_collect, [player_state])
		_apply_collect_result(body, ModApi._as_dict(result))
	EventBus.item_collected.emit(item_def.id if item_def != null else "unknown")
	EventBus.emit_game_event("item_collected", {"item_id": item_def.id if item_def != null else "unknown"})
	queue_free()

## Interpret the table an item's on_collect returned. Supported effects keep the
## sandbox from needing direct node access.
func _apply_collect_result(player: Node, result: Dictionary) -> void:
	if result.is_empty():
		return
	if result.has("heal") and player.has_method("heal"):
		player.heal(int(result["heal"]))
	if result.has("message"):
		EventBus.emit_game_event("mod_message", {"text": str(result["message"])})
