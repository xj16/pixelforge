namespace PixelForge.Core;

/// <summary>A grid cell coordinate.</summary>
public readonly record struct GridCoord(int X, int Y);

/// <summary>
/// A* over an 8-connected tile grid, with optional "must stand on ground"
/// constraint for platformer walkers. Godot-free so it can be unit-tested.
/// The Godot <c>NavGrid</c> node wraps this and translates to Vector2I.
/// </summary>
public sealed class AStarPathfinder
{
    private readonly int _width;
    private readonly int _height;
    private readonly bool[] _blocked;
    private readonly bool[] _groundBelow;
    private readonly bool _allowFlying;

    public AStarPathfinder(int width, int height, bool allowFlying)
    {
        _width = Math.Max(1, width);
        _height = Math.Max(1, height);
        _blocked = new bool[_width * _height];
        _groundBelow = new bool[_width * _height];
        _allowFlying = allowFlying;
    }

    public int Width => _width;
    public int Height => _height;

    private bool InBounds(int x, int y) => x >= 0 && y >= 0 && x < _width && y < _height;
    private int Index(int x, int y) => y * _width + x;

    public void SetBlocked(int x, int y, bool blocked)
    {
        if (InBounds(x, y)) _blocked[Index(x, y)] = blocked;
    }

    public void SetGroundBelow(int x, int y, bool hasGround)
    {
        if (InBounds(x, y)) _groundBelow[Index(x, y)] = hasGround;
    }

    public bool IsBlocked(int x, int y) => !InBounds(x, y) || _blocked[Index(x, y)];

    private bool Walkable(int x, int y)
    {
        if (!InBounds(x, y) || _blocked[Index(x, y)])
            return false;
        return _allowFlying || _groundBelow[Index(x, y)];
    }

    /// <summary>
    /// Returns a path from start (exclusive) to target (inclusive), or an empty
    /// list if no route exists. Coordinates are grid cells.
    /// </summary>
    public List<GridCoord> FindPath(int sx, int sy, int tx, int ty)
    {
        var result = new List<GridCoord>();
        if (!InBounds(sx, sy) || !InBounds(tx, ty) || IsBlocked(tx, ty))
            return result;

        int start = Index(sx, sy);
        int goal = Index(tx, ty);
        int n = _width * _height;

        var gScore = new float[n];
        var cameFrom = new int[n];
        var closed = new bool[n];
        for (int i = 0; i < n; i++)
        {
            gScore[i] = float.PositiveInfinity;
            cameFrom[i] = -1;
        }

        var open = new MinHeap(n);
        gScore[start] = 0f;
        open.Push(start, Heuristic(sx, sy, tx, ty));

        ReadOnlySpan<int> dx = [1, -1, 0, 0, 1, 1, -1, -1];
        ReadOnlySpan<int> dy = [0, 0, 1, -1, 1, -1, 1, -1];
        ReadOnlySpan<float> cost = [1, 1, 1, 1, 1.41421f, 1.41421f, 1.41421f, 1.41421f];

        while (open.Count > 0)
        {
            int current = open.Pop();
            if (current == goal)
                return Reconstruct(cameFrom, current);
            if (closed[current])
                continue;
            closed[current] = true;

            int cx = current % _width;
            int cy = current / _width;

            for (int d = 0; d < 8; d++)
            {
                int nx = cx + dx[d];
                int ny = cy + dy[d];
                if (!Walkable(nx, ny))
                    continue;
                if (d >= 4 && (IsBlocked(cx + dx[d], cy) || IsBlocked(cx, cy + dy[d])))
                    continue; // no diagonal corner cutting

                int ni = Index(nx, ny);
                if (closed[ni])
                    continue;

                float tentative = gScore[current] + cost[d];
                if (tentative < gScore[ni])
                {
                    gScore[ni] = tentative;
                    cameFrom[ni] = current;
                    open.Push(ni, tentative + Heuristic(nx, ny, tx, ty));
                }
            }
        }

        return result;
    }

    private static float Heuristic(int ax, int ay, int bx, int by)
    {
        int adx = Math.Abs(ax - bx);
        int ady = Math.Abs(ay - by);
        int min = Math.Min(adx, ady);
        int max = Math.Max(adx, ady);
        return (max - min) + 1.41421f * min;
    }

    private List<GridCoord> Reconstruct(int[] cameFrom, int current)
    {
        var stack = new List<GridCoord>();
        while (current != -1)
        {
            stack.Add(new GridCoord(current % _width, current / _width));
            current = cameFrom[current];
        }
        var path = new List<GridCoord>(stack.Count);
        for (int i = stack.Count - 2; i >= 0; i--)
            path.Add(stack[i]);
        return path;
    }

    /// <summary>Binary min-heap keyed by f-score.</summary>
    private sealed class MinHeap
    {
        private int[] _node;
        private float[] _prio;
        private int _count;

        public MinHeap(int capacity)
        {
            capacity = Math.Max(16, capacity);
            _node = new int[capacity];
            _prio = new float[capacity];
        }

        public int Count => _count;

        public void Push(int node, float prio)
        {
            if (_count == _node.Length)
            {
                Array.Resize(ref _node, _count * 2);
                Array.Resize(ref _prio, _count * 2);
            }
            int i = _count++;
            _node[i] = node;
            _prio[i] = prio;
            while (i > 0)
            {
                int parent = (i - 1) / 2;
                if (_prio[parent] <= _prio[i]) break;
                Swap(i, parent);
                i = parent;
            }
        }

        public int Pop()
        {
            int top = _node[0];
            _count--;
            if (_count > 0)
            {
                _node[0] = _node[_count];
                _prio[0] = _prio[_count];
                int i = 0;
                while (true)
                {
                    int l = 2 * i + 1, r = 2 * i + 2, smallest = i;
                    if (l < _count && _prio[l] < _prio[smallest]) smallest = l;
                    if (r < _count && _prio[r] < _prio[smallest]) smallest = r;
                    if (smallest == i) break;
                    Swap(i, smallest);
                    i = smallest;
                }
            }
            return top;
        }

        private void Swap(int a, int b)
        {
            (_node[a], _node[b]) = (_node[b], _node[a]);
            (_prio[a], _prio[b]) = (_prio[b], _prio[a]);
        }
    }
}
