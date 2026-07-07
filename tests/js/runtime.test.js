// FLAGSHIP TEST: exercises the whole modding runtime end-to-end against the REAL
// bundled mods — the subsystem that the Godot CI never actually executes. This
// is the JS twin of ModLoader/ModApi, so the same contract (sandbox, hot-reload,
// registration ownership, budget enforcement) is verified on every push.

import { test } from "node:test";
import assert from "node:assert/strict";
import { GameEngine } from "../../demo/engine/game-engine.js";
import { BUNDLED_MODS } from "../../demo/engine/mods.generated.js";
import { LuaTable } from "../../demo/engine/lua-lite.js";

function bootedEngine(seed = 42n) {
  const engine = new GameEngine({ seed });
  for (const m of BUNDLED_MODS) engine.loader.addMod(m);
  engine.loader.reloadAll();
  return engine;
}

test("all three bundled mods load with no errors", () => {
  const engine = bootedEngine();
  const errors = engine.loader.mods.filter((m) => m.error);
  assert.equal(errors.length, 0, "errors: " + JSON.stringify(errors.map((m) => [m.id, m.error])));
  const active = engine.loader.mods.filter((m) => m.enabled && !m.error).map((m) => m.id).sort();
  assert.deepEqual(active, ["frost_slime", "hard_mode", "healing_orb"]);
});

test("frost_slime registers its archetype and frost element/status", () => {
  const engine = bootedEngine();
  const rt = engine.loader.runtime;
  assert.ok(rt.enemyArchetypes.has("frost_slime"), "frost_slime archetype registered");
  const arch = rt.enemyArchetypes.get("frost_slime");
  assert.equal(arch.element, "frost");
  assert.equal(arch.maxHealth, 30);
  assert.ok(arch.think, "frost_slime supplied a Lua think brain");
  // register_element + register_status wired through to the combat engine.
  assert.equal(engine.combat.getElementScale("frost"), 1.25);
  assert.ok(engine.combat.status.hasElementStatus("frost"));
  assert.equal(engine.combat.status.getElementStatus("frost").kind, "slow");
});

test("healing_orb registers an item with a working on_collect", () => {
  const engine = bootedEngine();
  const def = engine.loader.runtime.itemDefs.get("healing_orb");
  assert.ok(def, "healing_orb item registered");
  assert.ok(def.onCollect, "on_collect present");
  // Drive on_collect directly with a wounded player snapshot.
  const state = new LuaTable();
  state.set("health", 50);
  state.set("max_health", 100);
  const res = engine.loader.runtime.callGuarded(def._interp, def.onCollect, [state], "healing_orb", "on_collect");
  const eff = res.toJS();
  assert.ok(eff.heal >= 10 && eff.heal <= 35, "heal in [10,35], got " + eff.heal);
  assert.match(String(eff.message), /Healing Orb/);
});

test("a mod-supplied think brain returns a valid action shape", () => {
  const engine = bootedEngine();
  const arch = engine.loader.runtime.enemyArchetypes.get("frost_slime");
  const ctx = new LuaTable();
  const selfPos = new LuaTable(); selfPos.set("x", 100); selfPos.set("y", 50);
  const targetPos = new LuaTable(); targetPos.set("x", 40); targetPos.set("y", 50); // player to the left
  ctx.set("self_pos", selfPos);
  ctx.set("target_pos", targetPos);
  ctx.set("on_floor", true);
  ctx.set("state", new LuaTable());
  const action = engine.loader.runtime.callGuarded(arch._interp, arch.think, [ctx], "frost_slime", "think");
  assert.ok(action instanceof LuaTable, "think returned a table");
  assert.equal(action.get("move_x"), -1, "chases left toward the player");
  assert.equal(typeof action.get("jump"), "boolean");
  assert.ok(action.get("state") instanceof LuaTable, "persisted state table returned");
});

test("hard_mode changes global config through the API", () => {
  const engine = bootedEngine();
  assert.equal(engine.config.enemyDamageScale, 1.5);
  assert.equal(engine.config.enemyHealthScale, 1.35);
});

test("hard_mode's event subscription fires on player_damaged", () => {
  const engine = bootedEngine();
  engine.reset();
  const before = engine.loader.runtime.logs.length;
  engine.emit("player_damaged", { amount: 7, health: 93 });
  const after = engine.loader.runtime.logs.slice(before);
  assert.ok(after.some((l) => l.modId === "hard_mode" && /player took 7 damage/.test(l.msg)),
    "hard_mode logged the damage event");
});

test("disabling a mod forgets ALL its registrations (hot-reload cleanliness)", () => {
  const engine = bootedEngine();
  assert.ok(engine.loader.runtime.enemyArchetypes.has("frost_slime"));
  engine.loader.setModEnabled("frost_slime", false);
  assert.ok(!engine.loader.runtime.enemyArchetypes.has("frost_slime"), "archetype forgotten");
  // Re-enable restores it (fresh sandbox).
  engine.loader.setModEnabled("frost_slime", true);
  assert.ok(engine.loader.runtime.enemyArchetypes.has("frost_slime"), "archetype restored on re-enable");
});

test("a path-traversal entry is rejected by manifest validation", () => {
  const engine = bootedEngine();
  engine.loader.addMod({
    origin: "user",
    manifestJson: JSON.stringify({ id: "evil", name: "Evil", entry: "../../secrets.lua" }),
    luaSource: "game.log('should never run')",
  });
  engine.loader.reloadAll();
  const evil = engine.loader.getMod("evil");
  assert.ok(evil, "evil mod discovered");
  assert.ok(evil.error, "rejected with an error: " + evil.error);
  assert.match(evil.error, /entry/);
});

test("an infinite-loop mod is aborted by the budget, not run forever", () => {
  const engine = bootedEngine();
  engine.loader.addMod({
    origin: "user",
    manifestJson: JSON.stringify({ id: "hang", name: "Hang", entry: "main.lua" }),
    luaSource: "while true do end",
  });
  const t0 = Date.now();
  engine.loader.reloadAll();
  const elapsed = Date.now() - t0;
  const hang = engine.loader.getMod("hang");
  assert.ok(hang.error, "hang mod reported an error");
  assert.match(hang.error, /budget/i);
  assert.ok(elapsed < 2000, "aborted quickly (" + elapsed + "ms), did not hang");
  // The rest of the game still works: other mods are intact.
  assert.ok(engine.loader.runtime.enemyArchetypes.has("frost_slime"));
});

test("a think brain that loops forever is caught mid-frame and the mod disabled", () => {
  const engine = bootedEngine();
  engine.loader.addMod({
    origin: "user",
    manifestJson: JSON.stringify({ id: "loopai", name: "LoopAI", entry: "main.lua" }),
    luaSource: `game.register_enemy({ id="looper", name="Looper", think=function(ctx)
        while true do end
      end })`,
  });
  engine.loader.reloadAll();
  engine.reset();
  // Step the sim; the looper's think will blow its budget but must not hang.
  const t0 = Date.now();
  for (let i = 0; i < 30; i++) engine.step(1 / 60, { left: false, right: false, jump: false, attack: false, dash: false, jumpReleased: false });
  assert.ok(Date.now() - t0 < 3000, "sim did not hang on a runaway think");
  const looper = engine.loader.getMod("loopai");
  assert.ok(looper.error, "runaway think disabled the mod: " + looper.error);
});

test("frost slow is applied to an enemy when the player strikes it", () => {
  const engine = bootedEngine();
  engine.reset();
  const slime = engine.enemies.find((e) => e.arch.id === "frost_slime");
  assert.ok(slime, "a frost_slime spawned");
  slime.takeHit(engine.player);
  assert.ok(slime.health < slime.arch.maxHealth, "took damage");
  assert.equal(engine.combat.status.activeCount(slime.actorId), 1, "one status effect applied");
  const st = engine.tickStatus(slime.actorId, 1 / 60);
  assert.ok(st.speedFactor < 1.0, "enemy is slowed, factor=" + st.speedFactor);
});
