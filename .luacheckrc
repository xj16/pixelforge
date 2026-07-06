-- luacheck configuration for PixelForge mods.
--
-- Mods run inside a sandboxed LuaState with a curated set of standard libraries
-- (base, table, string, math, coroutine) plus a single injected global table,
-- `game`, which is the modding API surface. We declare `game` as a read-only
-- global so luacheck doesn't flag it as undefined.

std = "lua54"

-- The engine-injected API. Mods read from it but never reassign it.
read_globals = {
	"game",
}

-- Sandboxed mods intentionally have no io/os; don't warn about their absence.
-- Allow slightly longer lines for readable comments and tables.
max_line_length = 120

-- Event handlers receive (event_name, data) for API clarity even when a mod
-- only uses `data`. Don't flag those intentionally-present arguments.
unused_args = false

-- Sample mods live under mods/. Ignore the addons folder entirely.
exclude_files = {
	"addons/**",
}
