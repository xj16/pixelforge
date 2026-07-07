using PixelForge.Core;
using Xunit;

namespace PixelForge.Tests;

public class StatusEngineTests
{
    [Fact]
    public void FrostSlow_ReducesSpeedFactor_ThenExpires()
    {
        var s = new StatusEngine();
        s.Apply(1, new StatusEffect(StatusKind.Slow, 0.40f, 1.0f, 0f, "frost"));
        var t = s.Tick(1, 0.5f);
        Assert.Equal(0, t.DamageThisTick);
        Assert.Equal(0.60f, t.SpeedFactor, 3);
        // After the duration elapses the effect is pruned.
        s.Tick(1, 0.6f);
        Assert.Equal(0, s.ActiveCount(1));
        Assert.Equal(1.0f, s.Tick(1, 0.1f).SpeedFactor, 3);
    }

    [Fact]
    public void Burn_DealsDamageEachInterval()
    {
        var s = new StatusEngine();
        s.Apply(2, new StatusEffect(StatusKind.Burn, 3f, 2.0f, 0.5f, "fire"));
        int total = 0;
        for (int i = 0; i < 4; i++) total += s.Tick(2, 0.5f).DamageThisTick;
        Assert.Equal(12, total); // 3 dmg x 4 ticks in 2s
    }

    [Fact]
    public void MultipleSlows_CompoundMultiplicatively()
    {
        var s = new StatusEngine();
        s.Apply(3, new StatusEffect(StatusKind.Slow, 0.5f, 5f, 0f, "a"));
        s.Apply(3, new StatusEffect(StatusKind.Slow, 0.5f, 5f, 0f, "b"));
        Assert.Equal(0.25f, s.Tick(3, 0.1f).SpeedFactor, 3);
    }

    [Fact]
    public void SlowIsClamped_NeverFullyFreezes()
    {
        var s = new StatusEngine();
        s.Apply(4, new StatusEffect(StatusKind.Slow, 5.0f, 1f, 0f, "x")); // absurd magnitude
        float f = s.Tick(4, 0.01f).SpeedFactor;
        Assert.True(f >= 0.05f, "speed factor floored, got " + f);
    }

    [Fact]
    public void ElementRecipes_DriveDefaultStatuses()
    {
        var s = new StatusEngine();
        Assert.True(s.HasElementStatus("frost"));
        Assert.True(s.HasElementStatus("fire"));
        Assert.True(s.ApplyElement(10, "frost"));
        Assert.Equal(1, s.ActiveCount(10));
        Assert.False(s.ApplyElement(10, "physical")); // no recipe
    }

    [Fact]
    public void SetElementStatus_OverridesRecipe()
    {
        var s = new StatusEngine();
        s.SetElementStatus("frost", new StatusEffect(StatusKind.Burn, 5f, 1f, 0.5f, "frost"));
        var r = s.GetElementStatus("frost");
        Assert.NotNull(r);
        Assert.Equal(StatusKind.Burn, r!.Value.Kind);
    }

    [Fact]
    public void Clear_RemovesAllEffects()
    {
        var s = new StatusEngine();
        s.ApplyElement(7, "frost");
        s.Clear(7);
        Assert.Equal(0, s.ActiveCount(7));
    }

    [Fact]
    public void UnknownActor_TicksAsCleanNoOp()
    {
        var s = new StatusEngine();
        var t = s.Tick(999, 0.5f);
        Assert.Equal(0, t.DamageThisTick);
        Assert.Equal(1.0f, t.SpeedFactor, 3);
    }

    [Fact]
    public void DamageCalculator_ResolveAndApply_AppliesStatusOnLandedHit()
    {
        var calc = new DamageCalculator(seed: 1);
        var r = calc.ResolveAndApply(new AttackInput { BaseDamage = 20f, Element = "frost" }, targetActorId: 5);
        Assert.False(r.Blocked);
        Assert.Equal(1, calc.Status.ActiveCount(5));
    }

    [Fact]
    public void DamageCalculator_BlockedHit_AppliesNoStatus()
    {
        var calc = new DamageCalculator(seed: 1);
        var r = calc.ResolveAndApply(new AttackInput { BaseDamage = 5f, Element = "frost", Armor = 100f }, targetActorId: 6);
        Assert.True(r.Blocked);
        Assert.Equal(0, calc.Status.ActiveCount(6));
    }
}
