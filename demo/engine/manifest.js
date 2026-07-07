// Mod manifest validation — a JS port of PixelForge.Core's ModManifestValidator.cs.
// The exact same rules (id slug, safe entry path, .lua entry) run in the C# unit
// tests, the GDScript loader, and this browser runtime, so all three agree.

function isValidId(id) {
  if (!id || id.length > 64) return false;
  for (const c of id) {
    const ok =
      (c >= "a" && c <= "z") ||
      (c >= "0" && c <= "9") ||
      c === "_" ||
      c === "-";
    if (!ok) return false;
  }
  return true;
}

// Returns { manifest, error }. On failure manifest is null and error explains.
export function parseManifest(json) {
  let root;
  try {
    root = typeof json === "string" ? JSON.parse(json) : json;
  } catch (e) {
    return { manifest: null, error: "invalid JSON: " + e.message };
  }
  if (root === null || typeof root !== "object" || Array.isArray(root)) {
    return { manifest: null, error: "manifest root must be an object" };
  }

  const id = typeof root.id === "string" ? root.id : "";
  if (!isValidId(id)) {
    return {
      manifest: null,
      error: "missing or invalid 'id' (need lowercase slug [a-z0-9_-], <=64 chars)",
    };
  }

  const name = typeof root.name === "string" ? root.name : "";
  if (!name.trim()) return { manifest: null, error: "missing 'name'" };

  let entry = typeof root.entry === "string" ? root.entry : "";
  if (!entry.trim()) entry = "main.lua";
  if (!entry.toLowerCase().endsWith(".lua")) {
    return { manifest: null, error: "'entry' must be a .lua file" };
  }
  if (entry.includes("..") || entry.includes("/") || entry.includes("\\")) {
    return { manifest: null, error: "'entry' must be a bare filename inside the mod folder" };
  }

  const apiRequires = Array.isArray(root.api_requires)
    ? root.api_requires.filter((x) => typeof x === "string")
    : [];

  return {
    manifest: {
      id,
      name,
      version: typeof root.version === "string" ? root.version : "0.0.0",
      author: typeof root.author === "string" ? root.author : "",
      description: typeof root.description === "string" ? root.description : "",
      entry,
      apiRequires,
    },
    error: "",
  };
}
