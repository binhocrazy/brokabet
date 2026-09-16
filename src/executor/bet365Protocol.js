"use strict";
// Montador do cupom Bet365 — constrói os corpos de /BetsWebAPI/addbet e /placebet
// no formato capturado na Fase 0 (docs/PROTOCOLO_BET365.md). Puro: recebe dados,
// devolve strings. Sem rede. Serve à simulação (sombra) HOJE e ao executor real
// depois — o único pedaço que falta pra virar real é o header X-Net-Sync-Term.
//
// ns decodificado do addbet:
//   pt=N#o=<odd>#f=<fixture>#fp=<odd_id>#so=#c=<sport>#pv=<odd>#mt=<mkt>#id=<fixture>-<odd_id>Y#|TP=BS<fixture>-<odd_id>#av=1#||
// ns decodificado do placebet:
//   pt=N#o=<odd>#pv=<odd>#f=<fixture>#fp=<odd_id>#so=#c=<sport>#sa=<sa>#mt=<mkt>#|TP=BS<fixture>-<odd_id>#ust=<stake>#st=<stake>#tr=<retorno>#||

// mapeia sport_id → `c` do cupom (classificação). 1 futebol, 18 basquete (iguais).
function sportClass(sportId) { return String(sportId || 1); }

// odd fracionária (Bet365 trabalha em fração no cupom). Se só temos decimal,
// aproxima — mas o ideal é vir a fraction_odd direto do leitor.
function toFraction(fractionOdd, decimalOdd) {
  if (fractionOdd && /^\d+\/\d+$/.test(fractionOdd)) return fractionOdd;
  const d = Number(decimalOdd);
  if (!(d > 1)) return "0/1";
  const x = d - 1;
  let h1 = 1, k1 = 1, h0 = 0, k0 = 1, v = x;
  for (let i = 0; i < 25; i++) {
    const a = Math.floor(v), h2 = a * h1 + h0, k2 = a * k1 + k0;
    if (k2 > 50) break; h0 = h1; h1 = h2; k0 = k1; k1 = k2;
    const f = v - a; if (f < 1e-9) break; v = 1 / f;
  }
  return `${h1}/${k1}`;
}

// urlencode no mesmo estilo do cliente (só o ns vai encodado no corpo).
function enc(s) { return encodeURIComponent(s); }

// Monta o corpo do addbet. `mt` (market type id) ainda não vem do leitor — passa
// null e o campo fica vazio; o executor real vai precisar dele (TODO Fase 1).
function buildAddbet({ fixtureId, oddId, sportId, fractionOdd, decimalOdd, marketType }) {
  const odd = toFraction(fractionOdd, decimalOdd);
  const mt = marketType != null ? String(marketType) : "";
  const ns = `pt=N#o=${odd}#f=${fixtureId}#fp=${oddId}#so=#c=${sportClass(sportId)}#pv=${odd}#mt=${mt}#id=${fixtureId}-${oddId}Y#|TP=BS${fixtureId}-${oddId}#av=1#||`;
  const body = `&ns=${enc(ns)}&rbp=undefined&betsource=FlashInPLay&bs=99&cr=1&xb=1`;
  return { ns, body, odd };
}

// Monta o corpo do placebet. `sa` vem da resposta do addbet; `aa` = null 1ª
// tentativa, 0 no reenvio (odd mudou). retorno = stake × odd decimal.
function buildPlacebet({ fixtureId, oddId, sportId, fractionOdd, decimalOdd, marketType, sa, stake, acceptChange = false }) {
  const odd = toFraction(fractionOdd, decimalOdd);
  const mt = marketType != null ? String(marketType) : "";
  const dec = Number(decimalOdd) || (odd.includes("/") ? 1 + (+odd.split("/")[0]) / (+odd.split("/")[1]) : 1);
  const ret = (Number(stake) * dec).toFixed(2);
  const st = Number(stake).toFixed(2);
  const ns = `pt=N#o=${odd}#pv=${odd}#f=${fixtureId}#fp=${oddId}#so=#c=${sportClass(sportId)}#sa=${sa || ""}#mt=${mt}#|TP=BS${fixtureId}-${oddId}#ust=${st}#st=${st}#tr=${ret}#||`;
  const body = `&ns=${enc(ns)}&xb=1&aa=${acceptChange ? 0 : "null"}&betsource=FlashInPLay&tagType=WindowsDesktopBrowser&bs=99&qb=1`;
  return { ns, body, expectedReturn: Number(ret), stake: Number(st) };
}

module.exports = { buildAddbet, buildPlacebet, toFraction, sportClass };
