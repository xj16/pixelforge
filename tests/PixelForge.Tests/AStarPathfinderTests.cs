using PixelForge.Core;
using Xunit;

namespace PixelForge.Tests;

public class AStarPathfinderTests
{
    private static AStarPathfinder OpenFlyingGrid(int w, int h)
    {
        // A flying grid ignores the ground requirement, so every unblocked cell
        // is walkable — convenient for pure connectivity tests.
        return new AStarPathfinder(w, h, allowFlying: true);
    }

    [Fact]
    public void StraightLine_ReturnsShortestPath()
    {
        var grid = OpenFlyingGrid(5, 1);
        var path = grid.FindPath(0, 0, 4, 0);
        Assert.Equal(4, path.Count); // start-exclusive, target-inclusive
        Assert.Equal(new GridCoord(4, 0), path[^1]);
    }

    [Fact]
    public void BlockedTarget_ReturnsEmpty()
    {
        var grid = OpenFlyingGrid(5, 5);
        grid.SetBlocked(4, 4, true);
        var path = grid.FindPath(0, 0, 4, 4);
        Assert.Empty(path);
    }

    [Fact]
    public void WallForcesDetour()
    {
        var grid = OpenFlyingGrid(3, 3);
        // Vertical wall down the middle column, leaving the bottom open.
        grid.SetBlocked(1, 0, true);
        grid.SetBlocked(1, 1, true);
        var path = grid.FindPath(0, 0, 2, 0);
        Assert.NotEmpty(path);
        // The path must not step through a blocked cell.
        foreach (var c in path)
            Assert.False(grid.IsBlocked(c.X, c.Y));
        Assert.Equal(new GridCoord(2, 0), path[^1]);
    }

    [Fact]
    public void FullyWalledOff_ReturnsEmpty()
    {
        var grid = OpenFlyingGrid(3, 3);
        // Surround the target completely.
        grid.SetBlocked(1, 2, true);
        grid.SetBlocked(2, 1, true);
        grid.SetBlocked(1, 1, true); // block the diagonal corner-cut too
        var path = grid.FindPath(0, 0, 2, 2);
        Assert.Empty(path);
    }

    [Fact]
    public void NoDiagonalCornerCutting()
    {
        var grid = OpenFlyingGrid(2, 2);
        // Block both orthogonal neighbors of the (0,0)->(1,1) diagonal.
        grid.SetBlocked(1, 0, true);
        grid.SetBlocked(0, 1, true);
        var path = grid.FindPath(0, 0, 1, 1);
        // With both orthogonals blocked, the diagonal is illegal -> no path.
        Assert.Empty(path);
    }

    [Fact]
    public void Walker_RequiresGroundBeneath()
    {
        var walker = new AStarPathfinder(5, 2, allowFlying: false);
        // No ground flagged anywhere -> a walker can go nowhere.
        var blocked = walker.FindPath(0, 0, 4, 0);
        Assert.Empty(blocked);

        // Flag ground along the top row and the walker can traverse it.
        for (int x = 0; x < 5; x++)
            walker.SetGroundBelow(x, 0, true);
        var path = walker.FindPath(0, 0, 4, 0);
        Assert.NotEmpty(path);
        Assert.Equal(new GridCoord(4, 0), path[^1]);
    }

    [Fact]
    public void OutOfBoundsStart_ReturnsEmpty()
    {
        var grid = OpenFlyingGrid(4, 4);
        Assert.Empty(grid.FindPath(-1, 0, 2, 2));
        Assert.Empty(grid.FindPath(0, 0, 99, 2));
    }
}
