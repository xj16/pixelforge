// Tests for the lua-lite interpreter: the sandboxed Lua-subset VM that runs mods
// in the browser. Covers the language features the mods rely on plus the budget.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Interpreter, LuaTable, LuaError } from "../../demo/engine/lua-lite.js";

function run(src, setup) {
  const i = new Interpreter({ budget: 500000 });
  let captured = null;
  i.setGlobal("capture", (a) => { captured = a[0]; return []; });
  if (setup) setup(i);
  i.run(src);
  return { interp: i, captured };
}

test("arithmetic, precedence, and unary minus", () => {
  assert.equal(run("capture(1 + 2 * 3 - 4 / 2)").captured, 5);
  assert.equal(run("capture(2 ^ 3 ^ 2)").captured, 512); // right assoc
  assert.equal(run("capture(-3 + 5)").captured, 2);
  assert.equal(run("capture(7 % 3)").captured, 1);
});

test("string concatenation coerces numbers", () => {
  assert.equal(run('capture("hp=" .. 30)').captured, "hp=30");
});

test("comparison and boolean logic short-circuit", () => {
  assert.equal(run("capture(1 < 2 and 'yes' or 'no')").captured, "yes");
  assert.equal(run("capture(nil and 1 or 2)").captured, 2);
  assert.equal(run("capture(not nil)").captured, true);
});

test("local variables, closures, and upvalues", () => {
  const r = run(`
    local function counter()
      local n = 0
      return function() n = n + 1; return n end
    end
    local c = counter()
    c(); c()
    capture(c())
  `);
  assert.equal(r.captured, 3);
});

test("if / elseif / else", () => {
  const r = run(`
    local function sign(x)
      if x > 0 then return 1 elseif x < 0 then return -1 else return 0 end
    end
    capture(sign(-5))
  `);
  assert.equal(r.captured, -1);
});

test("numeric for with step", () => {
  const r = run(`
    local s = 0
    for i = 1, 10, 2 do s = s + i end
    capture(s)
  `);
  assert.equal(r.captured, 25); // 1+3+5+7+9
});

test("while loop and break", () => {
  const r = run(`
    local i = 0
    while true do i = i + 1; if i >= 5 then break end end
    capture(i)
  `);
  assert.equal(r.captured, 5);
});

test("tables: array + named fields, nested access", () => {
  const r = run(`
    local t = { name = "cube", stats = { hp = 40 }, 10, 20 }
    capture(t.stats.hp + t[1] + t[2])
  `);
  assert.equal(r.captured, 70);
});

test("ipairs iterates the array part in order", () => {
  const r = run(`
    local sum = 0
    for i, v in ipairs({5, 10, 15}) do sum = sum + v end
    capture(sum)
  `);
  assert.equal(r.captured, 30);
});

test("math library", () => {
  assert.equal(run("capture(math.min(3, 1, 2))").captured, 1);
  assert.equal(run("capture(math.max(3, 9, 2))").captured, 9);
  assert.equal(run("capture(math.floor(3.9))").captured, 3);
});

test("string.format method-call form", () => {
  const r = run('capture(("took %d damage (hp=%s)"):format(7, "93"))');
  assert.equal(r.captured, "took 7 damage (hp=93)");
});

test("a table returned from a function reaches JS as a LuaTable", () => {
  const r = run(`
    local function make() return { move_x = -1, jump = true } end
    capture(make())
  `);
  assert.ok(r.captured instanceof LuaTable);
  assert.equal(r.captured.get("move_x"), -1);
  assert.equal(r.captured.get("jump"), true);
});

test("error() propagates as a LuaError", () => {
  assert.throws(() => run('error("boom")'), (e) => e instanceof LuaError && /boom/.test(e.message));
});

test("pcall traps a runtime error", () => {
  const r = run(`
    local ok, err = pcall(function() error("nope") end)
    capture(ok)
  `);
  assert.equal(r.captured, false);
});

test("the instruction budget aborts an infinite loop", () => {
  const i = new Interpreter({ budget: 50000 });
  assert.throws(() => i.run("while true do end"), /budget/i);
});

test("the budget resets per run so a healthy script isn't starved", () => {
  const i = new Interpreter({ budget: 100000 });
  i.setGlobal("capture", () => []);
  i.run("local s = 0 for k = 1, 100 do s = s + k end");
  i.resetBudget();
  i.run("local s = 0 for k = 1, 100 do s = s + k end"); // must not throw
  assert.ok(true);
});

test("indexing a nil value is a clean error, not a crash", () => {
  assert.throws(() => run("local x = nil capture(x.y)"), (e) => e instanceof LuaError);
});
