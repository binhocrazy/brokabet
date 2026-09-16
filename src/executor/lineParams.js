"use strict";
// Range side-aware — trazido do Brokalab (src/jarvis/index.js), a regra do Felipe
// sobre a armadilha do UNDER. Vale independentemente de quem executa: define o
// intervalo de linha aceitável e para qual lado a linha pode andar livre.
//
//   OVER X   → linha CAI = melhor  → limita teto, libera piso
//   UNDER X  → linha SOBE = melhor → limita piso, libera teto
//   *_plus_  → linha SOBE = melhor → limita piso, libera teto
//   *_minus_ → linha CAI = melhor  → limita teto, libera piso
//
// Se `strict`, tolerância = 0 (só a linha exata).

function computeLineParams({ selection, side, line, toleranceUp = 0.5, toleranceDown = 0.5, strict = false }) {
  const L = Number(line);
  const hasLine = !Number.isNaN(L) && line != null && line !== "";
  const empty = { adjustLine: false, unlimitedMaxLine: false, unlimitedMinLine: false, maxLine: 0, minLine: 0 };
  if (!hasLine) return empty;

  const tolUp = strict ? 0 : Math.max(0, Number(toleranceUp) || 0);
  const tolDown = strict ? 0 : Math.max(0, Number(toleranceDown) || 0);
  const sel = String(selection || side || "").toLowerCase();

  if (/^(home|away|draw)_plus_/.test(sel)) {
    return { adjustLine: true, unlimitedMinLine: false, unlimitedMaxLine: true, minLine: +(L - tolDown).toFixed(2), maxLine: 0 };
  }
  if (/^(home|away|draw)_minus_/.test(sel)) {
    return { adjustLine: true, unlimitedMinLine: true, unlimitedMaxLine: false, minLine: 0, maxLine: +(L + tolUp).toFixed(2) };
  }
  if (sel.startsWith("over")) {
    return { adjustLine: true, unlimitedMinLine: true, unlimitedMaxLine: false, minLine: 0, maxLine: +(L + tolUp).toFixed(2) };
  }
  if (sel.startsWith("under")) {
    return { adjustLine: true, unlimitedMinLine: false, unlimitedMaxLine: true, minLine: +(L - tolDown).toFixed(2), maxLine: 0 };
  }
  return empty;
}

// Dado um range e uma linha atual, diz se a linha está dentro do aceitável.
function lineWithin(params, currentLine) {
  if (!params.adjustLine) return true;
  const L = Number(currentLine);
  if (!Number.isFinite(L)) return true;
  if (!params.unlimitedMinLine && L < Number(params.minLine)) return false;
  if (!params.unlimitedMaxLine && L > Number(params.maxLine)) return false;
  return true;
}

// Lado "pior" da estratégia (usado por drift check e acceptWorseLine).
function worseDirection(selection) {
  const sel = String(selection || "").toLowerCase();
  return {
    up: sel.startsWith("over") || /^(home|away|draw)_minus_/.test(sel),
    down: sel.startsWith("under") || /^(home|away|draw)_plus_/.test(sel),
  };
}

module.exports = { computeLineParams, lineWithin, worseDirection };
