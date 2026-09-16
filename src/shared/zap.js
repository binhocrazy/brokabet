"use strict";
// [BET365_FEED_2026_09_13] Decodificador do protocolo "zap" do feed ao vivo da
// Bet365 (wss://premws*.365lpodds.com/zap/). Puro: recebe o texto de um frame,
// devolve objetos. Sem rede, sem estado de conexão.
//
// Formato observado:
//   frame            = "<topico>\x01<F|U>|<no>|<no>|..."
//   varios-por-frame = frames concatenados, separados por \x08, cada um podendo
//                      ter 1 byte de controle na frente (\x14 snapshot, \x15 update).
//   no               = "<TIPO>;k=v;k=v;..."   TIPO: EV CT MA MG PA IN CL IA ...
//   F = full (foto), U = update (só os campos que mudaram)
//
// Campos que usamos: SS placar, TM/TS relogio min/seg, TU hora do servidor
// (Londres, 14 digitos), TT relogio andando, ID, FI fixture, OD odd fracionaria,
// HA/HD handicap, SU suspenso, NA nome, IT id do item, UC="Gol" marca gol.

const CTRL = /^[\x00-\x1f]+/;

/** Divide um payload em frames individuais {ctrl, topico, tipo, corpo}. */
function separarFrames(payload) {
  const out = [];
  for (let bruto of String(payload).split("\x08")) {
    if (!bruto) continue;
    bruto = bruto.replace(CTRL, "");                 // tira \x14/\x15 da frente
    const i = bruto.indexOf("\x01");
    if (i < 0) continue;
    const topico = bruto.slice(0, i);
    const tipo = bruto[i + 1];                        // 'F' ou 'U'
    const corpo = bruto.slice(i + 3);                 // pula "\x01X|"
    out.push({ topico, tipo, corpo });
  }
  return out;
}

/** "TIPO;k=v;k=v" -> { _tipo, k: v, ... }. Valor pode conter '=' (fica no 1o). */
function parseNo(node) {
  const parts = node.split(";");
  const o = { _tipo: parts[0] };
  for (let p = 1; p < parts.length; p++) {
    const s = parts[p]; if (!s) continue;
    const k = s.indexOf("=");
    if (k > 0) o[s.slice(0, k)] = s.slice(k + 1);
  }
  return o;
}

/** Lista de nós {_tipo, ...} de um corpo. */
function parseNos(corpo) {
  const out = [];
  for (const node of corpo.split("|")) {
    if (!node) continue;
    out.push(parseNo(node));
  }
  return out;
}

/** Londres (BST/GMT) -> epoch ms UTC. TU = "AAAAMMDDHHMMSS". */
function tuParaMs(tu) {
  if (!/^\d{14}$/.test(tu)) return null;
  const y = +tu.slice(0, 4), mo = +tu.slice(4, 6) - 1, d = +tu.slice(6, 8);
  const h = +tu.slice(8, 10), mi = +tu.slice(10, 12), s = +tu.slice(12, 14);
  const t = Date.UTC(y, mo, d, h, mi, s);
  const ultDomOut = new Date(Date.UTC(y, 9, 31)); ultDomOut.setUTCDate(31 - ultDomOut.getUTCDay());
  const ultDomMar = new Date(Date.UTC(y, 2, 31)); ultDomMar.setUTCDate(31 - ultDomMar.getUTCDay());
  const bst = t >= Date.UTC(y, 2, ultDomMar.getUTCDate(), 1) && t < Date.UTC(y, 9, ultDomOut.getUTCDate(), 1);
  return t - (bst ? 3600000 : 0);
}

/** "N/M" -> decimal (ex "5/6" -> 1.833). Odd fracionaria da Bet365. */
function fracaoParaDecimal(od) {
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(String(od || ""));
  if (!m) return null;
  const n = +m[1], d = +m[2];
  return d ? +(1 + n / d).toFixed(4) : null;
}

module.exports = { separarFrames, parseNo, parseNos, tuParaMs, fracaoParaDecimal };
