using PixelForge.Core;
using Xunit;

namespace PixelForge.Tests;

public class ReplayRecorderTests
{
    [Fact]
    public void Record_OnlyStoresChangeFrames()
    {
        var rec = new ReplayRecorder(seed: 1);
        rec.Record(0, (uint)InputButton.Right);
        rec.Record(1, (uint)InputButton.Right); // unchanged -> not stored
        rec.Record(2, (uint)(InputButton.Right | InputButton.Jump));
        Assert.Equal(2, rec.FrameCount);
    }

    [Fact]
    public void SerializeRoundTrips_PreservingSeedAndFrames()
    {
        var rec = new ReplayRecorder(seed: 0xDEADBEEF);
        rec.Record(0, (uint)InputButton.Left);
        rec.Record(5, (uint)(InputButton.Left | InputButton.Attack));
        rec.Record(10, 0);
        string text = rec.Serialize();

        var back = ReplayRecorder.Deserialize(text);
        Assert.Equal(rec.Seed, back.Seed);
        Assert.Equal(rec.FrameCount, back.FrameCount);
        Assert.Equal(rec.Frames[1].Bits, back.Frames[1].Bits);
    }

    [Fact]
    public void Expand_HoldsStateBetweenChangeFrames()
    {
        var rec = new ReplayRecorder(seed: 1);
        rec.Record(0, 0b1);
        rec.Record(5, 0b11);
        rec.Record(10, 0);
        uint[] bits = rec.Expand(12);
        Assert.Equal(0b1u, bits[0]);
        Assert.Equal(0b1u, bits[4]);  // held between 0 and 5
        Assert.Equal(0b11u, bits[5]);
        Assert.Equal(0u, bits[10]);
        Assert.Equal(0u, bits[11]);
    }

    [Fact]
    public void Deserialize_RejectsCorruptHeader()
    {
        Assert.Throws<FormatException>(() => ReplayRecorder.Deserialize("garbage\nnope"));
    }

    [Fact]
    public void Deserialize_RejectsMissingSeed()
    {
        Assert.Throws<FormatException>(() => ReplayRecorder.Deserialize("PXFREPLAY 1\nnotaseed 5\n"));
    }

    [Fact]
    public void ReplayReproducesTheSameDamageStream()
    {
        // The whole point: a recorded seed replays to identical combat outcomes.
        var rec = new ReplayRecorder(seed: 4242);

        static int[] RunWithSeed(ulong seed)
        {
            var calc = new DamageCalculator(seed);
            var outp = new int[40];
            for (int i = 0; i < outp.Length; i++)
                outp[i] = calc.Resolve(new AttackInput { BaseDamage = 20f, CritChance = 0.5f, CritMult = 2f }).Amount;
            return outp;
        }

        var first = RunWithSeed(rec.Seed);
        var replayed = RunWithSeed(ReplayRecorder.Deserialize(rec.Serialize()).Seed);
        Assert.Equal(first, replayed);
    }
}
