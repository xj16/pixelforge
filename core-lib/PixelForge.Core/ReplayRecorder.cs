using System.Text;

namespace PixelForge.Core;

/// <summary>
/// A single recorded input frame. <see cref="Bits"/> is a compact bitmask of the
/// buttons held that frame (see <see cref="InputButton"/>).
/// </summary>
public readonly record struct InputFrame(int Frame, uint Bits);

/// <summary>Button bit positions packed into <see cref="InputFrame.Bits"/>.</summary>
[Flags]
public enum InputButton : uint
{
    None = 0,
    Left = 1 << 0,
    Right = 1 << 1,
    Jump = 1 << 2,
    Attack = 1 << 3,
    Dash = 1 << 4,
}

/// <summary>
/// Records the startup seed plus the per-frame input stream of a run, and can
/// serialize/deserialize it so a run is exactly reproducible. Combined with the
/// deterministic RNG and status engine, replaying the same seed + inputs
/// reproduces every crit and DoT tick — the guarantee the README advertises.
///
/// Format (text, one token per line):
///   PXFREPLAY 1
///   seed &lt;ulong&gt;
///   &lt;frame&gt; &lt;bits&gt;      (only frames where input changed)
/// Only change-frames are stored, so a mostly-idle run is tiny; playback holds
/// the last state between stored frames.
/// </summary>
public sealed class ReplayRecorder
{
    public const string Magic = "PXFREPLAY";
    public const int FormatVersion = 1;

    public ulong Seed { get; private set; }
    private readonly List<InputFrame> _frames = new();
    private uint _lastBits;
    private bool _any;

    public IReadOnlyList<InputFrame> Frames => _frames;
    public int FrameCount => _frames.Count;

    public ReplayRecorder(ulong seed) => Seed = seed;

    /// <summary>
    /// Record the buttons held on <paramref name="frame"/> as a bitmask (see
    /// <see cref="InputButton"/>). Only stored when the state differs from the
    /// previous frame (delta compression). Use <see cref="Buttons"/> to build the
    /// mask from the typed flags.
    /// </summary>
    public void Record(int frame, uint bits)
    {
        if (!_any || bits != _lastBits)
        {
            _frames.Add(new InputFrame(frame, bits));
            _lastBits = bits;
            _any = true;
        }
    }

    /// <summary>Convenience: pack typed flags into a bitmask for <see cref="Record"/>.</summary>
    public static uint Buttons(InputButton buttons) => (uint)buttons;

    /// <summary>Serialize the whole recording to the text replay format.</summary>
    public string Serialize()
    {
        var sb = new StringBuilder();
        sb.Append(Magic).Append(' ').Append(FormatVersion).Append('\n');
        sb.Append("seed ").Append(Seed).Append('\n');
        foreach (InputFrame f in _frames)
            sb.Append(f.Frame).Append(' ').Append(f.Bits).Append('\n');
        return sb.ToString();
    }

    /// <summary>
    /// Parse a serialized replay. Throws <see cref="FormatException"/> on a bad
    /// header so a corrupt file is caught rather than silently mis-replayed.
    /// </summary>
    public static ReplayRecorder Deserialize(string text)
    {
        string[] lines = text.Replace("\r", "").Split('\n', StringSplitOptions.RemoveEmptyEntries);
        if (lines.Length < 2 || !lines[0].StartsWith(Magic, StringComparison.Ordinal))
            throw new FormatException("not a PixelForge replay");

        var seedParts = lines[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (seedParts.Length != 2 || seedParts[0] != "seed" || !ulong.TryParse(seedParts[1], out ulong seed))
            throw new FormatException("missing or invalid seed line");

        var rec = new ReplayRecorder(seed);
        for (int i = 2; i < lines.Length; i++)
        {
            var p = lines[i].Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (p.Length != 2) continue;
            if (int.TryParse(p[0], out int frame) && uint.TryParse(p[1], out uint bits))
                rec._frames.Add(new InputFrame(frame, bits));
        }
        return rec;
    }

    /// <summary>
    /// Expand the delta-compressed stream into a per-frame button state for the
    /// first <paramref name="frameCount"/> frames (holding the last state between
    /// stored change-frames). Handy for a step-accurate replay driver.
    /// </summary>
    public uint[] Expand(int frameCount)
    {
        if (frameCount < 0) frameCount = 0;
        var outp = new uint[frameCount];
        uint cur = 0;
        int idx = 0;
        for (int f = 0; f < frameCount; f++)
        {
            while (idx < _frames.Count && _frames[idx].Frame == f)
            {
                cur = _frames[idx].Bits;
                idx++;
            }
            outp[f] = cur;
        }
        return outp;
    }
}
