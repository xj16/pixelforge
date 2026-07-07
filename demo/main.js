// Browser driver for the PixelForge live modding demo. It wires the
// dependency-free engine (identical logic to the Godot game) to a canvas, a mod
// browser, a live Lua editor, and record/replay — all client-side, no server.

import { GameEngine, TILE, LEVEL } from "./engine/game-engine.js";
import { BUNDLED_MODS } from "./engine/mods.generated.js";
import { ReplayRecorder, inputToBits, bitsToInput } from "./engine/replay.js";

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const W = canvas.width, H = canvas.height;

// A user-authored starter mod shown in the editor (a brand-new enemy).
const STARTER_JSON = JSON.stringify(
  { id: "angry_cube", name: "Angry Cube", version: "1.0.0", author: "you", entry: "main.lua" },
  null, 2);
const STARTER_LUA = `-- Live-edit me, then hit Hot-reload (R).
-- Everything here runs in a sandbox with a CPU budget.

game.log("angry_cube loading...")

game.register_enemy({
  id = "angry_cube", name = "Angry Cube",
  health = 40, speed = 70, damage = 12, color = "#ff5470",
  -- A Lua AI brain: chase the player and hop.
  think = function(ctx)
    local dir = 0
    if ctx.target_pos.x < ctx.self_pos.x then dir = -1
    elseif ctx.target_pos.x > ctx.self_pos.x then dir = 1 end
    local st = ctx.state or {}
    st.t = (st.t or 0) - 0.15
    local jump = false
    if ctx.on_floor and st.t <= 0 then jump = true; st.t = 0.7 end
    return { move_x = dir, jump = jump, state = st }
  end,
})

game.set_hook("on_load", function()
  game.log("angry_cube ready — spawned live!")
end)
`;

let engine = new GameEngine({ seed: 0x51ede5eedn });

// --- wire engine callbacks to the UI ---
const consoleEl = document.getElementById("console");
engine.onLog = (e) => appendConsole(e.level, `${e.modId}: ${e.msg}`);
engine.on("mod_message", (d) => flash(d.text));
engine.on("item_collected", (d) => flash("Picked up: " + d.item_id));
engine.on("win", () => { document.getElementById("hudwin").textContent = "★ You reached the exit!"; });

function appendConsole(level, msg) {
  const line = document.createElement("div");
  line.className = level;
  line.textContent = `[${level}] ${msg}`;
  consoleEl.appendChild(line);
  while (consoleEl.childElementCount > 200) consoleEl.removeChild(consoleEl.firstChild);
  consoleEl.scrollTop = consoleEl.scrollHeight;
}
function sysLog(msg) { appendConsole("sys", msg); }

let msgTimer = 0;
function flash(text) { document.getElementById("hudmsg").textContent = text; msgTimer = 2.5; }

// --- load bundled mods + the editor's user mod ---
function loadAll() {
  engine.loader._registry = [];
  engine.loader._disabled = new Set([...engine.loader._disabled]);
  for (const m of BUNDLED_MODS) engine.loader.addMod(m);
  engine.loader.addMod({
    origin: "user",
    manifestJson: document.getElementById("ed-json").value,
    luaSource: document.getElementById("ed-lua").value,
  });
  engine.loader.reloadAll();
  engine.reset();
  renderMods();
}

// --- mod browser ---
function renderMods() {
  const list = document.getElementById("modlist");
  list.innerHTML = "";
  const rt = engine.loader.runtime;
  const counts = (id) => {
    const own = rt._ownership.get(id) || { enemies: [], items: [] };
    return { e: own.enemies.length, i: own.items.length };
  };
  for (const mod of engine.loader.mods) {
    const row = document.createElement("div");
    row.className = "mod";
    // color swatch from first registered enemy, else neutral
    const arch = [...rt.enemyArchetypes.values()].find((a) => a.modId === mod.id);
    const sw = arch && arch.color.css ? arch.color.css : "#3a4353";
    const c = counts(mod.id);
    row.innerHTML = `
      <input type="checkbox" ${mod.enabled ? "checked" : ""} ${mod.error && !mod.enabled ? "" : ""}/>
      <span class="sw" style="background:${sw}"></span>
      <div class="body">
        <div class="title">${esc(mod.name)} <span style="color:var(--muted);font-weight:400">v${esc(mod.version)} · ${mod.origin}</span></div>
        <div class="meta">${esc(mod.description || "—")}${mod.author ? " · by " + esc(mod.author) : ""}</div>
        ${!mod.error ? `<div class="counts">registered ${c.e} enem${c.e === 1 ? "y" : "ies"}, ${c.i} item${c.i === 1 ? "" : "s"}</div>` : ""}
        ${mod.error ? `<div class="err">⚠ ${esc(mod.error)}</div>` : ""}
      </div>`;
    const cb = row.querySelector("input");
    cb.addEventListener("change", () => {
      engine.loader.setModEnabled(mod.id, cb.checked);
      engine.reset();
      renderMods();
    });
    list.appendChild(row);
  }
  const active = engine.loader.mods.filter((m) => m.enabled && !m.error).length;
  document.getElementById("modcount").textContent = `${active} active`;
}
function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// --- input ---
const keys = {};
const input = { left: false, right: false, jump: false, attack: false, dash: false, jumpReleased: false };
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "TEXTAREA") return;
  const k = e.key.toLowerCase();
  if (["a", "d", " ", "j", "k", "r"].includes(k) || e.code === "Space") e.preventDefault();
  if (k === "r") { doReload(); return; }
  keys[k] = true;
});
window.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  keys[k] = false;
  if (k === " ") input.jumpReleased = true;
});

function readInput() {
  input.left = !!keys["a"];
  input.right = !!keys["d"];
  input.jump = !!keys[" "];
  input.attack = !!keys["j"];
  input.dash = !!keys["k"];
}

// --- record / replay ---
let recorder = null, recording = false;
let replaying = null, replayFrame = 0;
function toggleRecord() {
  if (!recording) {
    engine.reset();
    recorder = new ReplayRecorder(engine.seed);
    recording = true;
    document.getElementById("record").textContent = "■ Stop recording";
    sysLog("Recording run (seed " + engine.seed + ")...");
  } else {
    recording = false;
    document.getElementById("record").textContent = "● Record run";
    sysLog(`Recorded ${recorder.frameCount} input change-frames.`);
  }
}
function startReplay() {
  if (!recorder || recorder.frameCount === 0) { sysLog("Nothing recorded yet — press Record, play, then Stop."); return; }
  // Serialize + reparse to prove the wire format round-trips, then replay against
  // a fresh engine on the SAME seed: deterministic re-run.
  const text = recorder.serialize();
  const parsed = ReplayRecorder.deserialize(text);
  engine = freshEngine(parsed.seed);
  loadAll();
  replaying = parsed.expand(recorder.frames.at(-1).frame + 300);
  replayFrame = 0;
  recording = false;
  sysLog(`Replaying ${replaying.length} frames on seed ${parsed.seed}…`);
}

function freshEngine(seed) {
  const e = new GameEngine({ seed });
  e.onLog = (ev) => appendConsole(ev.level, `${ev.modId}: ${ev.msg}`);
  e.on("mod_message", (d) => flash(d.text));
  e.on("item_collected", (d) => flash("Picked up: " + d.item_id));
  e.on("win", () => { document.getElementById("hudwin").textContent = "★ You reached the exit!"; });
  return e;
}

// --- buttons ---
function doReload() { loadAll(); sysLog("Hot-reloaded all mods."); }
document.getElementById("reload").addEventListener("click", doReload);
document.getElementById("reset").addEventListener("click", () => { engine.reset(); document.getElementById("hudwin").textContent = ""; });
document.getElementById("record").addEventListener("click", toggleRecord);
document.getElementById("replay").addEventListener("click", startReplay);
document.getElementById("evil").addEventListener("click", () => {
  document.getElementById("ed-lua").value = 'game.log("about to hang the frame...")\nwhile true do end\n';
  doReload();
  sysLog("Injected an infinite loop — the sandbox budget aborted it, game still running.");
});

// --- editor tabs ---
for (const b of document.querySelectorAll(".editor .tabs button")) {
  b.addEventListener("click", () => {
    document.querySelectorAll(".editor .tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.getElementById("ed-lua").style.display = b.dataset.tab === "lua" ? "" : "none";
    document.getElementById("ed-json").style.display = b.dataset.tab === "json" ? "" : "none";
  });
}
document.getElementById("ed-lua").value = STARTER_LUA;
document.getElementById("ed-json").value = STARTER_JSON;

// --- rendering ---
const COLORS = { wall: "#232c3b", wall2: "#2b3547", bg: "#0a0d13" };
function draw() {
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);
  // level tiles
  for (let y = 0; y < engine.gridH; y++) {
    for (let x = 0; x < engine.gridW; x++) {
      if (engine.solid[y][x]) {
        ctx.fillStyle = (x + y) % 2 ? COLORS.wall : COLORS.wall2;
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
    }
  }
  // exit
  if (engine.exit) {
    const t = (Date.now() / 300) % 2;
    ctx.fillStyle = "rgba(255,230,106," + (0.4 + 0.3 * Math.abs(1 - t)) + ")";
    ctx.fillRect(engine.exit.x + 3, engine.exit.y + 2, TILE - 6, TILE - 4);
    ctx.fillStyle = "#ffe66a"; ctx.font = "10px system-ui"; ctx.fillText("EXIT", engine.exit.x + 1, engine.exit.y - 3);
  }
  // pickups
  for (const p of engine.pickups) {
    ctx.fillStyle = p.def.color.css || "#66e08a";
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, Math.PI * 2); ctx.fill();
  }
  // particles
  for (const pt of engine.particles) {
    ctx.globalAlpha = Math.max(0, pt.life * 2);
    ctx.fillStyle = pt.color; ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
  }
  ctx.globalAlpha = 1;
  // enemies
  for (const e of engine.enemies) {
    const base = e.arch.color;
    let css = base.css || "#ffffff";
    if (e.speedFactor < 0.999) css = "#5bc9e6"; // chilled tint
    ctx.fillStyle = css;
    const s = e.arch.canFly ? 9 : 11;
    ctx.fillRect(e.x - s / 2, e.y - s / 2, s, s);
    if (e.arch.canFly) { ctx.strokeStyle = css; ctx.beginPath(); ctx.moveTo(e.x - 9, e.y); ctx.lineTo(e.x + 9, e.y); ctx.stroke(); }
  }
  // player
  const pl = engine.player;
  if (pl) {
    ctx.fillStyle = pl.invuln > 0 && (Date.now() / 60 | 0) % 2 ? "#88f" : "#e8eefc";
    ctx.fillRect(pl.x - 6, pl.y - 8, 12, 16);
    // attack arc
    if (pl.attackWindow > 0) {
      ctx.fillStyle = "rgba(230,238,252,0.35)";
      ctx.fillRect(pl.x + (pl.facing > 0 ? 6 : -22), pl.y - 8, 16, 16);
    }
  }
  // hp bar
  if (pl) document.getElementById("hpfill").style.width = (100 * pl.health / pl.maxHealth) + "%";
}

// --- main loop ---
let last = performance.now(), acc = 0, fpsSmooth = 60;
const DT = 1 / 60;
function frame(now) {
  const raw = Math.min(0.1, (now - last) / 1000);
  last = now;
  fpsSmooth = fpsSmooth * 0.9 + (1 / Math.max(raw, 1e-3)) * 0.1;
  acc += raw;
  while (acc >= DT) {
    if (replaying) {
      const bits = replaying[replayFrame] ?? 0;
      const inp = bitsToInput(bits);
      engine.step(DT, inp);
      replayFrame++;
      if (replayFrame >= replaying.length) { replaying = null; sysLog("Replay finished — deterministic re-run complete."); }
    } else {
      readInput();
      if (recording) recorder.record(engine.frame, inputToBits(input));
      engine.step(DT, input);
      input.jumpReleased = false;
    }
    acc -= DT;
    if (msgTimer > 0) { msgTimer -= DT; if (msgTimer <= 0) document.getElementById("hudmsg").textContent = ""; }
  }
  draw();
  document.getElementById("statline").textContent =
    `enemies ${engine.enemies.length} · kills ${engine.stats.kills}` + (replaying ? " · REPLAY" : recording ? " · REC" : "");
  document.getElementById("perf").textContent = `${fpsSmooth.toFixed(0)} fps · ${engine.enemies.length} AI`;
  requestAnimationFrame(frame);
}

// boot
loadAll();
sysLog("PixelForge demo ready. Move with A/D, attack with J. Edit the mod and hit R.");
requestAnimationFrame(frame);
