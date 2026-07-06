# Addons

PixelForge's Lua modding layer is powered by the third-party
[**lua-gdextension**](https://github.com/gilzoide/lua-gdextension) addon
(Lua 5.4, Godot 4.5+). Its binaries are **not** committed to this repository —
they are platform-specific, sizeable, and independently versioned.

## Installing the addon

Run the helper script from the project root:

```bash
# Linux / macOS
./scripts/fetch_addons.sh

# Windows (Git Bash)
bash scripts/fetch_addons.sh
```

This downloads the pinned release of `lua-gdextension` and extracts it to
`addons/lua-gdextension/`. Alternatively, install it from the Godot Asset
Library ("Lua GDExtension") directly inside the editor.

The game runs **without** the addon too — the modding system detects its
absence, disables Lua mods gracefully, and the mod browser shows an
"addon not installed" notice. Everything else (movement, combat, the C#
systems) works regardless.
