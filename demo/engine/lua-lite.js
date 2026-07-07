// lua-lite: a small, dependency-free interpreter for the subset of Lua 5.4 that
// PixelForge mods use. It is NOT a full Lua — it deliberately implements just
// enough to run real mod scripts (locals, functions/closures, tables, control
// flow, arithmetic, string/math stdlib, method calls) inside a hard sandbox with
// an instruction budget so a runaway `while true do end` is aborted, not fatal.
//
// This mirrors, in the browser, exactly what the Godot ModLoader does with
// lua-gdextension + a debug-hook budget: give each mod only a curated `game`
// global and cap its CPU. Everything here is pure JS — no eval, no Function().

// ---------------------------------------------------------------------------
// Lexer
// ---------------------------------------------------------------------------

const KEYWORDS = new Set([
  "and", "break", "do", "else", "elseif", "end", "false", "for", "function",
  "goto", "if", "in", "local", "nil", "not", "or", "repeat", "return", "then",
  "true", "until", "while",
]);

class LuaError extends Error {}

function lex(src) {
  const toks = [];
  let i = 0, line = 1;
  const n = src.length;
  const peek = (o = 0) => src[i + o];

  const isDigit = (c) => c >= "0" && c <= "9";
  const isAlpha = (c) => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || c === "_";
  const isAlnum = (c) => isAlpha(c) || isDigit(c);

  while (i < n) {
    let c = src[i];
    if (c === "\n") { line++; i++; continue; }
    if (c === " " || c === "\t" || c === "\r") { i++; continue; }

    // Comments
    if (c === "-" && peek(1) === "-") {
      i += 2;
      // Long comment --[[ ... ]]
      if (src[i] === "[" && src[i + 1] === "[") {
        i += 2;
        while (i < n && !(src[i] === "]" && src[i + 1] === "]")) {
          if (src[i] === "\n") line++;
          i++;
        }
        i += 2;
      } else {
        while (i < n && src[i] !== "\n") i++;
      }
      continue;
    }

    // Long string [[ ... ]]
    if (c === "[" && src[i + 1] === "[") {
      i += 2;
      let start = i;
      while (i < n && !(src[i] === "]" && src[i + 1] === "]")) {
        if (src[i] === "\n") line++;
        i++;
      }
      toks.push({ t: "string", v: src.slice(start, i), line });
      i += 2;
      continue;
    }

    // Strings
    if (c === '"' || c === "'") {
      const quote = c; i++;
      let s = "";
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") {
          i++;
          const e = src[i];
          if (e === "n") s += "\n";
          else if (e === "t") s += "\t";
          else if (e === "r") s += "\r";
          else if (e === "\\") s += "\\";
          else if (e === '"') s += '"';
          else if (e === "'") s += "'";
          else s += e;
          i++;
        } else {
          if (src[i] === "\n") line++;
          s += src[i++];
        }
      }
      i++; // closing quote
      toks.push({ t: "string", v: s, line });
      continue;
    }

    // Numbers (decimal, float, hex)
    if (isDigit(c) || (c === "." && isDigit(peek(1)))) {
      let start = i;
      if (c === "0" && (peek(1) === "x" || peek(1) === "X")) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
        toks.push({ t: "number", v: parseInt(src.slice(start, i), 16), line });
        continue;
      }
      while (i < n && isDigit(src[i])) i++;
      if (src[i] === ".") { i++; while (i < n && isDigit(src[i])) i++; }
      if (src[i] === "e" || src[i] === "E") {
        i++;
        if (src[i] === "+" || src[i] === "-") i++;
        while (i < n && isDigit(src[i])) i++;
      }
      toks.push({ t: "number", v: parseFloat(src.slice(start, i)), line });
      continue;
    }

    // Identifiers / keywords
    if (isAlpha(c)) {
      let start = i;
      while (i < n && isAlnum(src[i])) i++;
      const word = src.slice(start, i);
      toks.push({ t: KEYWORDS.has(word) ? word : "name", v: word, line });
      continue;
    }

    // Operators / punctuation (longest match first)
    const three = src.substr(i, 3);
    const two = src.substr(i, 2);
    if (three === "...") { toks.push({ t: "...", line }); i += 3; continue; }
    if (["==", "~=", "<=", ">=", "..", "::"].includes(two)) {
      toks.push({ t: two, line }); i += 2; continue;
    }
    if ("+-*/%^#<>=(){}[];:,.".includes(c)) {
      toks.push({ t: c, line }); i++; continue;
    }
    throw new LuaError(`unexpected character '${c}' at line ${line}`);
  }
  toks.push({ t: "eof", line });
  return toks;
}

// ---------------------------------------------------------------------------
// Parser (recursive descent + precedence climbing for expressions)
// ---------------------------------------------------------------------------

const BINPRI = {
  "or": [1, 1], "and": [2, 2],
  "<": [3, 3], ">": [3, 3], "<=": [3, 3], ">=": [3, 3], "~=": [3, 3], "==": [3, 3],
  "..": [9, 8], // right assoc
  "+": [10, 10], "-": [10, 10],
  "*": [11, 11], "/": [11, 11], "%": [11, 11],
  "^": [14, 13], // right assoc
};
const UNARYPRI = 12;

class Parser {
  constructor(toks) { this.toks = toks; this.p = 0; }
  peek(o = 0) { return this.toks[this.p + o]; }
  next() { return this.toks[this.p++]; }
  check(t) { return this.peek().t === t; }
  accept(t) { if (this.check(t)) return this.next(); return null; }
  expect(t) {
    if (!this.check(t)) throw new LuaError(`expected '${t}' but got '${this.peek().t}' at line ${this.peek().line}`);
    return this.next();
  }

  parseChunk() {
    const body = this.parseBlock();
    this.expect("eof");
    return { type: "Chunk", body };
  }

  parseBlock() {
    const stmts = [];
    for (;;) {
      const t = this.peek().t;
      if (["eof", "end", "else", "elseif", "until"].includes(t)) break;
      if (t === "return") {
        stmts.push(this.parseReturn());
        break;
      }
      const s = this.parseStatement();
      if (s) stmts.push(s);
    }
    return stmts;
  }

  parseReturn() {
    this.next(); // return
    const args = [];
    const stop = ["eof", "end", "else", "elseif", "until", ";"];
    if (!stop.includes(this.peek().t)) {
      args.push(this.parseExpr());
      while (this.accept(",")) args.push(this.parseExpr());
    }
    this.accept(";");
    return { type: "Return", args };
  }

  parseStatement() {
    const t = this.peek().t;
    switch (t) {
      case ";": this.next(); return null;
      case "local": return this.parseLocal();
      case "if": return this.parseIf();
      case "while": return this.parseWhile();
      case "for": return this.parseFor();
      case "do": { this.next(); const body = this.parseBlock(); this.expect("end"); return { type: "Do", body }; }
      case "repeat": return this.parseRepeat();
      case "function": return this.parseFunctionStmt();
      case "break": this.next(); return { type: "Break" };
      default: return this.parseExprStatement();
    }
  }

  parseLocal() {
    this.next(); // local
    if (this.accept("function")) {
      const name = this.expect("name").v;
      const fn = this.parseFunctionBody();
      return { type: "LocalFunction", name, fn };
    }
    const names = [this.expect("name").v];
    while (this.accept(",")) names.push(this.expect("name").v);
    let exprs = [];
    if (this.accept("=")) {
      exprs.push(this.parseExpr());
      while (this.accept(",")) exprs.push(this.parseExpr());
    }
    return { type: "Local", names, exprs };
  }

  parseIf() {
    this.next(); // if
    const clauses = [];
    const cond = this.parseExpr();
    this.expect("then");
    clauses.push({ cond, body: this.parseBlock() });
    while (this.check("elseif")) {
      this.next();
      const c = this.parseExpr();
      this.expect("then");
      clauses.push({ cond: c, body: this.parseBlock() });
    }
    let elseBody = null;
    if (this.accept("else")) elseBody = this.parseBlock();
    this.expect("end");
    return { type: "If", clauses, elseBody };
  }

  parseWhile() {
    this.next();
    const cond = this.parseExpr();
    this.expect("do");
    const body = this.parseBlock();
    this.expect("end");
    return { type: "While", cond, body };
  }

  parseRepeat() {
    this.next();
    const body = this.parseBlock();
    this.expect("until");
    const cond = this.parseExpr();
    return { type: "Repeat", body, cond };
  }

  parseFor() {
    this.next(); // for
    const first = this.expect("name").v;
    if (this.accept("=")) {
      const start = this.parseExpr();
      this.expect(",");
      const limit = this.parseExpr();
      let step = null;
      if (this.accept(",")) step = this.parseExpr();
      this.expect("do");
      const body = this.parseBlock();
      this.expect("end");
      return { type: "NumericFor", name: first, start, limit, step, body };
    }
    const names = [first];
    while (this.accept(",")) names.push(this.expect("name").v);
    this.expect("in");
    const exprs = [this.parseExpr()];
    while (this.accept(",")) exprs.push(this.parseExpr());
    this.expect("do");
    const body = this.parseBlock();
    this.expect("end");
    return { type: "GenericFor", names, exprs, body };
  }

  parseFunctionStmt() {
    this.next(); // function
    // function name.a.b:c() ...
    let target = { type: "Name", name: this.expect("name").v };
    let isMethod = false;
    while (this.check(".") || this.check(":")) {
      const sep = this.next().t;
      const key = this.expect("name").v;
      target = { type: "Index", obj: target, key: { type: "String", value: key }, dot: true };
      if (sep === ":") { isMethod = true; break; }
    }
    const fn = this.parseFunctionBody(isMethod);
    return { type: "Assign", targets: [target], exprs: [fn] };
  }

  parseFunctionBody(isMethod = false) {
    this.expect("(");
    const params = [];
    let vararg = false;
    if (isMethod) params.push("self");
    if (!this.check(")")) {
      for (;;) {
        if (this.accept("...")) { vararg = true; break; }
        params.push(this.expect("name").v);
        if (!this.accept(",")) break;
      }
    }
    this.expect(")");
    const body = this.parseBlock();
    this.expect("end");
    return { type: "Function", params, vararg, body };
  }

  parseExprStatement() {
    const expr = this.parseSuffixed();
    if (this.check("=") || this.check(",")) {
      const targets = [expr];
      while (this.accept(",")) targets.push(this.parseSuffixed());
      this.expect("=");
      const exprs = [this.parseExpr()];
      while (this.accept(",")) exprs.push(this.parseExpr());
      return { type: "Assign", targets, exprs };
    }
    if (expr.type !== "Call" && expr.type !== "MethodCall") {
      throw new LuaError(`syntax error near line ${this.peek().line}: expression is not a statement`);
    }
    return { type: "ExprStatement", expr };
  }

  parseExpr(minPri = 0) {
    let left = this.parseUnary();
    for (;;) {
      const op = this.peek().t;
      const pri = BINPRI[op];
      if (!pri || pri[0] <= minPri) break;
      this.next();
      const right = this.parseExpr(pri[1]);
      left = { type: "Binary", op, left, right };
    }
    return left;
  }

  parseUnary() {
    const t = this.peek().t;
    if (t === "not" || t === "-" || t === "#") {
      this.next();
      const operand = this.parseExpr(UNARYPRI);
      return { type: "Unary", op: t, operand };
    }
    return this.parseSuffixed();
  }

  parseSuffixed() {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.peek().t;
      if (t === ".") {
        this.next();
        const key = this.expect("name").v;
        e = { type: "Index", obj: e, key: { type: "String", value: key }, dot: true };
      } else if (t === "[") {
        this.next();
        const key = this.parseExpr();
        this.expect("]");
        e = { type: "Index", obj: e, key };
      } else if (t === ":") {
        this.next();
        const method = this.expect("name").v;
        const args = this.parseCallArgs();
        e = { type: "MethodCall", obj: e, method, args };
      } else if (t === "(" || t === "string" || t === "{") {
        const args = this.parseCallArgs();
        e = { type: "Call", fn: e, args };
      } else break;
    }
    return e;
  }

  parseCallArgs() {
    if (this.check("string")) {
      return [{ type: "String", value: this.next().v }];
    }
    if (this.check("{")) {
      return [this.parseTable()];
    }
    this.expect("(");
    const args = [];
    if (!this.check(")")) {
      args.push(this.parseExpr());
      while (this.accept(",")) args.push(this.parseExpr());
    }
    this.expect(")");
    return args;
  }

  parsePrimary() {
    const tk = this.peek();
    switch (tk.t) {
      case "number": this.next(); return { type: "Number", value: tk.v };
      case "string": this.next(); return { type: "String", value: tk.v };
      case "nil": this.next(); return { type: "Nil" };
      case "true": this.next(); return { type: "Bool", value: true };
      case "false": this.next(); return { type: "Bool", value: false };
      case "...": this.next(); return { type: "Vararg" };
      case "name": this.next(); return { type: "Name", name: tk.v };
      case "function": this.next(); return this.parseFunctionBody();
      case "{": return this.parseTable();
      case "(": {
        this.next();
        const e = this.parseExpr();
        this.expect(")");
        return { type: "Paren", expr: e };
      }
      default:
        throw new LuaError(`unexpected '${tk.t}' at line ${tk.line}`);
    }
  }

  parseTable() {
    this.expect("{");
    const fields = [];
    while (!this.check("}")) {
      if (this.check("[")) {
        this.next();
        const key = this.parseExpr();
        this.expect("]");
        this.expect("=");
        const value = this.parseExpr();
        fields.push({ kind: "expr", key, value });
      } else if (this.check("name") && this.peek(1).t === "=") {
        const key = this.next().v;
        this.next(); // =
        const value = this.parseExpr();
        fields.push({ kind: "named", key, value });
      } else {
        fields.push({ kind: "array", value: this.parseExpr() });
      }
      if (!this.accept(",") && !this.accept(";")) break;
    }
    this.expect("}");
    return { type: "Table", fields };
  }
}

// ---------------------------------------------------------------------------
// Runtime values
// ---------------------------------------------------------------------------

// LuaTable: array part + hash part, with a metatable slot for stringlib method
// dispatch (":format" etc.). Kept simple and fully in-JS.
export class LuaTable {
  constructor() { this.hash = new Map(); this.arr = []; }
  get(key) {
    if (typeof key === "number" && Number.isInteger(key) && key >= 1 && key <= this.arr.length) {
      return this.arr[key - 1];
    }
    const v = this.hash.get(normKey(key));
    return v === undefined ? null : v;
  }
  set(key, value) {
    if (typeof key === "number" && Number.isInteger(key) && key >= 1 && key <= this.arr.length + 1) {
      this.arr[key - 1] = value;
      return;
    }
    if (value === null || value === undefined) this.hash.delete(normKey(key));
    else this.hash.set(normKey(key), value);
  }
  get length() { return this.arr.length; }
  // Convert to a plain JS object/array snapshot (used at the API boundary).
  toJS() {
    if (this.hash.size === 0 && this.arr.length > 0) {
      return this.arr.map(luaToJS);
    }
    const o = {};
    for (let idx = 0; idx < this.arr.length; idx++) o[idx + 1] = luaToJS(this.arr[idx]);
    for (const [k, v] of this.hash) o[k] = luaToJS(v);
    return o;
  }
}

function normKey(k) { return k; }

export function luaToJS(v) {
  if (v instanceof LuaTable) return v.toJS();
  return v;
}

// Convert a plain JS value into a Lua value (JS object/array -> LuaTable).
export function jsToLua(v) {
  if (v === undefined) return null;
  if (Array.isArray(v)) {
    const t = new LuaTable();
    v.forEach((x, i) => t.set(i + 1, jsToLua(x)));
    return t;
  }
  if (v && typeof v === "object" && !(v instanceof LuaTable) && typeof v.__isVector !== "function") {
    // A vector-like {x,y} stays as-is if flagged; otherwise map keys.
    const t = new LuaTable();
    for (const k of Object.keys(v)) t.set(k, jsToLua(v[k]));
    return t;
  }
  return v;
}

class LuaFunction {
  constructor(node, closure, interp) {
    this.node = node; this.closure = closure; this.interp = interp;
  }
}

// Control-flow signals (cheap sentinels instead of exceptions where possible).
const BREAK = { signal: "break" };
class ReturnSignal { constructor(values) { this.values = values; } }

// ---------------------------------------------------------------------------
// Interpreter
// ---------------------------------------------------------------------------

class Scope {
  constructor(parent) { this.vars = new Map(); this.parent = parent; }
  get(name) {
    let s = this;
    while (s) { if (s.vars.has(name)) return s.vars.get(name); s = s.parent; }
    return undefined;
  }
  has(name) {
    let s = this;
    while (s) { if (s.vars.has(name)) return true; s = s.parent; }
    return false;
  }
  setExisting(name, value) {
    let s = this;
    while (s) { if (s.vars.has(name)) { s.vars.set(name, value); return true; } s = s.parent; }
    return false;
  }
  declare(name, value) { this.vars.set(name, value); }
}

export class Interpreter {
  constructor({ budget = 2_000_000 } = {}) {
    this.budget = budget;
    this.instructions = 0;
    this.globals = new LuaTable();
    this._installStdlib();
  }

  _tick() {
    if (++this.instructions > this.budget) {
      throw new LuaError("execution budget exceeded (possible infinite loop) — mod aborted");
    }
  }

  resetBudget() { this.instructions = 0; }

  run(src, chunkName = "chunk") {
    const toks = lex(src);
    const ast = new Parser(toks).parseChunk();
    const scope = new Scope(null);
    try {
      this.execBlock(ast.body, scope);
    } catch (e) {
      if (e instanceof ReturnSignal) return e.values;
      if (e instanceof LuaError) throw new LuaError(`[${chunkName}] ${e.message}`);
      throw e;
    }
    return [];
  }

  // --- statements ---
  execBlock(stmts, scope) {
    for (const s of stmts) this.execStatement(s, scope);
  }

  execStatement(node, scope) {
    this._tick();
    switch (node.type) {
      case "Local": {
        const vals = this.evalList(node.exprs, scope, node.names.length);
        node.names.forEach((nm, i) => scope.declare(nm, vals[i] ?? null));
        return;
      }
      case "LocalFunction": {
        scope.declare(node.name, null);
        const fn = new LuaFunction(node.fn, scope, this);
        scope.vars.set(node.name, fn);
        return;
      }
      case "Assign": {
        const vals = this.evalList(node.exprs, scope, node.targets.length);
        node.targets.forEach((tgt, i) => this.assign(tgt, vals[i] ?? null, scope));
        return;
      }
      case "ExprStatement":
        this.evalExpr(node.expr, scope);
        return;
      case "If": {
        for (const cl of node.clauses) {
          if (truthy(this.evalExpr(cl.cond, scope))) {
            this.execBlock(cl.body, new Scope(scope));
            return;
          }
        }
        if (node.elseBody) this.execBlock(node.elseBody, new Scope(scope));
        return;
      }
      case "While": {
        while (truthy(this.evalExpr(node.cond, scope))) {
          this._tick();
          const r = this.execLoopBody(node.body, new Scope(scope));
          if (r === BREAK) break;
        }
        return;
      }
      case "Repeat": {
        for (;;) {
          this._tick();
          const inner = new Scope(scope);
          const r = this.execLoopBody(node.body, inner);
          if (r === BREAK) break;
          if (truthy(this.evalExpr(node.cond, inner))) break;
        }
        return;
      }
      case "NumericFor": {
        let start = tonumber(this.evalExpr(node.start, scope));
        const limit = tonumber(this.evalExpr(node.limit, scope));
        const step = node.step ? tonumber(this.evalExpr(node.step, scope)) : 1;
        if (step === 0) throw new LuaError("'for' step is zero");
        for (let v = start; step > 0 ? v <= limit : v >= limit; v += step) {
          this._tick();
          const inner = new Scope(scope);
          inner.declare(node.name, v);
          const r = this.execLoopBody(node.body, inner);
          if (r === BREAK) break;
        }
        return;
      }
      case "GenericFor": {
        // Support the ipairs/pairs iterator protocol.
        const vals = this.evalList(node.exprs, scope, 3);
        const iter = vals[0]; let state = vals[1] ?? null; let control = vals[2] ?? null;
        for (;;) {
          this._tick();
          const res = this.call(iter, [state, control]);
          if (res[0] === null || res[0] === undefined) break;
          control = res[0];
          const inner = new Scope(scope);
          node.names.forEach((nm, i) => inner.declare(nm, res[i] ?? null));
          const r = this.execLoopBody(node.body, inner);
          if (r === BREAK) break;
        }
        return;
      }
      case "Do":
        this.execBlock(node.body, new Scope(scope));
        return;
      case "Return":
        throw new ReturnSignal(this.evalList(node.args, scope, -1));
      case "Break":
        throw BREAK;
      default:
        throw new LuaError(`cannot execute node ${node.type}`);
    }
  }

  // Execute a loop body, converting a thrown BREAK into a returned sentinel.
  execLoopBody(body, scope) {
    try {
      this.execBlock(body, scope);
    } catch (e) {
      if (e === BREAK) return BREAK;
      throw e;
    }
    return null;
  }

  assign(target, value, scope) {
    if (target.type === "Name") {
      if (!scope.setExisting(target.name, value)) this.globals.set(target.name, value);
      return;
    }
    if (target.type === "Index") {
      const obj = this.evalExpr(target.obj, scope);
      const key = this.evalExpr(target.key, scope);
      if (obj instanceof LuaTable) obj.set(key, value);
      else if (obj && typeof obj === "object") obj[key] = value;
      else throw new LuaError("attempt to index a non-table value");
      return;
    }
    throw new LuaError("invalid assignment target");
  }

  // --- expressions ---
  evalList(exprs, scope, want) {
    const out = [];
    for (let i = 0; i < exprs.length; i++) {
      const isLast = i === exprs.length - 1;
      const v = this.evalExprMulti(exprs[i], scope);
      if (isLast && Array.isArray(v)) out.push(...v);
      else out.push(Array.isArray(v) ? (v[0] ?? null) : v);
    }
    if (want >= 0) { while (out.length < want) out.push(null); }
    return out;
  }

  // Returns possibly-multiple values (arrays) for calls/varargs.
  evalExprMulti(node, scope) {
    if (node.type === "Call" || node.type === "MethodCall") return this.evalCall(node, scope);
    if (node.type === "Vararg") return scope.get("...") ?? [];
    return this.evalExpr(node, scope);
  }

  evalExpr(node, scope) {
    this._tick();
    switch (node.type) {
      case "Number": return node.value;
      case "String": return node.value;
      case "Bool": return node.value;
      case "Nil": return null;
      case "Vararg": { const v = scope.get("...") ?? []; return v[0] ?? null; }
      case "Name": {
        if (scope.has(node.name)) return scope.get(node.name) ?? null;
        return this.globals.get(node.name);
      }
      case "Paren": return this.evalExpr(node.expr, scope);
      case "Index": {
        const obj = this.evalExpr(node.obj, scope);
        const key = this.evalExpr(node.key, scope);
        return this.index(obj, key);
      }
      case "Call":
      case "MethodCall": {
        const r = this.evalCall(node, scope);
        return r[0] ?? null;
      }
      case "Function": return new LuaFunction(node, scope, this);
      case "Table": return this.evalTable(node, scope);
      case "Unary": return this.evalUnary(node, scope);
      case "Binary": return this.evalBinary(node, scope);
      default: throw new LuaError(`cannot evaluate node ${node.type}`);
    }
  }

  index(obj, key) {
    if (obj instanceof LuaTable) return obj.get(key);
    if (typeof obj === "string") return STRINGLIB.get(key) ?? null; // method dispatch
    if (obj && typeof obj === "object") {
      const v = obj[key];
      return v === undefined ? null : v;
    }
    throw new LuaError(`attempt to index a ${luaType(obj)} value`);
  }

  evalTable(node, scope) {
    const t = new LuaTable();
    let arrayIndex = 1;
    for (let i = 0; i < node.fields.length; i++) {
      const f = node.fields[i];
      if (f.kind === "named") t.set(f.key, this.evalExpr(f.value, scope));
      else if (f.kind === "expr") t.set(this.evalExpr(f.key, scope), this.evalExpr(f.value, scope));
      else {
        // array field: last one may expand multiple values
        const isLast = i === node.fields.length - 1;
        const v = this.evalExprMulti(f.value, scope);
        if (isLast && Array.isArray(v)) v.forEach((x) => t.set(arrayIndex++, x));
        else t.set(arrayIndex++, Array.isArray(v) ? (v[0] ?? null) : v);
      }
    }
    return t;
  }

  evalUnary(node, scope) {
    const v = this.evalExpr(node.operand, scope);
    switch (node.op) {
      case "-": return -tonumber(v);
      case "not": return !truthy(v);
      case "#":
        if (typeof v === "string") return v.length;
        if (v instanceof LuaTable) return v.length;
        throw new LuaError("attempt to get length of a " + luaType(v));
      default: throw new LuaError("bad unary op " + node.op);
    }
  }

  evalBinary(node, scope) {
    const op = node.op;
    if (op === "and") { const l = this.evalExpr(node.left, scope); return truthy(l) ? this.evalExpr(node.right, scope) : l; }
    if (op === "or") { const l = this.evalExpr(node.left, scope); return truthy(l) ? l : this.evalExpr(node.right, scope); }
    const l = this.evalExpr(node.left, scope);
    const r = this.evalExpr(node.right, scope);
    switch (op) {
      case "+": return tonumber(l) + tonumber(r);
      case "-": return tonumber(l) - tonumber(r);
      case "*": return tonumber(l) * tonumber(r);
      case "/": return tonumber(l) / tonumber(r);
      case "%": { const a = tonumber(l), b = tonumber(r); return a - Math.floor(a / b) * b; }
      case "^": return Math.pow(tonumber(l), tonumber(r));
      case "..": return luaConcat(l) + luaConcat(r);
      case "==": return luaEquals(l, r);
      case "~=": return !luaEquals(l, r);
      case "<": return luaLess(l, r);
      case ">": return luaLess(r, l);
      case "<=": return !luaLess(r, l);
      case ">=": return !luaLess(l, r);
      default: throw new LuaError("bad binary op " + op);
    }
  }

  evalCall(node, scope) {
    let fn, args;
    if (node.type === "MethodCall") {
      const obj = this.evalExpr(node.obj, scope);
      fn = this.index(obj, node.method);
      args = [obj, ...this.evalList(node.args, scope, -1)];
    } else {
      fn = this.evalExpr(node.fn, scope);
      args = this.evalList(node.args, scope, -1);
    }
    return this.call(fn, args);
  }

  call(fn, args) {
    this._tick();
    if (typeof fn === "function") {
      const r = fn(args, this);
      return Array.isArray(r) ? r : r === undefined ? [] : [r];
    }
    if (fn instanceof LuaFunction) {
      const scope = new Scope(fn.closure);
      const params = fn.node.params;
      params.forEach((p, i) => scope.declare(p, args[i] ?? null));
      if (fn.node.vararg) scope.declare("...", args.slice(params.length));
      try {
        this.execBlock(fn.node.body, scope);
      } catch (e) {
        if (e instanceof ReturnSignal) return e.values;
        throw e;
      }
      return [];
    }
    throw new LuaError(`attempt to call a ${luaType(fn)} value`);
  }

  // Expose a JS function or table as a Lua global.
  setGlobal(name, value) { this.globals.set(name, value); }

  _installStdlib() {
    const g = this.globals;

    g.set("print", (args) => { console.log(args.map(luaToDisplay).join("\t")); return []; });
    g.set("tostring", (args) => [luaToDisplay(args[0])]);
    g.set("tonumber", (args) => {
      const v = args[0];
      if (typeof v === "number") return [v];
      if (typeof v === "string") { const n = parseFloat(v); return [Number.isNaN(n) ? null : n]; }
      return [null];
    });
    g.set("type", (args) => [luaType(args[0])]);
    g.set("error", (args) => { throw new LuaError(luaConcat(args[0])); });
    g.set("assert", (args) => { if (!truthy(args[0])) throw new LuaError(args[1] ? luaConcat(args[1]) : "assertion failed!"); return args; });
    g.set("select", (args) => {
      if (args[0] === "#") return [args.length - 1];
      const n = args[0] | 0; return args.slice(n);
    });
    g.set("rawget", (args) => [this.index(args[0], args[1])]);
    g.set("rawset", (args) => { if (args[0] instanceof LuaTable) args[0].set(args[1], args[2]); return [args[0]]; });
    g.set("pcall", (args) => {
      const [fn, ...rest] = args;
      try { const r = this.call(fn, rest); return [true, ...r]; }
      catch (e) { return [false, e instanceof LuaError ? e.message : String(e)]; }
    });

    // ipairs / pairs iterators
    g.set("ipairs", (args) => {
      const t = args[0];
      const iter = (a) => {
        const [tbl, i] = a;
        const ni = (i | 0) + 1;
        const v = tbl.get(ni);
        if (v === null || v === undefined) return [null];
        return [ni, v];
      };
      return [iter, t, 0];
    });
    g.set("pairs", (args) => {
      const t = args[0];
      const keys = [];
      for (let idx = 0; idx < t.arr.length; idx++) keys.push(idx + 1);
      for (const k of t.hash.keys()) keys.push(k);
      let pos = 0;
      const iter = () => {
        if (pos >= keys.length) return [null];
        const k = keys[pos++];
        return [k, t.get(k)];
      };
      return [iter, t, null];
    });

    // math library
    const math = new LuaTable();
    const M = {
      floor: Math.floor, ceil: Math.ceil, abs: Math.abs, sqrt: Math.sqrt,
      sin: Math.sin, cos: Math.cos, tan: Math.tan, exp: Math.exp, log: Math.log,
    };
    for (const [k, f] of Object.entries(M)) math.set(k, (a) => [f(tonumber(a[0]))]);
    math.set("min", (a) => [Math.min(...a.map(tonumber))]);
    math.set("max", (a) => [Math.max(...a.map(tonumber))]);
    math.set("huge", Infinity);
    math.set("pi", Math.PI);
    math.set("random", (a) => {
      // Deterministic-free convenience RNG for mods that want jitter; the game's
      // authoritative rolls go through the seeded C#/JS DamageCalculator.
      if (a.length === 0) return [Math.random()];
      if (a.length === 1) return [1 + Math.floor(Math.random() * tonumber(a[0]))];
      const lo = tonumber(a[0]), hi = tonumber(a[1]);
      return [lo + Math.floor(Math.random() * (hi - lo + 1))];
    });
    g.set("math", math);

    // string library (function form + method form both dispatch here)
    const string = new LuaTable();
    for (const [k, f] of STRINGLIB) string.set(k, f);
    g.set("string", string);

    // table library (subset)
    const table = new LuaTable();
    table.set("insert", (a) => {
      const t = a[0];
      if (a.length >= 3) t.arr.splice((a[1] | 0) - 1, 0, a[2]);
      else t.set(t.length + 1, a[1]);
      return [];
    });
    table.set("remove", (a) => {
      const t = a[0];
      const pos = a.length >= 2 ? (a[1] | 0) : t.length;
      if (pos < 1 || pos > t.arr.length) return [null];
      return [t.arr.splice(pos - 1, 1)[0]];
    });
    table.set("concat", (a) => {
      const t = a[0]; const sep = a[1] ?? "";
      return [t.arr.map(luaConcat).join(sep)];
    });
    g.set("table", table);
  }
}

// ---------------------------------------------------------------------------
// string library (shared by function-form and method-form calls)
// ---------------------------------------------------------------------------

const STRINGLIB = new Map();
STRINGLIB.set("format", (a) => [luaFormat(luaConcat(a[0]), a.slice(1))]);
STRINGLIB.set("len", (a) => [String(a[0]).length]);
STRINGLIB.set("upper", (a) => [String(a[0]).toUpperCase()]);
STRINGLIB.set("lower", (a) => [String(a[0]).toLowerCase()]);
STRINGLIB.set("sub", (a) => {
  const s = String(a[0]); let i = a[1] | 0; let j = a[2] === undefined ? s.length : a[2] | 0;
  if (i < 0) i = s.length + i + 1; if (i < 1) i = 1;
  if (j < 0) j = s.length + j + 1; if (j > s.length) j = s.length;
  return [i > j ? "" : s.slice(i - 1, j)];
});
STRINGLIB.set("rep", (a) => [String(a[0]).repeat(Math.max(0, a[1] | 0))]);
STRINGLIB.set("find", (a) => {
  const s = String(a[0]); const idx = s.indexOf(String(a[1]));
  return idx < 0 ? [null] : [idx + 1, idx + String(a[1]).length];
});
STRINGLIB.set("gsub", (a) => {
  const s = String(a[0]); const pat = String(a[1]); const rep = String(a[2]);
  return [s.split(pat).join(rep)];
});

function luaFormat(fmt, args) {
  let ai = 0;
  return fmt.replace(/%[-+ #0]*\d*(\.\d+)?[diouxXeEfgGqsc%]/g, (spec) => {
    if (spec === "%%") return "%";
    const conv = spec[spec.length - 1];
    const val = args[ai++];
    switch (conv) {
      case "d": case "i": return String(Math.trunc(tonumber(val)));
      case "u": return String(Math.abs(Math.trunc(tonumber(val))));
      case "f": case "F": {
        const m = spec.match(/\.(\d+)/);
        const prec = m ? parseInt(m[1], 10) : 6;
        return tonumber(val).toFixed(prec);
      }
      case "x": return Math.trunc(tonumber(val)).toString(16);
      case "X": return Math.trunc(tonumber(val)).toString(16).toUpperCase();
      case "e": case "E": return tonumber(val).toExponential();
      case "g": case "G": return String(tonumber(val));
      case "s": return luaToDisplay(val);
      case "q": return JSON.stringify(luaToDisplay(val));
      case "c": return String.fromCharCode(tonumber(val));
      default: return spec;
    }
  });
}

// ---------------------------------------------------------------------------
// value helpers
// ---------------------------------------------------------------------------

function truthy(v) { return v !== null && v !== undefined && v !== false; }

function tonumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseFloat(v); if (!Number.isNaN(n)) return n; }
  throw new LuaError(`attempt to perform arithmetic on a ${luaType(v)} value`);
}

function luaConcat(v) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToStr(v);
  if (v === null || v === undefined) throw new LuaError("attempt to concatenate a nil value");
  if (typeof v === "boolean") throw new LuaError("attempt to concatenate a boolean value");
  return luaToDisplay(v);
}

function numToStr(n) {
  if (Number.isInteger(n)) return String(n);
  return String(n);
}

function luaEquals(a, b) {
  if (a === null || a === undefined) return b === null || b === undefined;
  return a === b;
}

function luaLess(a, b) {
  if (typeof a === "number" && typeof b === "number") return a < b;
  if (typeof a === "string" && typeof b === "string") return a < b;
  throw new LuaError(`attempt to compare ${luaType(a)} with ${luaType(b)}`);
}

function luaType(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "boolean";
  if (v instanceof LuaTable) return "table";
  if (v instanceof LuaFunction || typeof v === "function") return "function";
  return "userdata";
}

function luaToDisplay(v) {
  if (v === null || v === undefined) return "nil";
  if (typeof v === "number") return numToStr(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "string") return v;
  if (v instanceof LuaTable) return "table: 0x" + (v.__id || "0");
  if (v instanceof LuaFunction || typeof v === "function") return "function";
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export { LuaError };
