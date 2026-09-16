"use strict";
// Executor — recebe uma tip e a dispara pra cada slot do dono, em paralelo, gravando
// tip_slots por slot (mesma ideia do dispatch do Brokalab: cada slot loga assim que
// responde). Escolhe o adaptador pelo campo slot.executor.

const db = require("../db");
const shadow = require("./adapters/shadow");
const jbot = require("./adapters/jbot");
const bet365 = require("./adapters/bet365");

const ADAPTERS = { shadow, jbot, bet365 };

function adapterFor(slot) {
  return ADAPTERS[slot.executor] || shadow;
}

// Dispara uma tip já persistida (row de tips) pra todos os slots ativos do dono.
async function dispatchTip(tip) {
  const slots = await db.slots.listActive(tip.user_id);
  const targets = slots.filter(s => String(s.bookie).toUpperCase() === String(tip.bookie).toUpperCase());
  if (!targets.length) {
    await db.events.log("warn", `tip sem slot ativo (${tip.bookie})`, { tip_id: tip.id });
    await db.tips.setStatus(tip.id, "done");
    return { placed: 0, slots: [] };
  }

  let params = {};
  try { params = typeof tip.parameters === "string" ? JSON.parse(tip.parameters) : (tip.parameters || {}); } catch {}

  await db.tips.setStatus(tip.id, "dispatched");

  const results = await Promise.allSettled(targets.map(async (slot) => {
    const row = await db.tipSlots.create(tip.id, slot.id, { stake: Number(params.stake) || Number(slot.stake) || null, starting_line: tip.line });
    const adapter = adapterFor(slot);
    try {
      const r = await adapter.placeBet(slot, tip, params);
      const status = r.status === "shadow" ? "shadow" : (r.status || "placed");
      await db.tipSlots.update(row.id, {
        status, code: r.code ?? null, stake: r.stake ?? null, odds: r.odds ?? null,
        starting_line: r.starting_line ?? tip.line, ending_line: r.ending_line ?? null,
        latency_ms: r.latency_ms ?? null,
        request_json: r.request ? JSON.stringify(r.request) : null,
        response_json: r.response ? JSON.stringify(r.response) : (r.note ? JSON.stringify({ note: r.note, would: r.would }) : null),
        placed_at: status === "placed" ? db_now() : null,
      });
      await db.events.log("info", `${adapter.name}: ${r.would || status} · ${slot.name}`, { slot_id: slot.id, tip_id: tip.id, data: { note: r.note } });
      return { slot: slot.name, status, would: r.would };
    } catch (e) {
      await db.tipSlots.update(row.id, { status: "failed", error: e.message, latency_ms: null });
      await db.events.log("error", `${adapter.name} falhou · ${slot.name}: ${e.message}`, { slot_id: slot.id, tip_id: tip.id });
      return { slot: slot.name, status: "failed", error: e.message };
    }
  }));

  await db.tips.setStatus(tip.id, "done");
  const placed = results.filter(r => r.status === "fulfilled" && ["placed", "shadow"].includes(r.value.status)).length;
  return { placed, slots: results.map(r => r.status === "fulfilled" ? r.value : { status: "failed", error: String(r.reason) }) };
}

function db_now() { return new Date().toISOString(); }

module.exports = { dispatchTip, ADAPTERS };
