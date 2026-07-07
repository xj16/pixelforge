// Deterministic damage math — a JS port of PixelForge.Core's DamageCalculator.cs.
// The arithmetic mirrors the C# exactly (same clamps, same rounding), and it
// drives the shared StatusEngine so element hits inflict slow/burn.

import { DeterministicRng } from "./rng.js";
import { StatusEngine } from "./status.js";

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// C# uses MathF.Round (banker's rounding / round-half-to-even).
function roundHalfEven(x) {
  const f = Math.floor(x);
  const diff = x - f;
  if (diff < 0.5) return f;
  if (diff > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

export class DamageCalculator {
  constructor(seed = 0n) {
    this._rng = new DeterministicRng(seed);
    this._elementScale = new Map([
      ["physical", 1.0],
      ["fire", 1.0],
      ["frost", 1.0],
      ["shock", 1.0],
    ]);
    this.status = new StatusEngine();
  }

  reseed(seed) {
    this._rng.reseed(seed);
  }

  setElementScale(element, scale) {
    this._elementScale.set(element, scale < 0 ? 0 : scale);
  }

  getElementScale(element) {
    return this._elementScale.has(element) ? this._elementScale.get(element) : 1.0;
  }

  // attack: { baseDamage, element, critChance, critMult, armor, resist, variance }
  resolve(attack) {
    const a = {
      baseDamage: attack.baseDamage ?? 0,
      element: attack.element ?? "physical",
      critChance: attack.critChance ?? 0,
      critMult: attack.critMult ?? 1.75,
      armor: attack.armor ?? 0,
      resist: attack.resist ?? 0,
      variance: attack.variance ?? 0,
    };
    const critChance = clamp01(a.critChance);
    const resist = clamp(a.resist, 0, 0.95);
    const variance = clamp01(a.variance);
    const elementScale = this.getElementScale(a.element);

    const isCrit = this._rng.nextFloat() < critChance;
    let raw = a.baseDamage * elementScale;
    if (isCrit) raw *= a.critMult;

    if (variance > 0) {
      const spread = (this._rng.nextFloat() * 2 - 1) * variance;
      raw *= 1 + spread;
    }

    const afterResist = raw * (1 - resist);
    let final = afterResist - a.armor;
    if (final < 0) final = 0;

    const amount = roundHalfEven(final);
    return { amount, isCrit, element: a.element, blocked: amount <= 0 };
  }

  // Resolve and, if it landed, apply the element's status to the target actor.
  resolveAndApply(attack, targetActorId) {
    const r = this.resolve(attack);
    if (!r.blocked) this.status.applyElement(targetActorId, r.element);
    return r;
  }
}
