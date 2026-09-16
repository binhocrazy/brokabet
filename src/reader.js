"use strict";
// Cliente do Leitor Bet365 (o mesmo feed que o Brokalab consome). Só leitura.
// Usado pra: (1) resolver a odd/linha ATUAL de uma seleção antes de apostar,
// (2) achar a seleção equivalente quando a linha mudou (adjust_line lado-nosso),
// (3) liquidar pelo placar final quando não der pra ler "Minhas Apostas".

const BASE = process.env.BET365_READ_BASE || "http://127.0.0.1:8365";
const TIMEOUT = Number(process.env.READER_TIMEOUT_MS) || 6000;

async function get(pathQ) {
  const res = await fetch(`${BASE}${pathQ}`, { signal: AbortSignal.timeout(TIMEOUT) });
  if (!res.ok) throw new Error(`leitor ${pathQ} → ${res.status}`);
  const j = await res.json();
  return j.data ?? j;
}

const bookiePath = (bookie) => (String(bookie || "B365").toUpperCase() === "B365" ? "b365"
  : String(bookie).toLowerCase());

const reader = {
  base: BASE,
  health: () => get("/saude"),
  games: (sportId, bookie = "B365") => get(`/api/scrap/${bookiePath(bookie)}/games?sport_id=${sportId}`),
  detail: (fixtureId, bookie = "B365") => get(`/api/scrap/${bookiePath(bookie)}/games/${fixtureId}`),

  // Localiza uma seleção pelo odd_id dentro do detalhe do jogo. Devolve
  // { market, outcome } com a odd/linha ATUAL, ou null se sumiu (suspensa/puxada).
  // gameId é o id do TOPO da lista (com que o detalhe é indexado) — no protocolo,
  // o event_id. NÃO é o fixture_id da seleção (esse vai pro Bet365 como `f`).
  async findByOddId(gameId, oddId, bookie = "B365") {
    const det = await reader.detail(gameId, bookie);
    for (const m of det.markets || []) {
      for (const o of m.outcomes || []) {
        if (String(o.odd_id) === String(oddId)) return { detail: det, market: m, outcome: o };
      }
    }
    return { detail: det, market: null, outcome: null };
  },

  // Quando a linha mudou e o odd_id não existe mais, acha a seleção "irmã":
  // mesmo mercado (name+team+quarter), mesmo lado (OVER/UNDER/HOME/...), linha
  // mais próxima. É o que permite reapostar sem perder a intenção.
  async findEquivalent(fixtureId, { marketName, team, quarter, side, targetLine }, bookie = "B365") {
    const det = await reader.detail(fixtureId, bookie);
    let best = null;
    for (const m of det.markets || []) {
      if (m.name !== marketName) continue;
      if ((m.team ?? null) !== (team ?? null)) continue;
      if ((m.quarter ?? null) !== (quarter ?? null)) continue;
      for (const o of m.outcomes || []) {
        if (side && o.name !== side) continue;
        const line = Number(o.line ?? o.handicap);
        const dist = Number.isFinite(line) && targetLine != null ? Math.abs(line - Number(targetLine)) : 0;
        if (!best || dist < best.dist) best = { market: m, outcome: o, dist };
      }
    }
    return best;
  },
};

module.exports = reader;
