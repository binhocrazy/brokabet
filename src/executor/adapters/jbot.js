"use strict";
// Adaptador JBOT — encaminha a aposta pro serviço do Felipe (apijbot.jbot.com.br),
// exatamente como o Brokalab faz hoje. Serve de ponte: um slot pode executar via
// JBot enquanto o executor Bet365 direto ainda não está pronto, sem mudar nada do
// resto do Brokabet. O `jbot_key` do slot é o client_key da conta Jarvis.
//
// Formato do placebet V2 (swagger): tip{sport_id,fixture_id,odd_id,fraction_odd,line,
// description} + parameters{stake,adjust_line,unlimited_*,max_line,min_line} + event_id.

const { computeLineParams } = require("../lineParams");

const BASE = process.env.JBOT_API_BASE || "https://apijbot.jbot.com.br";
const TIMEOUT = Number(process.env.JBOT_TIMEOUT_MS) || 35000;

function sanitize(s) {
  return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[·•]/g, "-").replace(/[–—−]/g, "-").replace(/\//g, "-")
    .replace(/(\d)\.(\d)/g, "$1-$2").replace(/[^\x20-\x7E]/g, "").replace(/\s+/g, " ").trim();
}

module.exports = {
  name: "jbot",
  async placeBet(slot, tip, params) {
    const key = slot.jbot_key;
    if (!key) throw new Error("slot sem jbot_key (client_key do JBot)");
    const started = Date.now();

    const side = String(tip.description || "").toLowerCase();
    const lp = computeLineParams({
      selection: side.includes("under") ? "under" : side.includes("over") ? "over" : side,
      line: tip.line,
      toleranceUp: params.toleranceUp ?? params.tolerance ?? 0.5,
      toleranceDown: params.toleranceDown ?? params.tolerance ?? 0.5,
      strict: !!params.strictLine,
    });

    const tipData = {
      sport_id: tip.sport_id, fixture_id: tip.fixture_id, odd_id: tip.odd_id,
      fraction_odd: tip.fraction_odd, line: tip.line != null ? String(tip.line) : "",
      description: sanitize(tip.description),
    };
    const parameters = {
      stake: Number(params.stake) || Number(slot.stake) || 0,
      adjust_line: lp.adjustLine, unlimited_max_line: lp.unlimitedMaxLine,
      unlimited_min_line: lp.unlimitedMinLine, max_line: lp.maxLine, min_line: lp.minLine,
    };
    const bookiePath = (String(tip.bookie).toUpperCase() === "SUPERBET") ? "super"
      : (String(tip.bookie).toUpperCase() === "BETANO") ? "btno" : "b365";
    const body = JSON.stringify({ tip: tipData, parameters, event_id: tip.event_id ?? null });

    const res = await fetch(`${BASE}/api/placebet/${bookiePath}/tips`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", Authorization: key, "User-Agent": "Brokabet/0.1", Connection: "close" },
      body, signal: AbortSignal.timeout(TIMEOUT),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`JBot placebet → ${res.status}: ${text.slice(0, 300)}`);
    let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
    return {
      status: "placed", code: parsed?.data?.unique_id || parsed?.unique_id || null,
      stake: parameters.stake, odds: null, starting_line: tip.line, ending_line: null,
      latency_ms: Date.now() - started, request: { tip: tipData, parameters }, response: parsed,
    };
  },
  async settle() { return null; }, // resultados vêm do sync de tips do JBot (a implementar por slot)
};
