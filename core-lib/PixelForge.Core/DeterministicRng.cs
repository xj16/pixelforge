namespace PixelForge.Core;

/// <summary>
/// Xorshift64* deterministic PRNG. Fast, allocation-free, and reproducible
/// across platforms — the same seed always yields the same stream, which is
/// what makes crit rolls and enemy spawns replayable.
/// </summary>
public sealed class DeterministicRng
{
    private ulong _state;

    public DeterministicRng(ulong seed = 0)
    {
        // Avoid the all-zero fixed point of xorshift.
        _state = seed == 0 ? 0x9E3779B97F4A7C15UL : seed;
    }

    public void Reseed(ulong seed)
    {
        _state = seed == 0 ? 0x9E3779B97F4A7C15UL : seed;
    }

    public ulong NextUlong()
    {
        _state ^= _state >> 12;
        _state ^= _state << 25;
        _state ^= _state >> 27;
        return _state * 0x2545F4914F6CDD1DUL;
    }

    /// <summary>Uniform float in [0, 1) built from the top 24 mantissa bits.</summary>
    public float NextFloat() => (NextUlong() >> 40) / 16777216.0f;

    /// <summary>Uniform integer in [minInclusive, maxExclusive).</summary>
    public int NextInt(int minInclusive, int maxExclusive)
    {
        if (maxExclusive <= minInclusive)
            return minInclusive;
        ulong range = (ulong)(maxExclusive - minInclusive);
        return minInclusive + (int)(NextUlong() % range);
    }
}
