namespace PixelForge.Core;

/// <summary>Result of resolving a single attack.</summary>
public readonly record struct DamageResult(int Amount, bool IsCrit, string Element, bool Blocked);

/// <summary>Inputs for a single attack resolution.</summary>
public struct AttackInput
{
    public float BaseDamage;
    public string Element;
    public float CritChance;   // 0..1
    public float CritMult;     // multiplier on crit
    public float Armor;        // flat mitigation, applied last
    public float Resist;       // 0..0.95 fractional element mitigation
    public float Variance;     // 0..1 +/- spread

    public AttackInput()
    {
        BaseDamage = 0f;
        Element = "physical";
        CritChance = 0f;
        CritMult = 1.75f;
        Armor = 0f;
        Resist = 0f;
        Variance = 0f;
    }
}

/// <summary>
/// Pure, deterministic damage math shared by the whole game. Lives in a
/// Godot-free assembly so it can be unit-tested on a plain .NET runner. The
/// Godot <c>CombatResolver</c> node is a thin adapter over this type.
/// </summary>
public sealed class DamageCalculator
{
    private readonly Dictionary<string, float> _elementScale = new()
    {
        { "physical", 1.0f },
        { "fire", 1.0f },
        { "frost", 1.0f },
        { "shock", 1.0f },
    };

    private readonly DeterministicRng _rng;

    /// <summary>
    /// Ongoing status effects (frost slow, burn DoT) driven by element hits.
    /// Exposed so the game and mods can tick/apply effects through the same
    /// deterministic engine the combat math uses.
    /// </summary>
    public StatusEngine Status { get; } = new();

    public DamageCalculator(ulong seed = 0) => _rng = new DeterministicRng(seed);

    public void Reseed(ulong seed) => _rng.Reseed(seed);

    /// <summary>Register or override a global multiplier for an element.</summary>
    public void SetElementScale(string element, float scale)
        => _elementScale[element] = scale < 0f ? 0f : scale;

    public float GetElementScale(string element)
        => _elementScale.TryGetValue(element, out float s) ? s : 1.0f;

    /// <summary>
    /// Resolve an attack and, if it landed and its element carries a status
    /// recipe, apply that status to <paramref name="targetActorId"/>. Returns the
    /// same <see cref="DamageResult"/> as <see cref="Resolve"/>. This is the
    /// single call the combat pipeline uses so damage and status stay in lockstep.
    /// </summary>
    public DamageResult ResolveAndApply(in AttackInput attack, int targetActorId)
    {
        DamageResult r = Resolve(attack);
        if (!r.Blocked)
            Status.ApplyElement(targetActorId, r.Element);
        return r;
    }

    public DamageResult Resolve(in AttackInput attack)
    {
        float critChance = Clamp01(attack.CritChance);
        float resist = Clamp(attack.Resist, 0f, 0.95f);
        float variance = Clamp01(attack.Variance);
        float elementScale = GetElementScale(attack.Element ?? "physical");

        bool isCrit = _rng.NextFloat() < critChance;
        float raw = attack.BaseDamage * elementScale;
        if (isCrit)
            raw *= attack.CritMult;

        if (variance > 0f)
        {
            float spread = (_rng.NextFloat() * 2f - 1f) * variance;
            raw *= (1f + spread);
        }

        float afterResist = raw * (1f - resist);
        float final = afterResist - attack.Armor;
        if (final < 0f) final = 0f;

        int amount = (int)MathF.Round(final);
        return new DamageResult(amount, isCrit, attack.Element ?? "physical", amount <= 0);
    }

    private static float Clamp01(float v) => v < 0f ? 0f : (v > 1f ? 1f : v);
    private static float Clamp(float v, float lo, float hi) => v < lo ? lo : (v > hi ? hi : v);
}
