// A* over an 8-connected grid — a JS port of PixelForge.Core's AStarPathfinder.cs,
// including the generational "visited" stamp so re-planning reuses its buffers
// (no per-search allocation beyond the returned path). Same rules as the C#:
// no diagonal corner-cutting, optional "must stand on ground" for walkers.

export class AStarPathfinder {
  constructor(width, height, allowFlying) {
    this._w = Math.max(1, width | 0);
    this._h = Math.max(1, height | 0);
    const n = this._w * this._h;
    this._blocked = new Uint8Array(n);
    this._ground = new Uint8Array(n);
    this._allowFlying = !!allowFlying;

    this._gScore = new Float64Array(n);
    this._cameFrom = new Int32Array(n);
    this._seen = new Int32Array(n);
    this._closed = new Uint8Array(n);
    this._heapNode = new Int32Array(Math.max(16, n));
    this._heapPrio = new Float64Array(Math.max(16, n));
    this._heapCount = 0;
    this._generation = 0;
  }

  get width() { return this._w; }
  get height() { return this._h; }

  _in(x, y) { return x >= 0 && y >= 0 && x < this._w && y < this._h; }
  _idx(x, y) { return y * this._w + x; }

  setBlocked(x, y, b) { if (this._in(x, y)) this._blocked[this._idx(x, y)] = b ? 1 : 0; }
  setGroundBelow(x, y, g) { if (this._in(x, y)) this._ground[this._idx(x, y)] = g ? 1 : 0; }
  isBlocked(x, y) { return !this._in(x, y) || this._blocked[this._idx(x, y)] === 1; }

  _walkable(x, y) {
    if (!this._in(x, y) || this._blocked[this._idx(x, y)] === 1) return false;
    return this._allowFlying || this._ground[this._idx(x, y)] === 1;
  }

  _g(i) { return this._seen[i] === this._generation ? this._gScore[i] : Infinity; }
  _touch(i, g, from) {
    this._seen[i] = this._generation;
    this._gScore[i] = g;
    this._cameFrom[i] = from;
    this._closed[i] = 0;
  }
  _isClosed(i) { return this._seen[i] === this._generation && this._closed[i] === 1; }

  _heapClear() { this._heapCount = 0; }
  _heapPush(node, prio) {
    if (this._heapCount === this._heapNode.length) {
      const nn = new Int32Array(this._heapCount * 2);
      const np = new Float64Array(this._heapCount * 2);
      nn.set(this._heapNode); np.set(this._heapPrio);
      this._heapNode = nn; this._heapPrio = np;
    }
    let i = this._heapCount++;
    this._heapNode[i] = node; this._heapPrio[i] = prio;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this._heapPrio[p] <= this._heapPrio[i]) break;
      this._heapSwap(i, p); i = p;
    }
  }
  _heapPop() {
    const top = this._heapNode[0];
    this._heapCount--;
    if (this._heapCount > 0) {
      this._heapNode[0] = this._heapNode[this._heapCount];
      this._heapPrio[0] = this._heapPrio[this._heapCount];
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = 2 * i + 2;
        let s = i;
        if (l < this._heapCount && this._heapPrio[l] < this._heapPrio[s]) s = l;
        if (r < this._heapCount && this._heapPrio[r] < this._heapPrio[s]) s = r;
        if (s === i) break;
        this._heapSwap(i, s); i = s;
      }
    }
    return top;
  }
  _heapSwap(a, b) {
    const tn = this._heapNode[a]; this._heapNode[a] = this._heapNode[b]; this._heapNode[b] = tn;
    const tp = this._heapPrio[a]; this._heapPrio[a] = this._heapPrio[b]; this._heapPrio[b] = tp;
  }

  static _heuristic(ax, ay, bx, by) {
    const adx = Math.abs(ax - bx), ady = Math.abs(ay - by);
    const mn = Math.min(adx, ady), mx = Math.max(adx, ady);
    return (mx - mn) + 1.41421 * mn;
  }

  // Returns [{x,y}...] start-exclusive, target-inclusive; [] if no route.
  findPath(sx, sy, tx, ty) {
    if (!this._in(sx, sy) || !this._in(tx, ty) || this.isBlocked(tx, ty)) return [];

    this._generation = (this._generation + 1) | 0;
    if (this._generation === 0) { this._seen.fill(0); this._generation = 1; }
    this._heapClear();

    const start = this._idx(sx, sy);
    const goal = this._idx(tx, ty);
    this._touch(start, 0, -1);
    this._heapPush(start, AStarPathfinder._heuristic(sx, sy, tx, ty));

    const dx = [1, -1, 0, 0, 1, 1, -1, -1];
    const dy = [0, 0, 1, -1, 1, -1, 1, -1];
    const cost = [1, 1, 1, 1, 1.41421, 1.41421, 1.41421, 1.41421];

    while (this._heapCount > 0) {
      const current = this._heapPop();
      if (current === goal) return this._reconstruct(current);
      if (this._isClosed(current)) continue;
      this._closed[current] = 1;

      const cx = current % this._w;
      const cy = (current / this._w) | 0;

      for (let d = 0; d < 8; d++) {
        const nx = cx + dx[d], ny = cy + dy[d];
        if (!this._walkable(nx, ny)) continue;
        if (d >= 4 && (this.isBlocked(cx + dx[d], cy) || this.isBlocked(cx, cy + dy[d]))) continue;

        const ni = this._idx(nx, ny);
        if (this._isClosed(ni)) continue;

        const tentative = this._g(current) + cost[d];
        if (tentative < this._g(ni)) {
          this._touch(ni, tentative, current);
          this._heapPush(ni, tentative + AStarPathfinder._heuristic(nx, ny, tx, ty));
        }
      }
    }
    return [];
  }

  _reconstruct(current) {
    const stack = [];
    while (current !== -1) {
      stack.push({ x: current % this._w, y: (current / this._w) | 0 });
      current = this._cameFrom[current];
    }
    const path = [];
    for (let i = stack.length - 2; i >= 0; i--) path.push(stack[i]);
    return path;
  }
}
