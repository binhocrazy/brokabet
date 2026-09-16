"use strict";
// API compatível com o apijbot.jbot.com.br — pra o Brokalab (e qualquer cliente que
// já fale JBot) apontar `BROKABET_BASE` pra cá e não mudar mais nada.
//
// Auth: header Authorization: <api_key uuid>  (= o client_key do JBot)
// Wrapper de resposta: { status_code, is_success, data }
//
// Rotas espelhadas:
//   POST /api/placebet/:bookie/tips          → cria tip e dispara (o Jarvis "executa")
//   POST /api/placebet/:bookie/tips/slots    → idem, roteando por slots_tokens
//   GET  /api/slots                          → slots do dono (token, balance, status...)
//   GET  /api/tips                           → tips paginadas
//   GET  /api/tips/:uniqueId/slots           → execução por slot (code, stake, result...)

const express = require("express");
const db = require("../db");
const executor = require("../executor");

const router = express.Router();

const ok = (res, data) => res.json({ status_code: 200, is_success: true, data });
const fail = (res, code, msg) => res.status(code).json({ status_code: code, is_success: false, message: msg });

// enum ETipResult do JBot
const RESULT_ENUM = { 0: "PENDING", 1: "WON", 2: "LOST", 3: "VOID", 4: "HALF_WON", 5: "HALF_LOST" };
// code = status da execução (semântica JBot)
function slotCode(ts) {
  if (ts.status === "placed") return ts.ending_line && ts.ending_line !== ts.starting_line ? "LINHA ALTERADA" : "OK";
  if (ts.status === "shadow") return "SOMBRA";
  if (ts.status === "rejected") return "APOSTA NEGADA";
  if (ts.status === "failed") return ts.error && /log90|login|logado/i.test(ts.error) ? "NAO LOGADO" : "ERRO";
  return "PENDENTE";
}

// auth por api_key
async function auth(req, res, next) {
  const key = req.get("Authorization");
  if (!key) return fail(res, 401, "Authorization ausente");
  const user = await db.users.byApiKey(key.replace(/^Bearer\s+/i, "").trim());
  if (!user) return fail(res, 401, "client_key inválido");
  req.user = user;
  next();
}

function bookieFromPath(p) {
  return ({ b365: "B365", super: "SUPERBET", btno: "BETANO" })[String(p).toLowerCase()] || "B365";
}

// ---- POST placebet ----
async function receiveTip(req, res) {
  const bookie = bookieFromPath(req.params.bookie);
  const body = req.body || {};
  const t = body.tip || {};
  if (t.fixture_id == null || t.odd_id == null) return fail(res, 400, "tip.fixture_id e tip.odd_id são obrigatórios");

  const tip = await db.tips.create(req.user.id, {
    bookie, sport_id: t.sport_id, fixture_id: t.fixture_id, event_id: body.event_id ?? t.event_id,
    odd_id: t.odd_id, fraction_odd: t.fraction_odd, line: t.line, description: t.description,
    parameters: body.parameters || {}, source: "api",
  });
  await db.events.log("info", `tip recebida via API: ${t.description || tip.unique_id}`, { tip_id: tip.id });

  // dispara em background — a resposta volta na hora com o unique_id (como o JBot)
  executor.dispatchTip(tip).catch(e => db.events.log("error", `dispatch falhou: ${e.message}`, { tip_id: tip.id }));

  return ok(res, { unique_id: tip.unique_id, accepted: true });
}

router.post("/api/placebet/:bookie/tips", auth, receiveTip);
router.post("/api/placebet/:bookie/tips/slots", auth, receiveTip);

// ---- GET slots ----
router.get("/api/slots", auth, async (req, res) => {
  const rows = await db.slots.list(req.user.id);
  ok(res, rows.map(s => ({
    token: s.token, bet_house: s.bookie, name: s.name,
    using: s.using_now, paused: s.paused, hibernating: s.hibernating,
    user_bet: s.bet_user, balance: s.balance, open_balance: s.open_balance,
    status: s.status, executor: s.executor,
  })));
});

// ---- GET tips ----
router.get("/api/tips", auth, async (req, res) => {
  const page = Number(req.query.Page || req.query.page || 1);
  const limit = Number(req.query.Limit || req.query.limit || 20);
  const bookie = req.query.host_bet ? bookieFromPath(String(req.query.host_bet).toLowerCase()) : null;
  const { rows, total } = await db.tips.page(req.user.id, { bookie, page, limit });
  ok(res, {
    page_count: Math.ceil(total / limit), total_count: total,
    tips: rows.map(t => ({ date: t.created_at, bet_house: t.bookie, unique_id: t.unique_id, description: t.description, line: t.line })),
  });
});

// ---- GET tips/:id/slots ----
router.get("/api/tips/:uniqueId/slots", auth, async (req, res) => {
  const tip = await db.tips.byUniqueId(req.params.uniqueId);
  if (!tip || tip.user_id !== req.user.id) return fail(res, 404, "tip não encontrada");
  const rows = await db.tipSlots.byTip(tip.id);
  ok(res, {
    page_count: 1, total_count: rows.length,
    tips: rows.map(ts => ({
      slot_name: ts.slot_name, code: slotCode(ts), stake: ts.stake,
      starting_line: ts.starting_line, ending_line: ts.ending_line, odds: ts.odds,
      tip_result: ts.tip_result, result_label: RESULT_ENUM[ts.tip_result],
      unit: ts.unit, total_returns: ts.total_returns,
    })),
  });
});

module.exports = router;
