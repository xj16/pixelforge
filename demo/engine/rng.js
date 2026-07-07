// Xorshift64* deterministic PRNG — a faithful JS port of PixelForge.Core's
// DeterministicRng.cs. Same seed => same stream, so crit rolls and spawns are
// reproducible across the C# game and this browser demo alike.
//
// C# uses ulong (64-bit) arithmetic; JS numbers can't hold that precisely, so
// we use BigInt for the state and mask to 64 bits after every op.

const MASK64 = (1n << 64n) - 1n;
const SEED_FALLBACK = 0x9e3779b97f4a7c15n;
const MULT = 0x2545f4914f6cdd1dn;

export class DeterministicRng {
  constructor(seed = 0n) {
    this.reseed(seed);
  }

  reseed(seed) {
    const s = BigInt(seed) & MASK64;
    this._state = s === 0n ? SEED_FALLBACK : s;
  }

  nextUlong() {
    let x = this._state;
    x ^= (x >> 12n) & MASK64;
    x ^= (x << 25n) & MASK64;
    x ^= (x >> 27n) & MASK64;
    this._state = x & MASK64;
    return (this._state * MULT) & MASK64;
  }

  // Uniform float in [0,1) from the top 24 mantissa bits — matches C#.
  nextFloat() {
    const top = Number(this.nextUlong() >> 40n); // 24-bit value
    return top / 16777216.0;
  }

  // Uniform int in [minInclusive, maxExclusive).
  nextInt(minInclusive, maxExclusive) {
    if (maxExclusive <= minInclusive) return minInclusive;
    const range = BigInt(maxExclusive - minInclusive);
    return minInclusive + Number(this.nextUlong() % range);
  }
}
