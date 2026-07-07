// Headless game simulation — the JS twin of World.gd + Enemy.gd + Player.gd,
// renderer-agnostic so both the browser canvas AND the Node tests drive the same
// code. It owns the config, the deterministic combat (DamageCalculator +
// StatusEngine), the A* nav grid, the event bus, and the entity update loop.

import { DamageCalculator } from "./damage.js";
import { AStarPathfinder } from "./astar.js";
import { ModLoader } from "./loader.js";
import { luaToJS, jsToLua, LuaTable } from "./lua-lite.js";

export const TILE = 24;

// A compact, hand-authored cave level (1 = solid tile). Wider than tall; the
// player starts left, an exit sits top-right behind a small climb. This is the
// "one real level" the analysis asked for — intentional geometry, not a flat box.
export const LEVEL = [
  "111111111111111111111111",
  "1......................1",
  "1......................1",
  "1..........111.........1",
  "1.....111..............1",
  "1...................11.1",
  "1........P........E...1.1",
  "111111....1111.........1",
  "1.........1111....111111",
  "1....111..............X1",
  "1.................111111",
  "111111111111111111111111",
];

export class GameEngine {
  constructor({ seed = 0x1234n, budget } = {}) {
    this.version = "1.0.0";
    this.seed = BigInt(seed);
    this.config = { enemyDamageScale: 1.0, enemyHealthScale: 1.0, playerMaxHealth: 100 };
    this.combat = new DamageCalculator(this.seed);
    this._listeners = new Map();      // event -> [fn]
    this.loader = new ModLoader(this, { budget });
    this._nextActorId = 1;
    this.enemies = [];
    this.pickups = [];
    this.particles = [];
    this.frame = 0;
    this.player = null;
    this.exit = null;
    this.won = false;
    this.stats = { kills: 0, spawns: 0 };
    this._buildLevel();
  }

  // --- engine surface used by the mod runtime -----------------------------
  setElementScale(el, scale) { this.combat.setElementScale(el, scale); }
  setElementStatus(el, effect) { this.combat.status.setElementStatus(el, effect); }
  setConfig(key, value) {
    if (key === "enemy_damage_scale") this.config.enemyDamageScale = Number(value);
    else if (key === "enemy_health_scale") this.config.enemyHealthScale = Number(value);
    else if (key === "player_max_health") this.config.playerMaxHealth = Math.trunc(Number(value));
  }
  getConfig(key) {
    if (key === "enemy_damage_scale") return this.config.enemyDamageScale;
    if (key === "enemy_health_scale") return this.config.enemyHealthScale;
    if (key === "player_max_health") return this.config.playerMaxHealth;
    return null;
  }
  emit(event, data) { this._fire(event, data); this.loader.runtime.dispatchEvent(event, data); }
  on(event, fn) { if (!this._listeners.has(event)) this._listeners.set(event, []); this._listeners.get(event).push(fn); }
  _fire(event, data) { for (const fn of this._listeners.get(event) ?? []) fn(data); }
  onLog(entry) { /* overridden by UI; tests read loader.runtime.logs */ }
  onModsReloaded(active) {
    this.combat.reseed(this.seed);          // deterministic re-seed on reload
    this._registerBuiltins();
    this._populate();
    this._fire("mods_reloaded", { active });
  }

  // --- level construction --------------------------------------------------
  _buildLevel() {
    this.gridW = LEVEL[0].length;
    this.gridH = LEVEL.length;
    this.solid = [];
    this._spawnPoint = { x: 2 * TILE, y: 2 * TILE };
    for (let y = 0; y < this.gridH; y++) {
      const row = [];
      for (let x = 0; x < this.gridW; x++) {
        const ch = LEVEL[y][x];
        row.push(ch === "1");
        if (ch === "P") this._spawnPoint = { x: x * TILE, y: y * TILE };
        if (ch === "X") this.exit = { x: x * TILE, y: y * TILE, w: TILE, h: TILE };
      }
      this.solid.push(row);
    }
    this.navWalk = new AStarPathfinder(this.gridW, this.gridH, false);
    this.navFly = new AStarPathfinder(this.gridW, this.gridH, true);
    for (let y = 0; y < this.gridH; y++) {
      for (let x = 0; x < this.gridW; x++) {
        const blocked = this.solid[y][x];
        this.navWalk.setBlocked(x, y, blocked);
        this.navFly.setBlocked(x, y, blocked);
        const ground = y + 1 < this.gridH && this.solid[y + 1][x];
        this.navWalk.setGroundBelow(x, y, ground);
      }
    }
  }

  isSolidAt(px, py) {
    const cx = Math.floor(px / TILE), cy = Math.floor(py / TILE);
    if (cx < 0 || cy < 0 || cx >= this.gridW || cy >= this.gridH) return true;
    return this.solid[cy][cx];
  }

  // --- content -------------------------------------------------------------
  _registerBuiltins() {
    // Built-in grunt (grounded) + bat (flyer), same as World.gd.
    this.loader.runtime.enemyArchetypes.set("builtin_grunt", {
      id: "builtin_grunt", modId: "builtin", displayName: "Cave Grunt",
      maxHealth: 24, speed: 46, contactDamage: 8, canFly: false,
      element: "physical", color: parseHex("#b5533c"), think: null, _interp: null,
    });
    this.loader.runtime.enemyArchetypes.set("builtin_bat", {
      id: "builtin_bat", modId: "builtin", displayName: "Cave Bat",
      maxHealth: 12, speed: 62, contactDamage: 5, canFly: true,
      element: "physical", color: parseHex("#7a5ea8"), think: null, _interp: null,
    });
  }

  reset() {
    this.frame = 0;
    this.won = false;
    this.stats = { kills: 0, spawns: 0 };
    this.combat.reseed(this.seed);
    this.player = new Player(this, this._spawnPoint.x, this._spawnPoint.y);
    this._registerBuiltins();
    this._populate();
  }

  _populate() {
    this.enemies = [];
    this.pickups = [];
    this._spawnEnemy("builtin_grunt", 8 * TILE, 6 * TILE);
    this._spawnEnemy("builtin_bat", 14 * TILE, 3 * TILE);
    for (const [id, arch] of this.loader.runtime.enemyArchetypes) {
      if (arch.modId !== "builtin") this._spawnEnemy(id, 12 * TILE + (this.stats.spawns * 30 % 120), 3 * TILE);
    }
    let ix = 6 * TILE;
    for (const [id] of this.loader.runtime.itemDefs) {
      this._spawnPickup(id, ix, 8 * TILE);
      ix += 40;
    }
  }

  _spawnEnemy(archId, x, y) {
    const arch = this.loader.runtime.enemyArchetypes.get(archId);
    if (!arch) return;
    const e = new Enemy(this, arch, x, y);
    this.enemies.push(e);
    this.stats.spawns++;
    this._fire("enemy_spawned", { id: archId });
  }

  _spawnPickup(itemId, x, y) {
    const def = this.loader.runtime.itemDefs.get(itemId);
    if (!def) return;
    this.pickups.push({ id: itemId, def, x, y, r: 8, alive: true });
  }

  nextActorId() { return this._nextActorId++; }

  // Resolve an attack and apply status to a target actor (used on player hit).
  resolveDamageOn(attack, actorId) { return this.combat.resolveAndApply(attack, actorId); }
  tickStatus(actorId, dt) { return this.combat.status.tick(actorId, dt); }
  clearStatus(actorId) { this.combat.status.clear(actorId); }

  // --- main step -----------------------------------------------------------
  step(dt, input) {
    this.frame++;
    if (!this.player) return;
    this.player.update(dt, input);
    for (const e of this.enemies) e.update(dt);
    this.enemies = this.enemies.filter((e) => e.alive);
    // Pickups
    for (const p of this.pickups) {
      if (!p.alive) continue;
      if (dist(p.x, p.y, this.player.x, this.player.y) < 18) this._collect(p);
    }
    this.pickups = this.pickups.filter((p) => p.alive);
    // Particles
    for (const pt of this.particles) { pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 300 * dt; }
    this.particles = this.particles.filter((pt) => pt.life > 0);
    // Win check
    if (this.exit && !this.won && rectHit(this.player.x - 6, this.player.y - 10, 12, 20, this.exit)) {
      this.won = true;
      this._fire("win", {});
      this.emit("player_reached_exit", {});
    }
  }

  _collect(p) {
    p.alive = false;
    const def = p.def;
    if (def.onCollect && def._interp) {
      const state = new LuaTable();
      state.set("health", this.player.health);
      state.set("max_health", this.player.maxHealth);
      const res = this.loader.runtime.callGuarded(def._interp, def.onCollect, [state], def.modId, "on_collect");
      const eff = res instanceof LuaTable ? res.toJS() : (res || {});
      if (eff.heal) this.player.heal(Math.trunc(Number(eff.heal)));
      if (eff.message) this._fire("mod_message", { text: String(eff.message) });
    }
    this.emit("item_collected", { item_id: p.id });
  }

  burst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = (Math.PI * 2 * i) / n + Math.random();
      this.particles.push({ x, y, vx: Math.cos(a) * 80, vy: Math.sin(a) * 80 - 40, life: 0.5, color });
    }
  }
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------

const GRAVITY = 980, MAX_FALL = 620, SPEED = 150, JUMP_V = -330, DASH_SPEED = 420;

class Player {
  constructor(engine, x, y) {
    this.engine = engine;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.maxHealth = engine.config.playerMaxHealth;
    this.health = this.maxHealth;
    this.facing = 1;
    this.onGround = false;
    this.coyote = 0; this.dashTime = 0; this.dashCd = 0; this.invuln = 0;
    this.attackWindow = 0; this.attackCd = 0;
    this.hitThisSwing = new Set();
  }

  update(dt, input) {
    this.coyote = Math.max(0, this.coyote - dt);
    this.dashCd = Math.max(0, this.dashCd - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.attackCd = Math.max(0, this.attackCd - dt);
    if (this.onGround) this.coyote = 0.1;

    // Horizontal
    if (this.dashTime <= 0) {
      let dir = 0;
      if (input.left) dir -= 1;
      if (input.right) dir += 1;
      this.vx = dir * SPEED;
      if (dir !== 0) this.facing = dir > 0 ? 1 : -1;
    }

    // Jump (coyote + buffer via just-pressed)
    if (input.jump && this.coyote > 0 && this.dashTime <= 0) { this.vy = JUMP_V; this.coyote = 0; }
    if (input.jumpReleased && this.vy < 0) this.vy *= 0.45;

    // Dash
    if (input.dash && this.dashCd <= 0 && this.dashTime <= 0) {
      this.dashTime = 0.16; this.dashCd = 0.6; this.invuln = Math.max(this.invuln, 0.16);
      this.engine.emit("player_dashed", { facing: this.facing });
    }
    if (this.dashTime > 0) { this.dashTime -= dt; this.vx = this.facing * DASH_SPEED; this.vy = 0; }
    else if (!this.onGround) this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    this._move(dt);

    // Attack
    if (input.attack && this.attackCd <= 0) {
      this.attackWindow = 0.12; this.attackCd = 0.35; this.hitThisSwing.clear();
      this.engine.emit("player_attacked", { facing: this.facing });
    }
    if (this.attackWindow > 0) {
      this.attackWindow -= dt;
      const hx = this.x + this.facing * 20;
      for (const e of this.engine.enemies) {
        if (!e.alive || this.hitThisSwing.has(e.actorId)) continue;
        if (dist(hx, this.y, e.x, e.y) < 22) { this.hitThisSwing.add(e.actorId); e.takeHit(this); }
      }
    }
  }

  _move(dt) {
    // Axis-separated collision against the tile grid.
    const e = this.engine;
    let nx = this.x + this.vx * dt;
    if (!hitsSolid(e, nx, this.y)) this.x = nx; else this.vx = 0;
    let ny = this.y + this.vy * dt;
    if (!hitsSolid(e, this.x, ny)) { this.y = ny; this.onGround = false; }
    else { if (this.vy > 0) this.onGround = true; this.vy = 0; }
  }

  takeDamage(amount) {
    if (this.invuln > 0 || this.health <= 0) return;
    this.health = Math.max(0, this.health - amount);
    this.invuln = 0.5;
    this.engine.emit("player_damaged", { amount, health: this.health });
    if (this.health <= 0) {
      this.engine.emit("player_died", {});
      this.health = this.maxHealth;
      this.x = this.engine._spawnPoint.x; this.y = this.engine._spawnPoint.y;
    }
  }

  heal(amount) {
    this.health = Math.min(this.maxHealth, this.health + amount);
    this.engine.emit("player_healed", { amount, health: this.health });
  }
}

// ---------------------------------------------------------------------------
// Enemy
// ---------------------------------------------------------------------------

class Enemy {
  constructor(engine, arch, x, y) {
    this.engine = engine; this.arch = arch;
    this.x = x; this.y = y; this.vx = 0; this.vy = 0;
    this.actorId = engine.nextActorId();
    this.health = Math.trunc(arch.maxHealth * engine.config.enemyHealthScale);
    this.onGround = false;
    this.thinkAccum = 0; this.thinkInterval = 0.15;
    this.state = new LuaTable();
    this.speedFactor = 1;
    this.alive = true;
  }

  update(dt) {
    // Status (frost slow / burn DoT) via the shared engine.
    const st = this.engine.tickStatus(this.actorId, dt);
    this.speedFactor = st.speedFactor;
    if (st.damage > 0) { this.health -= st.damage; if (this.health <= 0) return this._die(); }

    if (!this.arch.canFly && !this.onGround) this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL);

    this.thinkAccum += dt;
    if (this.thinkAccum >= this.thinkInterval) { this.thinkAccum = 0; this._decide(); }

    this.vx *= this.speedFactor;
    this._move(dt);
    this._contact();
  }

  _decide() {
    const p = this.engine.player;
    if (!p) return;
    if (this.arch.think && this.arch._interp) {
      const ctx = new LuaTable();
      ctx.set("self_pos", vec(this.x, this.y));
      ctx.set("target_pos", vec(p.x, p.y));
      ctx.set("distance", dist(this.x, this.y, p.x, p.y));
      ctx.set("on_floor", this.onGround);
      ctx.set("health", this.health);
      ctx.set("state", this.state);
      const action = this.engine.loader.runtime.callGuarded(
        this.arch._interp, this.arch.think, [ctx], this.arch.modId, "think");
      if (action instanceof LuaTable) return this._apply(action);
    }
    this._defaultAi();
  }

  _apply(action) {
    if (action.get("state") instanceof LuaTable) this.state = action.get("state");
    const moveX = clampf(Number(action.get("move_x") ?? 0), -1, 1);
    this.vx = moveX * this.arch.speed;
    if (this.arch.canFly) {
      const moveY = clampf(Number(action.get("move_y") ?? 0), -1, 1);
      this.vy = moveY * this.arch.speed;
    } else if (truthy(action.get("jump")) && this.onGround) {
      this.vy = JUMP_V * 0.8; this.onGround = false;
    }
  }

  _defaultAi() {
    const p = this.engine.player;
    if (!p) return;
    const e = this.engine;
    if (this.arch.canFly) {
      const s = e.navFly.findPath(cell(this.x), cell(this.y), cell(p.x), cell(p.y));
      const target = s.length ? worldCenter(s[0]) : { x: p.x, y: p.y };
      const dx = target.x - this.x, dy = target.y - this.y;
      const m = Math.hypot(dx, dy) || 1;
      this.vx = (dx / m) * this.arch.speed; this.vy = (dy / m) * this.arch.speed;
      return;
    }
    let dir = Math.sign(p.x - this.x);
    const s = e.navWalk.findPath(cell(this.x), cell(this.y), cell(p.x), cell(p.y));
    if (s.length) dir = Math.sign(worldCenter(s[0]).x - this.x) || dir;
    this.vx = dir * this.arch.speed;
    // Hop when blocked horizontally and grounded.
    if (this.onGround && hitsSolid(e, this.x + dir * 8, this.y)) { this.vy = JUMP_V * 0.7; this.onGround = false; }
  }

  _move(dt) {
    const e = this.engine;
    let nx = this.x + this.vx * dt;
    if (!hitsSolid(e, nx, this.y)) this.x = nx; else this.vx = 0;
    if (this.arch.canFly) {
      let ny = this.y + this.vy * dt;
      if (!hitsSolid(e, this.x, ny)) this.y = ny; else this.vy = 0;
    } else {
      let ny = this.y + this.vy * dt;
      if (!hitsSolid(e, this.x, ny)) { this.y = ny; this.onGround = false; }
      else { if (this.vy > 0) this.onGround = true; this.vy = 0; }
    }
  }

  _contact() {
    const p = this.engine.player;
    if (!p) return;
    if (dist(this.x, this.y, p.x, p.y) < 16) {
      const raw = this.arch.contactDamage * this.engine.config.enemyDamageScale;
      const res = this.engine.combat.resolve({ baseDamage: raw, element: this.arch.element, variance: 0.15 });
      p.takeDamage(res.amount);
    }
  }

  takeHit(source) {
    // Player strike carries the enemy archetype's element, so a mod's registered
    // status (e.g. frost -> slow) is applied to this enemy on hit.
    const res = this.engine.resolveDamageOn(
      { baseDamage: 18, element: this.arch.element, critChance: 0.2, critMult: 2.0 },
      this.actorId);
    this.health -= res.amount;
    this.vx = Math.sign(this.x - source.x) * 140;
    if (this.health <= 0) this._die();
  }

  _die() {
    if (!this.alive) return;
    this.alive = false;
    this.engine.clearStatus(this.actorId);
    this.engine.stats.kills++;
    this.engine.burst(this.x, this.y, this.arch.color.css || "#ffffff");
    this.engine.emit("enemy_killed", { enemy_id: this.arch.id, position: { x: this.x, y: this.y } });
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function truthy(v) { return v !== null && v !== undefined && v !== false; }
function dist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function clampf(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
function cell(px) { return Math.floor(px / TILE); }
function worldCenter(c) { return { x: c.x * TILE + TILE / 2, y: c.y * TILE + TILE / 2 }; }
function vec(x, y) { const t = new LuaTable(); t.set("x", x); t.set("y", y); return t; }
function rectHit(x, y, w, h, r) { return x < r.x + r.w && x + w > r.x && y < r.y + r.h && y + h > r.y; }
function parseHex(hex) {
  let s = hex.replace("#", "");
  return { r: parseInt(s.slice(0, 2), 16) / 255, g: parseInt(s.slice(2, 4), 16) / 255, b: parseInt(s.slice(4, 6), 16) / 255, css: "#" + s };
}
// Player/enemy are ~12px; sample the body box corners against solid tiles.
function hitsSolid(engine, px, py) {
  const half = 6;
  return engine.isSolidAt(px - half, py - half) || engine.isSolidAt(px + half, py - half) ||
         engine.isSolidAt(px - half, py + half) || engine.isSolidAt(px + half, py + half);
}
