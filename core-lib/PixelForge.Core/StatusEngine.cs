namespace PixelForge.Core;

/// <summary>The kind of ongoing effect an attack or mod can inflict.</summary>
public enum StatusKind
{
    /// <summary>Multiplicative slow on movement speed while active.</summary>
    Slow,
    /// <summary>Damage-over-time ticked at a fixed interval.</summary>
    Burn,
}

/// <summary>A stackable status effect definition, usually seeded by an element.</summary>
public readonly record struct StatusEffect(
    StatusKind Kind,
    float Magnitude,   // Slow: 0..1 speed reduction. Burn: damage per tick.
    float Duration,    // seconds the effect lasts
    float Interval,    // seconds between Burn ticks (ignored for Slow)
    string Source);    // element/mod id that applied it, for logging & rules

/// <summary>
/// One tick's outcome for a single actor: how much DoT damage landed this tick
/// and the current multiplicative speed factor (1.0 = unslowed).
/// </summary>
public readonly record struct StatusTick(int DamageThisTick, float SpeedFactor);

/// <summary>
/// Pure, deterministic status-effect resolver: applies stacking slows and
/// burns to a set of actors and advances them over time. Godot-free so the
/// exact same rules run in CI, in the JS runtime port, and in the game.
///
/// Determinism note: no RNG is used here — given the same applied effects and
/// the same delta sequence, the tick damage and speed factors are byte-for-byte
/// reproducible, which is what lets the replay recorder verify combat.
/// </summary>
public sealed class StatusEngine
{
    private sealed class ActiveEffect
    {
        public StatusKind Kind;
        public float Magnitude;
        public float Remaining;
        public float Interval;
        public float SinceTick;
        public string Source = "";
    }

    // actorId -> its live effects.
    private readonly Dictionary<int, List<ActiveEffect>> _actors = new();

    /// <summary>Element-driven default status recipes (mods can override these).</summary>
    private readonly Dictionary<string, StatusEffect> _recipes = new()
    {
        // Frost hits slow the target by 40% for 2s.
        { "frost", new StatusEffect(StatusKind.Slow, 0.40f, 2.0f, 0f, "frost") },
        // Fire hits burn for 3 damage every 0.5s over 2s.
        { "fire", new StatusEffect(StatusKind.Burn, 3f, 2.0f, 0.5f, "fire") },
    };

    /// <summary>Register or override the status an element inflicts on hit.</summary>
    public void SetElementStatus(string element, StatusEffect effect)
        => _recipes[element] = effect with { Source = element };

    /// <summary>True if the given element carries a status recipe.</summary>
    public bool HasElementStatus(string element) => _recipes.ContainsKey(element);

    /// <summary>Look up the recipe for an element, or null if none.</summary>
    public StatusEffect? GetElementStatus(string element)
        => _recipes.TryGetValue(element, out var e) ? e : null;

    /// <summary>Apply an explicit status effect to an actor.</summary>
    public void Apply(int actorId, in StatusEffect effect)
    {
        if (effect.Duration <= 0f)
            return;
        if (!_actors.TryGetValue(actorId, out var list))
        {
            list = new List<ActiveEffect>();
            _actors[actorId] = list;
        }
        list.Add(new ActiveEffect
        {
            Kind = effect.Kind,
            Magnitude = effect.Magnitude,
            Remaining = effect.Duration,
            Interval = effect.Interval <= 0f ? 0.5f : effect.Interval,
            SinceTick = 0f,
            Source = effect.Source,
        });
    }

    /// <summary>
    /// Apply whatever status an element carries, if any. Returns true if an
    /// effect was applied. Used by the combat pipeline right after a hit lands.
    /// </summary>
    public bool ApplyElement(int actorId, string element)
    {
        if (!_recipes.TryGetValue(element, out var recipe))
            return false;
        Apply(actorId, recipe);
        return true;
    }

    /// <summary>Number of live effects on an actor (0 if none/unknown).</summary>
    public int ActiveCount(int actorId)
        => _actors.TryGetValue(actorId, out var list) ? list.Count : 0;

    /// <summary>Drop every effect on an actor (e.g. when it dies/despawns).</summary>
    public void Clear(int actorId) => _actors.Remove(actorId);

    /// <summary>
    /// Advance an actor's effects by <paramref name="delta"/> seconds and return
    /// the aggregate DoT damage that landed this tick plus the combined slow
    /// factor. Multiple slows compound multiplicatively; multiple burns sum.
    /// Expired effects are pruned. Unknown actors tick as a clean no-op.
    /// </summary>
    public StatusTick Tick(int actorId, float delta)
    {
        if (delta < 0f) delta = 0f;
        if (!_actors.TryGetValue(actorId, out var list) || list.Count == 0)
            return new StatusTick(0, 1.0f);

        int damage = 0;
        float speedFactor = 1.0f;

        for (int i = list.Count - 1; i >= 0; i--)
        {
            ActiveEffect e = list[i];
            e.Remaining -= delta;

            switch (e.Kind)
            {
                case StatusKind.Slow:
                    // Clamp each slow to [0,0.95] so an actor never fully freezes.
                    float slow = e.Magnitude < 0f ? 0f : (e.Magnitude > 0.95f ? 0.95f : e.Magnitude);
                    speedFactor *= (1f - slow);
                    break;

                case StatusKind.Burn:
                    e.SinceTick += delta;
                    // Emit one hit per whole interval elapsed (handles big deltas).
                    while (e.SinceTick >= e.Interval)
                    {
                        e.SinceTick -= e.Interval;
                        int dmg = (int)MathF.Round(e.Magnitude);
                        if (dmg > 0) damage += dmg;
                    }
                    break;
            }

            if (e.Remaining <= 0f)
                list.RemoveAt(i);
        }

        if (list.Count == 0)
            _actors.Remove(actorId);

        if (speedFactor < 0.05f) speedFactor = 0.05f;
        return new StatusTick(damage, speedFactor);
    }
}
