// Core-math tests for the JS engine twin. These mirror the C# xUnit suite so the
// browser demo and the Godot game agree on every deterministic value.

import { test } from "node:test";
import assert from "node:assert/strict";
import { DeterministicRng } from "../../demo/engine/rng.js";
import { DamageCalculator } from "../../demo/engine/damage.js";
import { StatusEngine, StatusKind } from "../../demo/engine/status.js";
import { AStarPathfinder } from "../../demo/engine/astar.js";
import { ReplayRecorder } from "../../demo/engine/replay.js";
import { parseManifest } from "../../demo/engine/manifest.js";

// --- RNG ---
test("same seed produces an identical RNG stream", () => {
  const a = new DeterministicRng(12345n);
  const b = new DeterministicRng(12345n);
  for (let i = 0; i < 100; i++) assert.equal(a.nextUlong(), b.nextUlong());
});

test("nextFloat stays within [0,1)", () => {
  const r = new DeterministicRng(9n);
  for (let i = 0; i < 1000; i++) {
    const v = r.nextFloat();
    assert.ok(v >= 0 && v < 1, "out of range: " + v);
  }
});

// --- DamageCalculator (parity with DamageCalculatorTests.cs) ---
test("armor is applied after multipliers and clamps at zero", () => {
  const c = new DamageCalculator(2n);
  const r = c.resolve({ baseDamage: 10, armor: 25 });
  assert.equal(r.amount, 0);
  assert.ok(r.blocked);
});

test("resistance halves damage at 50%", () => {
  const c = new DamageCalculator(3n);
  assert.equal(c.resolve({ baseDamage: 100, resist: 0.5 }).amount, 50);
});

test("resistance above cap is clamped to 95%", () => {
  const c = new DamageCalculator(4n);
  assert.equal(c.resolve({ baseDamage: 100, resist: 5.0 }).amount, 5);
});

test("element scale multiplies damage", () => {
  const c = new DamageCalculator(5n);
  c.setElementScale("fire", 2.0);
  assert.equal(c.resolve({ baseDamage: 30, element: "fire" }).amount, 60);
});

test("guaranteed crit applies the crit multiplier", () => {
  const c = new DamageCalculator(6n);
  const r = c.resolve({ baseDamage: 40, critChance: 1.0, critMult: 2.0 });
  assert.ok(r.isCrit);
  assert.equal(r.amount, 80);
});

test("zero crit chance never crits", () => {
  const c = new DamageCalculator(7n);
  for (let i = 0; i < 200; i++) assert.equal(c.resolve({ baseDamage: 10, critChance: 0 }).isCrit, false);
});

test("same seed reproduces the crit+amount sequence", () => {
  const a = new DamageCalculator(999n), b = new DamageCalculator(999n);
  for (let i = 0; i < 50; i++) {
    const ra = a.resolve({ baseDamage: 10, critChance: 0.5, critMult: 2 });
    const rb = b.resolve({ baseDamage: 10, critChance: 0.5, critMult: 2 });
    assert.equal(ra.isCrit, rb.isCrit);
    assert.equal(ra.amount, rb.amount);
  }
});

test("resolveAndApply applies the element status on a landed hit", () => {
  const c = new DamageCalculator(1n);
  const r = c.resolveAndApply({ baseDamage: 20, element: "frost" }, 7);
  assert.ok(!r.blocked);
  assert.equal(c.status.activeCount(7), 1);
});

// --- StatusEngine ---
test("frost slow reduces the speed factor and expires", () => {
  const s = new StatusEngine();
  s.apply(1, { kind: StatusKind.Slow, magnitude: 0.4, duration: 1.0, interval: 0 });
  let t = s.tick(1, 0.5);
  assert.ok(Math.abs(t.speedFactor - 0.6) < 1e-6, "40% slow => 0.6, got " + t.speedFactor);
  t = s.tick(1, 0.6); // now expired
  assert.equal(s.activeCount(1), 0);
});

test("burn deals damage every interval and stacks additively", () => {
  const s = new StatusEngine();
  s.apply(2, { kind: StatusKind.Burn, magnitude: 3, duration: 2.0, interval: 0.5 });
  let total = 0;
  for (let i = 0; i < 4; i++) total += s.tick(2, 0.5).damage; // 4 ticks in 2s
  assert.equal(total, 12, "3 dmg x 4 ticks");
});

test("multiple slows compound multiplicatively", () => {
  const s = new StatusEngine();
  s.apply(3, { kind: StatusKind.Slow, magnitude: 0.5, duration: 5, interval: 0 });
  s.apply(3, { kind: StatusKind.Slow, magnitude: 0.5, duration: 5, interval: 0 });
  const t = s.tick(3, 0.1);
  assert.ok(Math.abs(t.speedFactor - 0.25) < 1e-6, "0.5*0.5 => 0.25, got " + t.speedFactor);
});

// --- A* (parity with AStarPathfinderTests.cs) ---
test("straight line returns the shortest path (start-exclusive)", () => {
  const g = new AStarPathfinder(5, 1, true);
  const p = g.findPath(0, 0, 4, 0);
  assert.equal(p.length, 4);
  assert.deepEqual(p[p.length - 1], { x: 4, y: 0 });
});

test("no diagonal corner cutting", () => {
  const g = new AStarPathfinder(2, 2, true);
  g.setBlocked(1, 0, true);
  g.setBlocked(0, 1, true);
  assert.equal(g.findPath(0, 0, 1, 1).length, 0);
});

test("walker requires ground beneath", () => {
  const w = new AStarPathfinder(5, 2, false);
  assert.equal(w.findPath(0, 0, 4, 0).length, 0);
  for (let x = 0; x < 5; x++) w.setGroundBelow(x, 0, true);
  assert.ok(w.findPath(0, 0, 4, 0).length > 0);
});

test("re-running the same query is stable (pooled buffers reset correctly)", () => {
  const g = new AStarPathfinder(6, 6, true);
  g.setBlocked(3, 0, true); g.setBlocked(3, 1, true); g.setBlocked(3, 2, true);
  const a = g.findPath(0, 0, 5, 0);
  const b = g.findPath(0, 0, 5, 0);
  assert.deepEqual(a, b, "generational stamp must yield identical repeat results");
});

// --- Replay (parity with ReplayRecorder.cs) ---
test("replay serializes, round-trips, and expands with delta compression", () => {
  const rec = new ReplayRecorder(123n);
  rec.record(0, 0b1);   // left held
  rec.record(5, 0b11);  // left+right
  rec.record(10, 0);    // released
  const text = rec.serialize();
  const back = ReplayRecorder.deserialize(text);
  assert.equal(back.seed, 123n);
  assert.equal(back.frameCount, 3);
  const bits = back.expand(12);
  assert.equal(bits[0], 0b1);
  assert.equal(bits[4], 0b1, "state holds between change-frames");
  assert.equal(bits[5], 0b11);
  assert.equal(bits[10], 0);
});

test("deserialize rejects a corrupt header", () => {
  assert.throws(() => ReplayRecorder.deserialize("garbage\nnope"), /replay/);
});

// --- Manifest (parity with ModManifestValidatorTests.cs) ---
test("valid manifest parses; bad ones are rejected with a reason", () => {
  assert.ok(parseManifest('{"id":"frost_slime","name":"Frost"}').manifest);
  assert.match(parseManifest('{"name":"x"}').error, /id/);
  assert.match(parseManifest('{"id":"FrostSlime","name":"x"}').error, /id/);
  assert.match(parseManifest('{"id":"evil","name":"x","entry":"../a.lua"}').error, /entry/);
  assert.match(parseManifest('{"id":"bad","name":"x","entry":"main.py"}').error, /entry/);
  assert.match(parseManifest("{ not json ").error, /JSON/);
  assert.equal(parseManifest('{"id":"ok","name":"x"}').manifest.entry, "main.lua");
});

// Golden check: every bundled mod's manifest must be valid.
test("every bundled mod manifest is valid (golden)", async () => {
  const { BUNDLED_MODS } = await import("../../demo/engine/mods.generated.js");
  for (const m of BUNDLED_MODS) {
    const { manifest, error } = parseManifest(m.manifestJson);
    assert.ok(manifest, `bundled mod invalid: ${error} :: ${m.manifestJson}`);
  }
});
