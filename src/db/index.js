"use strict";
// Camada de dados — PostgreSQL via `pg`. Tudo async. O esquema fica em schema.sql
// e é aplicado no boot (idempotente). DATABASE_URL vem do .env.

const { Pool } = require("pg");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL não definida no .env (ex.: postgres://brokabet:senha@127.0.0.1:5432/brokabet)");

const pool = new Pool({ connectionString: url, max: 10 });
const q = (text, params) => pool.query(text, params);
const one = async (text, params) => (await q(text, params)).rows[0] || null;
const all = async (text, params) => (await q(text, params)).rows;

async function init() {
  await q(fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8"));
}

// ---- senha ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  return `${salt}:${crypto.scryptSync(String(pw), salt, 32).toString("hex")}`;
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored || "").split(":");
  if (!salt || !h) return false;
  const cand = crypto.scryptSync(String(pw), salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(cand, "hex"), Buffer.from(h, "hex"));
}

// Monta "SET a = $1, b = $2" só com as colunas permitidas.
function patchSql(patch, allowed, startAt = 1) {
  const keys = Object.keys(patch).filter(k => allowed.includes(k));
  const set = keys.map((k, i) => `${k} = $${startAt + i}`).join(", ");
  const vals = keys.map(k => (patch[k] !== null && typeof patch[k] === "object") ? JSON.stringify(patch[k]) : patch[k]);
  return { set, vals, keys };
}

// ---- users ----
const users = {
  byEmail: (email) => one("SELECT * FROM users WHERE email = $1", [String(email).toLowerCase()]),
  byId: (id) => one("SELECT * FROM users WHERE id = $1", [id]),
  byApiKey: (key) => /^[0-9a-f-]{36}$/i.test(String(key)) ? one("SELECT * FROM users WHERE api_key = $1", [key]) : null,
  count: async () => Number((await one("SELECT COUNT(*) n FROM users")).n),
  create: ({ email, name, password }) => one(
    "INSERT INTO users (email, name, password_hash) VALUES ($1, $2, $3) RETURNING *",
    [String(email).toLowerCase(), name || "", hashPassword(password)]),
  rotateApiKey: async (id) => (await one("UPDATE users SET api_key = gen_random_uuid() WHERE id = $1 RETURNING api_key", [id])).api_key,
};

// ---- slots ----
const SLOT_COLS = ["name", "bookie", "bet_user", "bet_pass", "executor", "jbot_key", "stake", "max_stake", "paused", "hibernating",
  "using_now", "status", "status_msg", "balance", "open_balance", "session_json", "last_login_at", "last_sync_at"];
const slots = {
  list: (userId) => all("SELECT * FROM slots WHERE user_id = $1 ORDER BY id", [userId]),
  listActive: (userId) => all("SELECT * FROM slots WHERE user_id = $1 AND NOT paused AND NOT hibernating ORDER BY id", [userId]),
  listAll: () => all("SELECT * FROM slots ORDER BY id"),
  byId: (id) => one("SELECT * FROM slots WHERE id = $1", [id]),
  byToken: (token) => /^[0-9a-f-]{36}$/i.test(String(token)) ? one("SELECT * FROM slots WHERE token = $1", [token]) : null,
  create: (userId, s) => one(
    `INSERT INTO slots (user_id, name, bookie, bet_user, bet_pass, executor, jbot_key, stake, max_stake)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [userId, s.name, s.bookie || "B365", s.bet_user || "", s.bet_pass || "", s.executor || "shadow",
     s.jbot_key || null, Number(s.stake) || 0, Number(s.max_stake) || 0]),
  async update(id, patch) {
    const { set, vals } = patchSql(patch, SLOT_COLS);
    if (!set) return slots.byId(id);
    return one(`UPDATE slots SET ${set}, updated_at = now() WHERE id = $${vals.length + 1} RETURNING *`, [...vals, id]);
  },
  remove: (id) => q("DELETE FROM slots WHERE id = $1", [id]),
};

// ---- tips ----
const tips = {
  byId: (id) => one("SELECT * FROM tips WHERE id = $1", [id]),
  byUniqueId: (u) => /^[0-9a-f-]{36}$/i.test(String(u)) ? one("SELECT * FROM tips WHERE unique_id = $1", [u]) : null,
  create: (userId, t) => one(
    `INSERT INTO tips (user_id, bookie, sport_id, fixture_id, event_id, odd_id, fraction_odd, line, description, parameters, source)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [userId, t.bookie || "B365", t.sport_id ?? null, t.fixture_id ?? null, t.event_id ?? null, t.odd_id ?? null,
     t.fraction_odd ?? null, t.line ?? null, t.description || "", JSON.stringify(t.parameters || {}), t.source || "api"]),
  setStatus: (id, status) => q("UPDATE tips SET status = $1 WHERE id = $2", [status, id]),
  // paginação no shape do JBot: { rows, total }
  async page(userId, { bookie = null, since = null, page = 1, limit = 20 } = {}) {
    const where = ["user_id = $1"]; const args = [userId];
    if (bookie) { args.push(bookie); where.push(`bookie = $${args.length}`); }
    if (since) { args.push(since); where.push(`created_at >= $${args.length}`); }
    const w = where.join(" AND ");
    const total = Number((await one(`SELECT COUNT(*) n FROM tips WHERE ${w}`, args)).n);
    const rows = await all(`SELECT * FROM tips WHERE ${w} ORDER BY created_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`,
      [...args, limit, (page - 1) * limit]);
    return { rows, total };
  },
  recent: (userId, limit = 50) => all(`
    SELECT t.*,
      (SELECT COUNT(*) FROM tip_slots ts WHERE ts.tip_id = t.id) AS n_slots,
      (SELECT string_agg(ts.tip_result::text, ',') FROM tip_slots ts WHERE ts.tip_id = t.id) AS results,
      (SELECT string_agg(ts.status, ',') FROM tip_slots ts WHERE ts.tip_id = t.id) AS statuses
    FROM tips t WHERE t.user_id = $1 ORDER BY t.created_at DESC LIMIT $2`, [userId, limit]),
};

// ---- tip_slots ----
const TS_COLS = ["status", "code", "stake", "odds", "starting_line", "ending_line", "tip_result", "unit", "total_returns", "error",
  "request_json", "response_json", "latency_ms", "placed_at", "settled_at"];
const tipSlots = {
  byTip: (tipId) => all(`SELECT ts.*, s.name AS slot_name, s.token AS slot_token, s.bookie FROM tip_slots ts JOIN slots s ON s.id = ts.slot_id WHERE ts.tip_id = $1 ORDER BY ts.id`, [tipId]),
  byId: (id) => one("SELECT * FROM tip_slots WHERE id = $1", [id]),
  create: (tipId, slotId, d = {}) => one(
    `INSERT INTO tip_slots (tip_id, slot_id, status, stake, starting_line, request_json) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [tipId, slotId, d.status || "pending", d.stake ?? null, d.starting_line ?? null, d.request_json ? JSON.stringify(d.request_json) : null]),
  async update(id, patch) {
    const { set, vals } = patchSql(patch, TS_COLS);
    if (!set) return;
    await q(`UPDATE tip_slots SET ${set} WHERE id = $${vals.length + 1}`, [...vals, id]);
  },
  pendingSettlement: () => all(`
    SELECT ts.*, s.executor, s.bookie, s.session_json, s.jbot_key, s.name AS slot_name, s.user_id,
           t.unique_id, t.fixture_id, t.odd_id, t.event_id, t.description
    FROM tip_slots ts JOIN slots s ON s.id = ts.slot_id JOIN tips t ON t.id = ts.tip_id
    WHERE ts.status = 'placed' AND ts.tip_result = 0`),
  stats: (userId, since) => one(`
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE ts.tip_result = 1)::int AS greens,
      COUNT(*) FILTER (WHERE ts.tip_result = 2)::int AS reds,
      COUNT(*) FILTER (WHERE ts.tip_result = 3)::int AS voids,
      COUNT(*) FILTER (WHERE ts.tip_result = 4)::int AS half_greens,
      COUNT(*) FILTER (WHERE ts.tip_result = 5)::int AS half_reds,
      COUNT(*) FILTER (WHERE ts.status = 'placed')::int AS placed,
      COUNT(*) FILTER (WHERE ts.status IN ('rejected','failed'))::int AS failed,
      COALESCE(SUM(ts.stake) FILTER (WHERE ts.status = 'placed'), 0)::float AS invested,
      COALESCE(SUM(COALESCE(ts.total_returns, 0) - COALESCE(ts.stake, 0)) FILTER (WHERE ts.tip_result > 0), 0)::float AS profit,
      COALESCE(SUM(ts.stake) FILTER (WHERE ts.status = 'placed' AND ts.tip_result = 0), 0)::float AS open_stake,
      COALESCE(AVG(ts.stake) FILTER (WHERE ts.status = 'placed'), 0)::float AS avg_stake
    FROM tip_slots ts JOIN tips t ON t.id = ts.tip_id
    WHERE t.user_id = $1 AND ts.created_at >= $2`, [userId, since]),
  latestSettled: (userId, limit = 10) => all(`
    SELECT ts.*, t.description, t.bookie, s.name AS slot_name
    FROM tip_slots ts JOIN tips t ON t.id = ts.tip_id JOIN slots s ON s.id = ts.slot_id
    WHERE t.user_id = $1 AND ts.tip_result > 0 ORDER BY ts.settled_at DESC NULLS LAST LIMIT $2`, [userId, limit]),
};

// ---- events ----
const events = {
  async log(level, message, { slot_id = null, tip_id = null, data = null } = {}) {
    const tag = level === "error" ? "✖" : level === "warn" ? "▲" : "·";
    console.log(`${tag} ${message}${slot_id ? ` [slot ${slot_id}]` : ""}${tip_id ? ` [tip ${tip_id}]` : ""}`);
    try {
      await q("INSERT INTO events (level, slot_id, tip_id, message, data_json) VALUES ($1, $2, $3, $4, $5)",
        [level, slot_id, tip_id, message, data ? JSON.stringify(data) : null]);
    } catch (e) { console.error("events.log falhou:", e.message); }
  },
  recent: (limit = 100) => all(`SELECT e.*, s.name AS slot_name FROM events e LEFT JOIN slots s ON s.id = e.slot_id ORDER BY e.id DESC LIMIT $1`, [limit]),
};

module.exports = { pool, q, one, all, init, users, slots, tips, tipSlots, events, hashPassword, checkPassword };
