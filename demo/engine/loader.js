// ModLoader (JS twin of src/modding/ModLoader.gd): discovers mods from an
// in-memory registry, validates each manifest through the SAME rules as the C#
// ModManifestValidator, sandboxes valid ones, and hot-reloads on demand.

import { parseManifest } from "./manifest.js";
import { ModRuntime } from "./runtime.js";

export class ModLoader {
  constructor(engine, opts = {}) {
    this.engine = engine;
    this.runtime = new ModRuntime(engine, opts);
    this.mods = [];            // [{id,name,version,author,description,entry,source,enabled,error,interp}]
    this._disabled = new Set();
    this._registry = [];       // [{manifestJson, source(lua), dir, origin}]
  }

  // Register a mod's raw files (mod.json text + main.lua text). `origin` is
  // "builtin" or "user" for display.
  addMod({ manifestJson, luaSource, origin = "user" }) {
    this._registry.push({ manifestJson, luaSource, origin });
  }

  // Replace a user mod's source (the live editor path).
  setUserMod(id, { manifestJson, luaSource }) {
    const existing = this._registry.find((r) => r.origin === "user" && safeId(r.manifestJson) === id);
    if (existing) { existing.manifestJson = manifestJson; existing.luaSource = luaSource; }
    else this.addMod({ manifestJson, luaSource, origin: "user" });
  }

  setModEnabled(id, enabled) {
    if (enabled) this._disabled.delete(id);
    else this._disabled.add(id);
    this.reloadAll();
  }

  getMod(id) { return this.mods.find((m) => m.id === id) ?? null; }

  reloadAll() {
    // Tear down existing sandboxes first (true hot-reload).
    for (const m of this.mods) if (m.interp) this.runtime.unloadMod(m);
    this.mods = [];

    for (const rec of this._registry) {
      const { manifest, error } = parseManifest(rec.manifestJson);
      const mod = manifest
        ? {
            id: manifest.id, name: manifest.name, version: manifest.version,
            author: manifest.author, description: manifest.description,
            entry: manifest.entry, source: rec.luaSource, origin: rec.origin,
            enabled: true, error: "", interp: null,
          }
        : {
            id: safeId(rec.manifestJson) || "invalid", name: "(invalid manifest)",
            version: "0.0.0", author: "", description: "", entry: "main.lua",
            source: rec.luaSource, origin: rec.origin, enabled: false,
            error, interp: null,
          };

      if (this._disabled.has(mod.id)) mod.enabled = false;
      this.mods.push(mod);
      if (mod.enabled && !mod.error) this.runtime.loadMod(mod);
    }

    const active = this.mods.filter((m) => m.enabled && !m.error).map((m) => m.id);
    if (this.engine.onModsReloaded) this.engine.onModsReloaded(active);
    return active;
  }
}

// Best-effort id peek for display when a manifest is otherwise invalid.
function safeId(json) {
  try { const o = JSON.parse(json); return typeof o.id === "string" ? o.id : ""; }
  catch { return ""; }
}
