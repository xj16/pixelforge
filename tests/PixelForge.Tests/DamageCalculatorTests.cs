using PixelForge.Core;
using Xunit;

namespace PixelForge.Tests;

public class DamageCalculatorTests
{
    [Fact]
    public void BasePhysicalDamage_RoundsToNearestInt()
    {
        var calc = new DamageCalculator(seed: 1);
        var result = calc.Resolve(new AttackInput { BaseDamage = 12.4f });
        Assert.Equal(12, result.Amount);
        Assert.Equal("physical", result.Element);
        Assert.False(result.Blocked);
    }

    [Fact]
    public void Armor_IsAppliedAfterMultipliers_AndClampsAtZero()
    {
        var calc = new DamageCalculator(seed: 2);
        var result = calc.Resolve(new AttackInput { BaseDamage = 10f, Armor = 25f });
        Assert.Equal(0, result.Amount);
        Assert.True(result.Blocked);
    }

    [Fact]
    public void Resistance_HalvesDamage_AtFiftyPercent()
    {
        var calc = new DamageCalculator(seed: 3);
        var result = calc.Resolve(new AttackInput { BaseDamage = 100f, Resist = 0.5f });
        Assert.Equal(50, result.Amount);
    }

    [Fact]
    public void ResistanceAboveCap_IsClampedToNinetyFivePercent()
    {
        var calc = new DamageCalculator(seed: 4);
        var result = calc.Resolve(new AttackInput { BaseDamage = 100f, Resist = 5.0f });
        // Clamped to 0.95 -> 5 damage remains.
        Assert.Equal(5, result.Amount);
    }

    [Fact]
    public void ElementScale_MultipliesDamage()
    {
        var calc = new DamageCalculator(seed: 5);
        calc.SetElementScale("fire", 2.0f);
        var result = calc.Resolve(new AttackInput { BaseDamage = 30f, Element = "fire" });
        Assert.Equal(60, result.Amount);
    }

    [Fact]
    public void GuaranteedCrit_AppliesCritMultiplier()
    {
        var calc = new DamageCalculator(seed: 6);
        var result = calc.Resolve(new AttackInput
        {
            BaseDamage = 40f,
            CritChance = 1.0f, // always crit
            CritMult = 2.0f,
        });
        Assert.True(result.IsCrit);
        Assert.Equal(80, result.Amount);
    }

    [Fact]
    public void ZeroCritChance_NeverCrits()
    {
        var calc = new DamageCalculator(seed: 7);
        for (int i = 0; i < 200; i++)
        {
            var r = calc.Resolve(new AttackInput { BaseDamage = 10f, CritChance = 0f });
            Assert.False(r.IsCrit);
        }
    }

    [Fact]
    public void SameSeed_ProducesIdenticalCritSequence()
    {
        var a = new DamageCalculator(seed: 12345);
        var b = new DamageCalculator(seed: 12345);
        for (int i = 0; i < 50; i++)
        {
            var ra = a.Resolve(new AttackInput { BaseDamage = 10f, CritChance = 0.5f, CritMult = 2f });
            var rb = b.Resolve(new AttackInput { BaseDamage = 10f, CritChance = 0.5f, CritMult = 2f });
            Assert.Equal(ra.IsCrit, rb.IsCrit);
            Assert.Equal(ra.Amount, rb.Amount);
        }
    }

    [Fact]
    public void UnknownElement_DefaultsToScaleOne()
    {
        var calc = new DamageCalculator(seed: 8);
        var result = calc.Resolve(new AttackInput { BaseDamage = 20f, Element = "void" });
        Assert.Equal(20, result.Amount);
    }
}
