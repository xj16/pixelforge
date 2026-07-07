// Status effects (frost slow, burn DoT) — a JS port of PixelForge.Core's
// StatusEngine.cs. Pure and deterministic: no RNG, so replaying the same applied
// effects and delta sequence reproduces the tick damage and speed factors.

export const StatusKind = Object.freeze({ Slow: "slow", Burn: "burn" });

export class StatusEngine {
  constructor() {
    this._actors = new Map(); // actorId -> [effect]
    this._recipes = new Map([
      ["frost", { kind: StatusKind.Slow, magnitude: 0.4, duration: 2.0, interval: 0, source: "frost" }],
      ["fire", { kind: StatusKind.Burn, magnitude: 3, duration: 2.0, interval: 0.5, source: "fire" }],
    ]);
  }

  setElementStatus(element, effect) {
    this._recipes.set(element, { ...effect, source: element });
  }

  hasElementStatus(element) {
    return this._recipes.has(element);
  }

  getElementStatus(element) {
    return this._recipes.get(element) ?? null;
  }

  apply(actorId, effect) {
    if (!effect || effect.duration <= 0) return;
    let list = this._actors.get(actorId);
    if (!list) {
      list = [];
      this._actors.set(actorId, list);
    }
    list.push({
      kind: effect.kind,
      magnitude: effect.magnitude,
      remaining: effect.duration,
      interval: effect.interval && effect.interval > 0 ? effect.interval : 0.5,
      sinceTick: 0,
      source: effect.source ?? "",
    });
  }

  applyElement(actorId, element) {
    const recipe = this._recipes.get(element);
    if (!recipe) return false;
    this.apply(actorId, recipe);
    return true;
  }

  activeCount(actorId) {
    const list = this._actors.get(actorId);
    return list ? list.length : 0;
  }

  clear(actorId) {
    this._actors.delete(actorId);
  }

  // Advance an actor by delta seconds; return { damage, speedFactor }.
  tick(actorId, delta) {
    if (delta < 0) delta = 0;
    const list = this._actors.get(actorId);
    if (!list || list.length === 0) return { damage: 0, speedFactor: 1.0 };

    let damage = 0;
    let speedFactor = 1.0;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.remaining -= delta;

      if (e.kind === StatusKind.Slow) {
        const slow = e.magnitude < 0 ? 0 : e.magnitude > 0.95 ? 0.95 : e.magnitude;
        speedFactor *= 1 - slow;
      } else if (e.kind === StatusKind.Burn) {
        e.sinceTick += delta;
        while (e.sinceTick >= e.interval) {
          e.sinceTick -= e.interval;
          const dmg = Math.round(e.magnitude);
          if (dmg > 0) damage += dmg;
        }
      }

      if (e.remaining <= 0) list.splice(i, 1);
    }

    if (list.length === 0) this._actors.delete(actorId);
    if (speedFactor < 0.05) speedFactor = 0.05;
    return { damage, speedFactor };
  }
}
