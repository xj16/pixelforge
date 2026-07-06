extends Node
## Global, read-mostly configuration and shared runtime constants.
##
## Autoloaded as `GameConfig`. Keeps tunables in one place so both the
## GDScript gameplay and the Lua modding layer read consistent values.

# --- Physics / movement tunables (pixels, seconds) ---
const GRAVITY: float = 980.0
const MAX_FALL_SPEED: float = 620.0
const PLAYER_SPEED: float = 150.0
const PLAYER_JUMP_VELOCITY: float = -330.0
const PLAYER_DASH_SPEED: float = 420.0
const PLAYER_DASH_TIME: float = 0.16
const PLAYER_DASH_COOLDOWN: float = 0.6
const COYOTE_TIME: float = 0.10
const JUMP_BUFFER_TIME: float = 0.10

# --- Collision layers (1-indexed bit positions, mirrors project.godot) ---
const LAYER_WORLD: int = 1
const LAYER_PLAYER: int = 2
const LAYER_ENEMY: int = 3
const LAYER_PLAYER_HITBOX: int = 4
const LAYER_PICKUP: int = 5

# --- Directories ---
## User-writable mod folder, created on first launch. Community mods live here.
const USER_MODS_DIR: String = "user://mods"
## Read-only mods that ship with the game (examples / built-ins).
const BUILTIN_MODS_DIR: String = "res://mods"

# --- Difficulty scalars, overridable by mods via ModApi ---
var enemy_damage_scale: float = 1.0
var enemy_health_scale: float = 1.0
var player_max_health: int = 100

func reset_to_defaults() -> void:
	enemy_damage_scale = 1.0
	enemy_health_scale = 1.0
	player_max_health = 100
