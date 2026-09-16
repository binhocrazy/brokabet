"use strict";
// Portal web — dashboard, slots, tips. Sessão via cookie. É o "portal.jbot" nosso.

const express = require("express");
const db = require("../db");
const executor = require("../executor");

const router = express.Router();

function requireLogin(req, res, next) {
  if (!req.session?.userId) return res.redirect("/login");
  next();
}
async function loadUser(req, res, next) {
  req.user = await db.users.byId(req.session.userId);
  if (!req.user) { req.session.destroy(() => {}); return res.redirect("/login"); }
  res.locals.user = req.user;
  next();
}

const sinceFor = (period) => {
  const d = new Date();
  if (period === "7d") d.setDate(d.getDate() - 7);
  else if (period === "30d") d.setDate(d.getDate() - 30);
  else if (period === "all") return new Date(0).toISOString();
  else d.setHours(0, 0, 0, 0); // hoje
  return d.toISOString();
};

// ---- auth ----
router.get("/login", (req, res) => {
  if (req.session?.userId) return res.redirect("/");
  res.render("login", { error: null });
});
router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await db.users.byEmail(email || "");
  if (!user || !db.checkPassword(password, user.password_hash)) {
    return res.status(401).render("login", { error: "E-mail ou senha inválidos." });
  }
  req.session.userId = Number(user.id);
  res.redirect("/");
});
router.post("/logout", (req, res) => req.session.destroy(() => res.redirect("/login")));

router.use(requireLogin, loadUser);

// ---- dashboard ----
router.get("/", async (req, res) => {
  const period = req.query.period || "today";
  const since = sinceFor(period);
  const slots = await db.slots.list(req.user.id);
  const stats = await db.tipSlots.stats(req.user.id, since);
  const latest = await db.tipSlots.latestSettled(req.user.id, 8);
  const saldoTotal = slots.reduce((a, s) => a + (Number(s.balance) || 0), 0);
  const emAberto = slots.reduce((a, s) => a + (Number(s.open_balance) || 0), 0);
  const conv = stats.total ? ((stats.greens + stats.half_greens) / stats.total * 100) : 0;
  const roi = stats.invested ? (stats.profit / stats.invested * 100) : 0;
  res.render("dashboard", { page: "home", period, slots, stats, latest, saldoTotal, emAberto, conv, roi, RESULT: resultLabels });
});

// ---- slots ----
router.get("/slots", async (req, res) => {
  const slots = await db.slots.list(req.user.id);
  res.render("slots", { page: "slots", slots });
});
router.post("/slots", async (req, res) => {
  const b = req.body;
  await db.slots.create(req.user.id, {
    name: b.name || "Slot", bookie: b.bookie || "B365", bet_user: b.bet_user, bet_pass: b.bet_pass,
    executor: b.executor || "shadow", jbot_key: b.jbot_key, stake: b.stake, max_stake: b.max_stake,
  });
  await db.events.log("info", `slot criado: ${b.name}`);
  res.redirect("/slots");
});
router.post("/slots/:id", async (req, res) => {
  const slot = await db.slots.byId(req.params.id);
  if (!slot || Number(slot.user_id) !== Number(req.user.id)) return res.status(404).end();
  const b = req.body;
  const patch = {};
  for (const k of ["name", "bookie", "executor", "jbot_key", "bet_user"]) if (b[k] != null) patch[k] = b[k];
  if (b.stake != null) patch.stake = Number(b.stake) || 0;
  if (b.max_stake != null) patch.max_stake = Number(b.max_stake) || 0;
  if (b.paused != null) patch.paused = b.paused === "1" || b.paused === "on";
  if (b.bet_pass) patch.bet_pass = b.bet_pass;
  await db.slots.update(slot.id, patch);
  res.redirect("/slots");
});
router.post("/slots/:id/toggle", async (req, res) => {
  const slot = await db.slots.byId(req.params.id);
  if (!slot || Number(slot.user_id) !== Number(req.user.id)) return res.status(404).end();
  await db.slots.update(slot.id, { paused: !slot.paused });
  res.redirect("/slots");
});
router.post("/slots/:id/delete", async (req, res) => {
  const slot = await db.slots.byId(req.params.id);
  if (!slot || Number(slot.user_id) !== Number(req.user.id)) return res.status(404).end();
  await db.slots.remove(slot.id);
  res.redirect("/slots");
});

// ---- tips ----
router.get("/tips", async (req, res) => {
  const page = Number(req.query.page || 1);
  const { rows, total } = await db.tips.page(req.user.id, { page, limit: 25 });
  const withSlots = await Promise.all(rows.map(async t => ({ tip: t, slots: await db.tipSlots.byTip(t.id) })));
  res.render("tips", { page: "tips", tips: withSlots, pageNum: page, total, pages: Math.ceil(total / 25), RESULT: resultLabels });
});

// ---- eventos (log) ----
router.get("/events", async (req, res) => {
  res.render("events", { page: "events", events: await db.events.recent(200) });
});

// ---- conta ----
router.get("/account", async (req, res) => {
  res.render("account", { page: "account", apiKey: req.user.api_key, rotated: req.query.rotated });
});
router.post("/account/rotate-key", async (req, res) => {
  await db.users.rotateApiKey(req.user.id);
  res.redirect("/account?rotated=1");
});

const resultLabels = { 0: { t: "Pendente", c: "pending" }, 1: { t: "Green", c: "green" }, 2: { t: "Red", c: "red" }, 3: { t: "Void", c: "void" }, 4: { t: "½ Green", c: "hgreen" }, 5: { t: "½ Red", c: "hred" } };

module.exports = router;
