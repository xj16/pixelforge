using Godot;
using Godot.Collections;
using PixelForge.Core;

namespace PixelForge;

/// <summary>
/// Godot-facing adapter over <see cref="DamageCalculator"/>. A single instance
/// is added to the scene tree (see <c>World.gd</c>) and used by every attack
/// resolution. The arithmetic itself lives in the Godot-free
/// <c>PixelForge.Core</c> assembly so it is unit-tested in CI; this class only
/// marshals Godot <c>Dictionary</c> values in and out.
/// </summary>
public partial class CombatResolver : Node
{
    private readonly DamageCalculator _calc = new();

    /// <summary>Seed the deterministic RNG so crit rolls are reproducible.</summary>
    public void Seed(ulong seed) => _calc.Reseed(seed);

    /// <summary>Register or override a global element multiplier (used by mods).</summary>
    public void SetElementScale(string element, float scale) => _calc.SetElementScale(element, scale);

    /// <summary>
    /// Resolve one attack described by a Godot Dictionary and return the
    /// outcome as a Dictionary (so GDScript needs no custom Resource type).
    /// See <c>DamageCalculator</c> for the accepted keys.
    /// </summary>
    public Dictionary Resolve(Dictionary attack)
    {
        var input = new AttackInput
        {
            BaseDamage = GetFloat(attack, "base_damage", 0f),
            Element = attack.ContainsKey("element") ? (string)attack["element"] : "physical",
            CritChance = GetFloat(attack, "crit_chance", 0f),
            CritMult = GetFloat(attack, "crit_mult", 1.75f),
            Armor = GetFloat(attack, "armor", 0f),
            Resist = GetFloat(attack, "resist", 0f),
            Variance = GetFloat(attack, "variance", 0f),
        };

        DamageResult r = _calc.Resolve(input);
        return new Dictionary
        {
            { "amount", r.Amount },
            { "is_crit", r.IsCrit },
            { "element", r.Element },
            { "blocked", r.Blocked },
        };
    }

    private static float GetFloat(Dictionary d, string key, float fallback)
    {
        if (!d.ContainsKey(key))
            return fallback;
        Variant v = d[key];
        return v.VariantType switch
        {
            Variant.Type.Int => (int)v,
            Variant.Type.Float => (float)v,
            _ => fallback,
        };
    }
}
