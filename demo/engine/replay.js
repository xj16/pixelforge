// Deterministic replay recorder — a JS port of PixelForge.Core's ReplayRecorder.cs.
// Stores the startup seed + a delta-compressed per-frame input stream so a run is
// exactly reproducible. Combined with the seeded RNG and the pure StatusEngine,
// replaying the same seed + inputs reproduces every crit and DoT tick.

export const MAGIC = "PXFREPLAY";
export const FORMAT_VERSION = 1;

export const Button = Object.freeze({
  Left: 1 << 0, Right: 1 << 1, Jump: 1 << 2, Attack: 1 << 3, Dash: 1 << 4,
});

export function inputToBits(input) {
  let b = 0;
  if (input.left) b |= Button.Left;
  if (input.right) b |= Button.Right;
  if (input.jump) b |= Button.Jump;
  if (input.attack) b |= Button.Attack;
  if (input.dash) b |= Button.Dash;
  return b >>> 0;
}

export function bitsToInput(bits) {
  return {
    left: !!(bits & Button.Left),
    right: !!(bits & Button.Right),
    jump: !!(bits & Button.Jump),
    attack: !!(bits & Button.Attack),
    dash: !!(bits & Button.Dash),
    jumpReleased: false,
  };
}

export class ReplayRecorder {
  constructor(seed) {
    this.seed = BigInt(seed);
    this.frames = [];  // {frame, bits}
    this._last = 0;
    this._any = false;
  }

  record(frame, bits) {
    bits = bits >>> 0;
    if (!this._any || bits !== this._last) {
      this.frames.push({ frame, bits });
      this._last = bits;
      this._any = true;
    }
  }

  get frameCount() { return this.frames.length; }

  serialize() {
    let out = `${MAGIC} ${FORMAT_VERSION}\n` + `seed ${this.seed}\n`;
    for (const f of this.frames) out += `${f.frame} ${f.bits}\n`;
    return out;
  }

  static deserialize(text) {
    const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.length);
    if (lines.length < 2 || !lines[0].startsWith(MAGIC)) throw new Error("not a PixelForge replay");
    const seedParts = lines[1].split(" ").filter(Boolean);
    if (seedParts.length !== 2 || seedParts[0] !== "seed") throw new Error("missing or invalid seed line");
    const rec = new ReplayRecorder(BigInt(seedParts[1]));
    for (let i = 2; i < lines.length; i++) {
      const p = lines[i].split(" ").filter(Boolean);
      if (p.length !== 2) continue;
      rec.frames.push({ frame: parseInt(p[0], 10), bits: (parseInt(p[1], 10) >>> 0) });
    }
    return rec;
  }

  // Expand to per-frame bits, holding the last state between change-frames.
  expand(frameCount) {
    const out = new Array(Math.max(0, frameCount)).fill(0);
    let cur = 0, idx = 0;
    for (let f = 0; f < out.length; f++) {
      while (idx < this.frames.length && this.frames[idx].frame === f) { cur = this.frames[idx].bits; idx++; }
      out[f] = cur;
    }
    return out;
  }
}
