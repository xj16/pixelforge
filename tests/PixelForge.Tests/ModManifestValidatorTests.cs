using PixelForge.Core;
using Xunit;

namespace PixelForge.Tests;

public class ModManifestValidatorTests
{
    [Fact]
    public void ValidManifest_Parses()
    {
        const string json = """
        {
          "id": "frost_slime",
          "name": "Frost Slime",
          "version": "1.0.0",
          "author": "xj16",
          "description": "Adds a chilling slime enemy.",
          "entry": "main.lua",
          "api_requires": ["enemy", "combat"]
        }
        """;
        var mod = ModManifestValidator.TryParse(json, out string err);
        Assert.NotNull(mod);
        Assert.Equal("", err);
        Assert.Equal("frost_slime", mod!.Id);
        Assert.Equal("main.lua", mod.Entry);
        Assert.Equal(2, mod.ApiRequires.Count);
    }

    [Fact]
    public void MissingId_Fails()
    {
        var mod = ModManifestValidator.TryParse("""{ "name": "x" }""", out string err);
        Assert.Null(mod);
        Assert.Contains("id", err);
    }

    [Fact]
    public void UppercaseId_Fails()
    {
        var mod = ModManifestValidator.TryParse("""{ "id": "FrostSlime", "name": "x" }""", out string err);
        Assert.Null(mod);
        Assert.Contains("id", err);
    }

    [Fact]
    public void EntryWithPathTraversal_Fails()
    {
        var mod = ModManifestValidator.TryParse(
            """{ "id": "evil", "name": "x", "entry": "../../secrets.lua" }""", out string err);
        Assert.Null(mod);
        Assert.Contains("entry", err);
    }

    [Fact]
    public void NonLuaEntry_Fails()
    {
        var mod = ModManifestValidator.TryParse(
            """{ "id": "bad", "name": "x", "entry": "main.py" }""", out string err);
        Assert.Null(mod);
        Assert.Contains("entry", err);
    }

    [Fact]
    public void MissingEntry_DefaultsToMainLua()
    {
        var mod = ModManifestValidator.TryParse("""{ "id": "ok", "name": "x" }""", out _);
        Assert.NotNull(mod);
        Assert.Equal("main.lua", mod!.Entry);
    }

    [Fact]
    public void InvalidJson_Fails()
    {
        var mod = ModManifestValidator.TryParse("{ not json ", out string err);
        Assert.Null(mod);
        Assert.Contains("JSON", err);
    }
}
