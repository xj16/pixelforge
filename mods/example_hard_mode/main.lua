-- Hard Mode
-- =========
-- A balance/config example. It scales enemy stats through the shared game
-- config and subscribes to the player_damaged event to nudge the difficulty
-- further as the run goes on. Shows that mods can change global tunables and
-- respond to events without registering any new content.

game.log("hard_mode loading...")

-- Crank up enemy threat.
game.set_config("enemy_damage_scale", 1.5)
game.set_config("enemy_health_scale", 1.35)

-- Track how many times the player has been hit this session.
local hits = 0

game.on("player_damaged", function(event_name, data)
	hits = hits + 1
	game.log(("player took %d damage (hit #%d, hp=%s)"):format(
		data.amount or 0, hits, tostring(data.health)))

	-- Every five hits, ramp the difficulty a touch more for a rising challenge.
	if hits % 5 == 0 then
		local current = game.get_config("enemy_damage_scale") or 1.5
		game.set_config("enemy_damage_scale", current + 0.1)
		game.emit("mod_message", { text = "Hard Mode escalates! Enemy damage up." })
	end
end)

game.set_hook("on_load", function()
	game.log("hard_mode active: enemies hit harder and have more HP")
end)
