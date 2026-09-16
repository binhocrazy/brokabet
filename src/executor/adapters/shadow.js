"use strict";
// Adaptador SOMBRA — não aposta de verdade. Consulta o Leitor pra saber a odd/linha
// atual, aplica as mesmas checagens de drift/range que o executor real vai aplicar,
// e devolve o que ACONTECERIA. É o modo de rodar em paralelo com o JBot e conferir
// (seção 4 do DEPLOY do leitor) antes de confiar em aposta real.

const reader = require("../../reader");
const { computeLineParams, lineWithin } = require("../lineParams");

module.exports = {
  name: "shadow",
  // slot, tip (row do banco), params (parameters já parseados)
  async placeBet(slot, tip, params) {
    const started = Date.now();
    let current = null, note = "";
    // resolve pelo game_id (event_id); se a tip não trouxe, cai no fixture_id
    const gameId = tip.event_id || tip.fixture_id;
    try {
      const found = await reader.findByOddId(gameId, tip.odd_id, tip.bookie);
      current = found.outcome;
      if (!current) note = "seleção não encontrada no leitor (suspensa/puxada)";
    } catch (e) {
      note = `leitor indisponível: ${e.message}`;
    }

    // lado da seleção: do nome do outcome atual, senão da descrição
    const desc = String(tip.description || "").toLowerCase();
    const oname = String(current?.name || "").toLowerCase();
    const side = oname.includes("under") || desc.includes("under") ? "under"
      : oname.includes("over") || desc.includes("over") ? "over" : desc;
    const line = computeLineParams({
      selection: side,
      line: tip.line,
      toleranceUp: params.toleranceUp ?? params.tolerance ?? 0.5,
      toleranceDown: params.toleranceDown ?? params.tolerance ?? 0.5,
      strict: !!params.strictLine,
    });

    const currentLine = current?.line ?? current?.handicap ?? tip.line;
    const within = lineWithin(line, currentLine);
    const stake = Number(params.stake) || Number(slot.stake) || 1;
    const oddDecimal = current?.decimal_odd ?? null;

    // decisão que o executor real tomaria
    const would = current && within ? "placed" : "rejected";
    return {
      status: "shadow",
      would,
      code: null,
      stake,
      odds: oddDecimal,
      starting_line: tip.line,
      ending_line: currentLine != null ? String(currentLine) : null,
      latency_ms: Date.now() - started,
      note: note || (within ? "linha dentro do range" : "linha fora do range → rejeitaria"),
      request: { line_params: line, current_odd: current?.fraction_odd, current_line: currentLine },
    };
  },

  // sombra não liquida — quem liquida é o settlement pelo placar do leitor
  async settle() { return null; },
};
