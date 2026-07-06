extends CanvasLayer
## In-game mod browser. Toggled with [M]. Lists every discovered mod (built-in
## and from `user://mods`), shows metadata and load errors, lets the player
## enable/disable each one, and hot-reloads all mods with a button or [R].
##
## Because ModLoader keeps each mod in its own sandboxed LuaState, toggling and
## reloading here is safe at runtime — no restart required.

@onready var _dim: ColorRect = $Dim
@onready var _panel: Control = $Panel
@onready var _list: VBoxContainer = $Panel/Margin/VBox/Scroll/List
@onready var _status: Label = $Panel/Margin/VBox/Header/Status
@onready var _reload_button: Button = $Panel/Margin/VBox/Footer/ReloadButton
@onready var _open_folder_button: Button = $Panel/Margin/VBox/Footer/OpenFolderButton

func _ready() -> void:
	_panel.visible = false
	_dim.visible = false
	# Keep processing input while the tree is paused so [M]/[R] still work.
	process_mode = Node.PROCESS_MODE_ALWAYS
	_reload_button.pressed.connect(_reload)
	_open_folder_button.pressed.connect(_open_mods_folder)
	EventBus.mods_reloaded.connect(func(_a): _refresh())
	_refresh()

func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("toggle_mod_browser"):
		_toggle()
		get_viewport().set_input_as_handled()
	elif event.is_action_pressed("reload_mods"):
		_reload()
		get_viewport().set_input_as_handled()

func _toggle() -> void:
	_panel.visible = not _panel.visible
	_dim.visible = _panel.visible
	if _panel.visible:
		_refresh()
	# Pause gameplay while browsing so nothing kills the player mid-menu.
	get_tree().paused = _panel.visible

func _reload() -> void:
	ModLoader.reload_all()
	_refresh()

func _refresh() -> void:
	for child in _list.get_children():
		child.queue_free()

	if not ModLoader.lua_available:
		_status.text = "lua-gdextension addon not installed — mods disabled"
		_status.modulate = Color("#e0a44a")
	else:
		var count := ModLoader.mods.size()
		_status.text = "%d mod%s discovered" % [count, "" if count == 1 else "s"]
		_status.modulate = Color("#8fd18f")

	for mod in ModLoader.mods:
		_list.add_child(_make_row(mod))

func _make_row(mod) -> Control:
	var row := PanelContainer.new()
	var hb := HBoxContainer.new()
	hb.add_theme_constant_override("separation", 12)
	row.add_child(hb)

	var check := CheckBox.new()
	check.button_pressed = mod.enabled
	check.disabled = not mod.error.is_empty() or not ModLoader.lua_available
	check.toggled.connect(func(pressed): ModLoader.set_mod_enabled(mod.id, pressed))
	hb.add_child(check)

	var info := VBoxContainer.new()
	info.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	hb.add_child(info)

	var title := Label.new()
	title.text = "%s  v%s  (%s)" % [mod.name, mod.version, mod.source]
	title.add_theme_font_size_override("font_size", 16)
	info.add_child(title)

	var meta := Label.new()
	meta.text = "%s — by %s" % [mod.description, mod.author]
	meta.add_theme_color_override("font_color", Color("#9aa2b5"))
	meta.add_theme_font_size_override("font_size", 12)
	info.add_child(meta)

	if not mod.error.is_empty():
		var err := Label.new()
		err.text = "⚠ " + mod.error
		err.add_theme_color_override("font_color", Color("#e06a6a"))
		err.add_theme_font_size_override("font_size", 12)
		info.add_child(err)

	return row

func _open_mods_folder() -> void:
	var abs := ProjectSettings.globalize_path(GameConfig.USER_MODS_DIR)
	DirAccess.make_dir_recursive_absolute(GameConfig.USER_MODS_DIR)
	OS.shell_open(abs)
