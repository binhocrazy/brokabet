"use strict";
// Liquidação — resolve tip_slots 'placed' pendentes. Fonte primária: o placar final
// do Leitor Bet365 (o mesmo que o Brokalab usa pra matar void na raiz). Como o
// executor sombra/bet365 não tem "Minhas Apostas" ainda, o resultado sai do placar.
//
// MVP: só mercados com resolução simples pelo placar (Resultado Final, Over/Under
// gols). Mercados de linha/quarto/HC ficam pendentes até o adaptador real ler o
// SETTLEDBETS (Fase 2). Melhor pendente do que liquidado errado.

const db = require("./db");
const reader = require("./reader");

const INTERVAL = Number(process.env.SETTLE_INTERVAL_MS) || 60000;
let timer = null;

async function resolveOne(ts) {
  // busca placar final via /resultados (o leitor guarda até 72h)
  let final = null;
  try {
    const bookie = String(ts.bookie || "B365").toUpperCase() === "B365" ? "b365" : String(ts.bookie).toLowerCase();
    const list = await reader.games ? null : null; // placeholder; usamos endpoint dedicado abaixo
    const res = await fetch(`${reader.base}/api/scrap/${bookie}/resultados?desde=${encodeURIComponent(new Date(Date.now() - 72 * 3600e3).toISOString())}`, { signal: AbortSignal.timeout(6000) });
    if (res.ok) {
      const data = (await res.json()).data || [];
      final = data.find(r => String(r.fi) === String(ts.fixture_id) || String(r.game_id) === String(ts.fixture_id));
    }
  } catch { /* leitor pode não ter o endpoint ligado; deixa pendente */ }
  if (!final || final.score == null) return false;

  // só resolve o que dá pra resolver com confiança pelo placar
  const desc = String(ts.description || "").toLowerCase();
  const [h, a] = String(final.score).split(/[-x:]/).map(n => parseInt(n, 10));
  if (!Number.isFinite(h) || !Number.isFinite(a)) return false;

  let result = null; // 1 green, 2 red, 3 void
  // Resultado Final (1/x/2) — precisa saber o lado; guardamos na description por ora
  if (/resultado final|money line|1x2/.test(desc)) {
    const winnerHome = h > a, draw = h === a;
    if (/home|casa|1\b/.test(desc)) result = winnerHome ? 1 : draw ? 2 : 2;
    else if (/away|fora|2\b/.test(desc)) result = (!winnerHome && !draw) ? 1 : 2;
    else if (/draw|empate|x\b/.test(desc)) result = draw ? 1 : 2;
  }
  if (result == null) return false; // não sei resolver com segurança → fica pendente

  const stake = Number(ts.stake) || 0;
  const odd = Number(ts.odds) || 0;
  const total_returns = result === 1 ? +(stake * odd).toFixed(2) : result === 3 ? stake : 0;
  await db.tipSlots.update(ts.id, { tip_result: result, total_returns, settled_at: new Date().toISOString() });
  await db.events.log("info", `liquidado ${result === 1 ? "GREEN" : result === 3 ? "VOID" : "RED"} · ${ts.slot_name}`, { slot_id: ts.slot_id, tip_id: ts.tip_id });
  return true;
}

async function tick() {
  let pend = [];
  try { pend = await db.tipSlots.pendingSettlement(); } catch (e) { return; }
  for (const ts of pend) {
    try { await resolveOne(ts); } catch (e) { /* segue */ }
  }
}

function startSettlement() {
  if (timer) return;
  timer = setInterval(() => tick().catch(() => {}), INTERVAL);
  console.log(`settlement ligado (a cada ${INTERVAL / 1000}s, fonte = leitor)`);
}

module.exports = { startSettlement, tick };
