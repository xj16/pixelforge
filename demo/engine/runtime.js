// The modding runtime — the JS twin of src/modding/ModApi.gd + ModLoader.gd.
//
// Each mod runs in its own Interpreter (sandbox) with an instruction budget and
// only the curated `game` table as a bridge to the engine. Registrations are
// tracked per mod id so a hot-reload cleanly forgets the old ones. A mod that
// blows its budget (e.g. an infinite loop) is caught, disabled, and reported —
// it never freezes the loop. This is the same contract the Godot loader enforces
// with lua-gdextension + a debug hook.

import { Interpreter, LuaTable, LuaError, luaToJS } from "./lua-lite.js";

// Sensible per-call CPU cap. Big enough for real AI brains, small enough that a
// `while true do end` is aborted in well under a frame.
export const DEFAULT_BUDGET = 400_000;

export class ModRuntime {
  constructor(engine, { budget = DEFAULT_BUDGET } = {}) {
    this.engine = engine; // provides config, element scale/status, logging sink
    this.budget = budget;

    this.enemyArchetypes = new Map(); // id -> archetype
    this.itemDefs = new Map();        // id -> item def
    this._eventHandlers = new Map();  // event -> [{modId, fn, interp}]
    this._modHooks = new Map();       // modId -> {hook -> {fn, interp}}
    this._ownership = new Map();      // modId -> {enemies:[], items:[]}
    this.logs = [];                   // {modId, level, msg}
  }

  log(modId, level, msg) {
    const entry = { modId, level, msg: String(msg), t: Date.now() };
    this.logs.push(entry);
    if (this.logs.length > 500) this.logs.shift();
    if (this.engine && this.engine.onLog) this.engine.onLog(entry);
  }

  // Build the curated `game` table for a mod's sandbox.
  _installApi(interp, modId) {
    this._ownership.set(modId, { enemies: [], items: [] });
    const game = new LuaTable();

    game.set("mod_id", modId);
    game.set("version", this.engine.version ?? "1.0.0");

    game.set("log", (a) => { this.log(modId, "info", a[0]); return []; });
    game.set("warn", (a) => { this.log(modId, "warn", a[0]); return []; });

    game.set("register_enemy", (a) => [this._registerEnemy(modId, a[0])]);
    game.set("register_item", (a) => [this._registerItem(modId, a[0])]);
    game.set("register_element", (a) => { this.engine.setElementScale(String(a[0]), Number(a[1])); return []; });
    game.set("register_status", (a) => { this._registerStatus(modId, a[0], a[1]); return []; });

    game.set("set_config", (a) => { this.engine.setConfig(String(a[0]), luaToJS(a[1])); return []; });
    game.set("get_config", (a) => [this.engine.getConfig(String(a[0]))]);

    game.set("on", (a) => { this._subscribe(modId, interp, String(a[0]), a[1]); return []; });
    game.set("emit", (a) => { this.engine.emit(String(a[0]), luaToJS(a[1]) ?? {}); return []; });

    game.set("set_hook", (a) => { this._setHook(modId, interp, String(a[0]), a[1]); return []; });

    interp.setGlobal("game", game);
  }

  _asDict(spec) {
    if (spec instanceof LuaTable) return spec;
    return new LuaTable();
  }

  _registerEnemy(modId, spec) {
    const d = this._asDict(spec);
    const id = String(d.get("id") ?? "");
    if (!id) { this.log(modId, "warn", "register_enemy requires an 'id'"); return ""; }
    const arch = {
      id, modId,
      displayName: String(d.get("name") ?? id),
      maxHealth: Math.trunc(Number(d.get("health") ?? 20)),
      speed: Number(d.get("speed") ?? 40),
      contactDamage: Math.trunc(Number(d.get("damage") ?? 8)),
      canFly: !!truthy(d.get("fly")),
      element: String(d.get("element") ?? "physical"),
      color: parseColor(d.get("color") ?? "#ffffff"),
      think: d.get("think") ?? null,      // LuaFunction
      _interp: this._interpFor(modId),
    };
    this.enemyArchetypes.set(id, arch);
    this._ownership.get(modId).enemies.push(id);
    return id;
  }

  _registerItem(modId, spec) {
    const d = this._asDict(spec);
    const id = String(d.get("id") ?? "");
    if (!id) { this.log(modId, "warn", "register_item requires an 'id'"); return ""; }
    const item = {
      id, modId,
      displayName: String(d.get("name") ?? id),
      color: parseColor(d.get("color") ?? "#ffd24a"),
      onCollect: d.get("on_collect") ?? null,
      _interp: this._interpFor(modId),
    };
    this.itemDefs.set(id, item);
    this._ownership.get(modId).items.push(id);
    return id;
  }

  _registerStatus(modId, element, spec) {
    const d = this._asDict(spec);
    const kind = String(d.get("kind") ?? "slow");
    this.engine.setElementStatus(String(element), {
      kind,
      magnitude: Number(d.get("magnitude") ?? 0),
      duration: Number(d.get("duration") ?? 2.0),
      interval: Number(d.get("interval") ?? 0.5),
    });
  }

  _subscribe(modId, interp, event, fn) {
    if (!this._eventHandlers.has(event)) this._eventHandlers.set(event, []);
    this._eventHandlers.get(event).push({ modId, fn, interp });
  }

  _setHook(modId, interp, hook, fn) {
    if (!this._modHooks.has(modId)) this._modHooks.set(modId, {});
    this._modHooks.get(modId)[hook] = { fn, interp };
  }

  // Track the interpreter per mod so cross-call invocations (think/hooks/events)
  // run under that mod's own budgeted sandbox.
  _interps = new Map();
  _interpFor(modId) { return this._interps.get(modId) ?? null; }

  // Dispatch a game event to every subscribed mod (budgeted, isolated).
  dispatchEvent(event, data) {
    const handlers = this._eventHandlers.get(event) ?? [];
    for (const h of handlers) {
      this.callGuarded(h.interp, h.fn, [event, jsData(h.interp, data)], h.modId, `event ${event}`);
    }
  }

  // Run a mod-supplied Lua function under its budget; on overrun/error, log and
  // return null (never throws into the game loop).
  callGuarded(interp, fn, args, modId, what) {
    if (!interp || !fn) return null;
    interp.resetBudget();
    try {
      const r = interp.call(fn, args);
      return r && r.length ? r[0] : null;
    } catch (e) {
      const msg = e instanceof LuaError ? e.message : String(e);
      this.log(modId, "error", `${what} failed: ${msg}`);
      const mod = this._modsById?.get(modId);
      if (mod) { mod.error = `${what}: ${msg}`; mod.enabled = false; }
      return null;
    }
  }

  invokeModHook(modId, hook) {
    const hooks = this._modHooks.get(modId);
    if (hooks && hooks[hook]) this.callGuarded(hooks[hook].interp, hooks[hook].fn, [], modId, `hook ${hook}`);
  }

  forgetMod(modId) {
    const owned = this._ownership.get(modId) ?? { enemies: [], items: [] };
    for (const id of owned.enemies) this.enemyArchetypes.delete(id);
    for (const id of owned.items) this.itemDefs.delete(id);
    this._ownership.delete(modId);
    this._modHooks.delete(modId);
    this._interps.delete(modId);
    for (const [ev, list] of this._eventHandlers) {
      this._eventHandlers.set(ev, list.filter((h) => h.modId !== modId));
    }
  }

  // Load a single mod: validate happens in the loader; here we sandbox + run.
  loadMod(mod) {
    const interp = new Interpreter({ budget: this.budget });
    this._interps.set(mod.id, interp);
    this._modsById = this._modsById ?? new Map();
    this._modsById.set(mod.id, mod);
    this._installApi(interp, mod.id);
    interp.resetBudget();
    try {
      interp.run(mod.source, `${mod.id}/${mod.entry}`);
      mod.interp = interp;
      mod.error = "";
      this.invokeModHook(mod.id, "on_load");
      return true;
    } catch (e) {
      const msg = e instanceof LuaError ? e.message : String(e);
      mod.error = msg;
      this.forgetMod(mod.id);
      this.log(mod.id, "error", `load failed: ${msg}`);
      return false;
    }
  }

  unloadMod(mod) {
    if (mod.interp) this.invokeModHook(mod.id, "on_unload");
    this.forgetMod(mod.id);
    mod.interp = null;
  }
}

function truthy(v) { return v !== null && v !== undefined && v !== false; }

// Turn a plain-JS event payload into a LuaTable the handler can read.
function jsData(interp, data) {
  const t = new LuaTable();
  if (data && typeof data === "object") {
    for (const k of Object.keys(data)) t.set(k, data[k]);
  }
  return t;
}

// "#rrggbb" -> {r,g,b} floats 0..1 (matches Godot Color.from_string usage).
export function parseColor(v) {
  if (typeof v !== "string") return { r: 1, g: 1, b: 1 };
  let s = v.replace("#", "");
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  return { r: r || 0, g: g || 0, b: b || 0, css: "#" + s };
}
