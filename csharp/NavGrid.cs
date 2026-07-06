using Godot;
using Godot.Collections;
using PixelForge.Core;

namespace PixelForge;

/// <summary>
/// Godot-facing adapter over <see cref="AStarPathfinder"/>. Ground enemies
/// query <see cref="FindPath"/> to re-plan routes to the player. The search
/// itself lives in the Godot-free <c>PixelForge.Core</c> assembly (unit-tested
/// in CI); this node only converts to and from Godot types.
/// </summary>
public partial class NavGrid : Node
{
    private AStarPathfinder? _grid;

    /// <summary>(Re)allocate the grid. All cells start walkable.</summary>
    public void Configure(int width, int height, bool allowFlying)
        => _grid = new AStarPathfinder(width, height, allowFlying);

    public int Width => _grid?.Width ?? 0;
    public int Height => _grid?.Height ?? 0;

    public void SetBlocked(int x, int y, bool blocked) => _grid?.SetBlocked(x, y, blocked);

    public void SetGroundBelow(int x, int y, bool hasGround) => _grid?.SetGroundBelow(x, y, hasGround);

    public bool IsBlocked(int x, int y) => _grid == null || _grid.IsBlocked(x, y);

    /// <summary>
    /// Compute an A* path in grid coordinates. Returns an Array of Vector2I,
    /// start-exclusive and target-inclusive; empty means no route.
    /// </summary>
    public Array<Vector2I> FindPath(int sx, int sy, int tx, int ty)
    {
        var result = new Array<Vector2I>();
        if (_grid == null)
            return result;
        foreach (GridCoord c in _grid.FindPath(sx, sy, tx, ty))
            result.Add(new Vector2I(c.X, c.Y));
        return result;
    }
}
