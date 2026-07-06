-- Healing Orb
-- ===========
-- Registers a collectible item. When the player touches it, the `on_collect`
-- callback runs inside this sandbox and returns a small table of effects the
-- engine applies (heal amount, a HUD message). The mod never touches the player
-- node directly -- it only reads the snapshot it is given and returns intent.

game.log("healing_orb loading...")

game.register_item({
	id = "healing_orb",
	name = "Healing Orb",
	color = "#66e08a",

	-- player_state is a read-only snapshot: { health, max_health }.
	-- Return a table of effects; supported keys: heal (int), message (string).
	on_collect = function(player_state)
		local missing = player_state.max_health - player_state.health
		local heal = math.min(35, math.max(10, missing))
		return {
			heal = heal,
			message = "Healing Orb restored " .. heal .. " HP",
		}
	end,
})

game.set_hook("on_load", function()
	game.log("healing_orb ready")
end)
