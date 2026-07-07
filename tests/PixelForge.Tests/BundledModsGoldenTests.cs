using System.IO;
using PixelForge.Core;
using Xunit;

namespace PixelForge.Tests;

/// <summary>
/// Golden test: every mod bundled under <c>mods/</c> must pass the SAME
/// <see cref="ModManifestValidator"/> the game and the browser runtime use. This
/// makes the C# validator the single source of truth — a malformed bundled
/// manifest fails CI instead of only failing at runtime.
/// </summary>
public class BundledModsGoldenTests
{
    // Walk up from the test bin dir to the repo root (where mods/ lives).
    private static string FindModsDir()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir != null)
        {
            string candidate = Path.Combine(dir.FullName, "mods");
            if (Directory.Exists(candidate) && File.Exists(Path.Combine(dir.FullName, "project.godot")))
                return candidate;
            dir = dir.Parent;
        }
        throw new DirectoryNotFoundException("could not locate the repo's mods/ directory");
    }

    public static IEnumerable<object[]> BundledManifests()
    {
        string mods = FindModsDir();
        foreach (string modDir in Directory.GetDirectories(mods))
        {
            string manifest = Path.Combine(modDir, "mod.json");
            if (File.Exists(manifest))
                yield return new object[] { Path.GetFileName(modDir), manifest };
        }
    }

    [Theory]
    [MemberData(nameof(BundledManifests))]
    public void EveryBundledManifest_IsValid(string modName, string manifestPath)
    {
        string json = File.ReadAllText(manifestPath);
        var manifest = ModManifestValidator.TryParse(json, out string error);
        Assert.True(manifest != null, $"{modName}: {error}");
        Assert.Equal("", error);
        // The declared entry script must actually exist on disk.
        string entryPath = Path.Combine(Path.GetDirectoryName(manifestPath)!, manifest!.Entry);
        Assert.True(File.Exists(entryPath), $"{modName}: entry '{manifest.Entry}' not found");
    }

    [Fact]
    public void AtLeastThreeBundledMods_ArePresent()
    {
        int count = 0;
        foreach (var _ in BundledManifests()) count++;
        Assert.True(count >= 3, $"expected the 3 example mods, found {count}");
    }
}
