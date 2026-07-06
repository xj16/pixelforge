using System.Text.Json;

namespace PixelForge.Core;

/// <summary>A validated mod manifest (mirror of mod.json on disk).</summary>
public sealed class ModManifest
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string Version { get; init; } = "0.0.0";
    public string Author { get; init; } = "";
    public string Description { get; init; } = "";
    public string Entry { get; init; } = "main.lua";
    public IReadOnlyList<string> ApiRequires { get; init; } = Array.Empty<string>();
}

/// <summary>
/// Parses and validates mod manifests. Kept Godot-free so the exact same rules
/// are unit-tested in CI and reused by the GDScript loader (which shells the
/// validation out via a small JSON contract). Determines whether a mod is safe
/// and well-formed enough to load.
/// </summary>
public static class ModManifestValidator
{
    // A mod id must be a lowercase slug: letters, digits, underscores, hyphens.
    private static bool IsValidId(string id)
    {
        if (string.IsNullOrEmpty(id) || id.Length > 64)
            return false;
        foreach (char c in id)
        {
            bool ok = (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '_' || c == '-';
            if (!ok) return false;
        }
        return true;
    }

    /// <summary>
    /// Try to parse a manifest from raw JSON. On failure, <paramref name="error"/>
    /// explains why and the return value is null.
    /// </summary>
    public static ModManifest? TryParse(string json, out string error)
    {
        error = "";
        JsonDocument doc;
        try
        {
            doc = JsonDocument.Parse(json);
        }
        catch (JsonException ex)
        {
            error = "invalid JSON: " + ex.Message;
            return null;
        }

        using (doc)
        {
            JsonElement root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                error = "manifest root must be an object";
                return null;
            }

            string id = GetString(root, "id");
            if (!IsValidId(id))
            {
                error = "missing or invalid 'id' (need lowercase slug [a-z0-9_-], <=64 chars)";
                return null;
            }

            string name = GetString(root, "name");
            if (string.IsNullOrWhiteSpace(name))
            {
                error = "missing 'name'";
                return null;
            }

            string entry = GetString(root, "entry");
            if (string.IsNullOrWhiteSpace(entry))
                entry = "main.lua";
            if (!entry.EndsWith(".lua", StringComparison.OrdinalIgnoreCase))
            {
                error = "'entry' must be a .lua file";
                return null;
            }
            // Reject path traversal in the entry point.
            if (entry.Contains("..") || entry.Contains('/') || entry.Contains('\\'))
            {
                error = "'entry' must be a bare filename inside the mod folder";
                return null;
            }

            var requires = new List<string>();
            if (root.TryGetProperty("api_requires", out JsonElement req) && req.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement e in req.EnumerateArray())
                {
                    if (e.ValueKind == JsonValueKind.String)
                        requires.Add(e.GetString() ?? "");
                }
            }

            return new ModManifest
            {
                Id = id,
                Name = name,
                Version = GetString(root, "version", "0.0.0"),
                Author = GetString(root, "author"),
                Description = GetString(root, "description"),
                Entry = entry,
                ApiRequires = requires,
            };
        }
    }

    private static string GetString(JsonElement obj, string key, string fallback = "")
        => obj.TryGetProperty(key, out JsonElement v) && v.ValueKind == JsonValueKind.String
            ? v.GetString() ?? fallback
            : fallback;
}
