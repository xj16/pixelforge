-- Frost Slime
-- ============
-- A community example mod for PixelForge. It demonstrates the three most
-- common things a mod does:
--   1. register a new enemy with a custom AI "think" function written in Lua,
--   2. register a new damage element and rebalance an existing one,
--   3. subscribe to a game event.
--
-- The mod runs inside its own sandboxed LuaState. The only bridge to the engine
-- is the global `game` table injected by ModApi. There is no `io`, no `os`, no
-- filesystem access -- just the curated, safe surface documented in docs/MODDING.md.

game.log("frost_slime loading...")

-- Make frost hits land a little harder than physical.
game.register_element("frost", 1.25)

-- Give the frost element an on-hit status: a 40% slow for 2 seconds. When the
-- player strikes a frost enemy, it visibly chills and crawls. This drives the
-- C# StatusEngine through the curated API -- no engine access required.
game.register_status("frost", {
	kind = "slow",
	magnitude = 0.4,
	duration = 2.0,
})

-- The AI brain. Called on every think tick with a context table:
--   ctx.self_pos    Vector2   this enemy's position
--   ctx.target_pos  Vector2   the player's position
--   ctx.distance    number    distance between them
--   ctx.on_floor    boolean   whether the slime is grounded
--   ctx.state       table     persistent scratch space we own
--
-- It returns an action table the engine applies:
--   move_x  number   -1..1 horizontal intent
--   jump    boolean  request a hop (only honored when on_floor)
--   state   table    persisted back to us next tick
local function slime_think(ctx)
	local state = ctx.state or {}
	state.hop_timer = (state.hop_timer or 0) - 0.15

	-- Chase the player horizontally.
	local dir = 0
	if ctx.target_pos.x < ctx.self_pos.x then
		dir = -1
	elseif ctx.target_pos.x > ctx.self_pos.x then
		dir = 1
	end

	-- Bounce toward the player on a timer for that classic slime feel.
	local jump = false
	if ctx.on_floor and state.hop_timer <= 0 then
		jump = true
		state.hop_timer = 0.8
	end

	return { move_x = dir, jump = jump, state = state }
end

game.register_enemy({
	id = "frost_slime",
	name = "Frost Slime",
	health = 30,
	speed = 40,
	damage = 10,
	element = "frost",
	color = "#5bc9e6",
	think = slime_think,
})

-- React when the player kills any enemy: a tiny bit of flavor logging.
game.on("enemy_killed", function(event_name, data)
	if data.enemy_id == "frost_slime" then
		game.log("A frost slime was shattered!")
	end
end)

-- Optional lifecycle hooks. on_load fires right after the script runs; on_unload
-- fires just before a hot-reload tears this sandbox down.
game.set_hook("on_load", function()
	game.log("frost_slime ready (v" .. game.version .. ")")
end)

game.set_hook("on_unload", function()
	game.log("frost_slime unloaded, cleaning up")
end)
