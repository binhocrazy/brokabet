"use strict";
// X-Net-Sync-Term por COLHEITA na aba — Fase 1.
//
// Em vez de reimplementar o gerador ofuscado da Bet365 (o "muro" da Fase 0),
// grudamos via CDP na aba bet365 do slot (o Chrome do leitor, porta 9222) e
// capturamos os tokens que o JS DA PRÓPRIA PÁGINA gera:
//
//   1. header X-Net-Sync-Term dos fetch/XHR da página (o token "oficial")
//   2. A_<token> dos frames zap enviados (pshudws) — mesmo gerador, segundo a
//      captura da Fase 0 (docs/PROTOCOLO_BET365.md §4)
//
// Premissa a validar no PC: um token fresco gerado pela página é aceito num
// request nosso (addbet/placebet/login) feito fora do navegador. Se a Bet365
// amarrar o token ao request que o originou, a colheita falha e a saída é
// invocar o gerador no contexto da página via Runtime.evaluate — o hook grava
// a FONTE de cada token (fetch/xhr/zap) justamente pra esse diagnóstico.
//
// Uma aba por slot (sessão única por conta — §5 do protocolo). O tabId fica em
// memória; se a aba for fechada/navegar, re-anexa e re-injeta o hook (a troca
// de processo no login descarta a sessão CDP — mesmo caso do captura-aposta).
//
// Env: BET365_CDP_PORT (9222) · NET_SYNC_TTL_MS (60000) · NETSYNC_URL (ao vivo)

const CDP_PORT = Number(process.env.BET365_CDP_PORT || 9222);
const TTL_MS = Number(process.env.NET_SYNC_TTL_MS || 60000);
const URL_INICIAL = process.env.NETSYNC_URL || "https://www.bet365.bet.br/#/IP/B1";

// Hook injetado na página. Mantém window.__brokabetNS = { v, token, ts, fonte }.
// ts é o Date.now() da página — mesma máquina, comparável com o nosso.
const HOOK = `(() => {
  if (window.__brokabetNS && window.__brokabetNS.v === 1) return true;
  const st = { v: 1, token: null, ts: 0, fonte: null };
  const guarda = (t, fonte) => {
    if (typeof t === "string" && t.length >= 16) { st.token = t; st.ts = Date.now(); st.fonte = fonte; }
  };

  // 1) fetch — header no init.headers (objeto, array ou Headers) ou no Request
  const of = window.fetch;
  if (of) window.fetch = function (input, init) {
    try {
      let t = null;
      const h = init && init.headers;
      if (h) {
        if (typeof h.get === "function") t = h.get("X-Net-Sync-Term");
        else if (Array.isArray(h)) { const p = h.find((e) => /^x-net-sync-term$/i.test(e[0])); t = p && p[1]; }
        else t = h["X-Net-Sync-Term"] || h["x-net-sync-term"];
      }
      if (!t && input && input.headers && typeof input.headers.get === "function") t = input.headers.get("X-Net-Sync-Term");
      if (t) guarda(t, "fetch");
    } catch (e) {}
    return of.apply(this, arguments);
  };

  // 2) XHR — setRequestHeader pega qualquer chamada da página
  const osrh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) {
    try { if (/^x-net-sync-term$/i.test(k)) guarda(v, "xhr"); } catch (e) {}
    return osrh.apply(this, arguments);
  };

  // 3) frames zap enviados: "...,A_<token>\\x01" (assinatura __udsv do pshudws)
  const osend = WebSocket.prototype.send;
  WebSocket.prototype.send = function (data) {
    try {
      if (typeof data === "string") {
        const m = data.match(/A_([A-Za-z0-9+/=]{16,})/);
        if (m) guarda(m[1], "zap");
      }
    } catch (e) {}
    return osend.apply(this, arguments);
  };

  Object.defineProperty(window, "__brokabetNS", { value: st, configurable: true, writable: true });
  return true;
})()`;

// ---- CDP mínimo (mesmo padrão dos scripts/poc) ----
let cdp = null; // { ws, send, on }
async function conectar() {
  if (cdp && cdp.ws.readyState === WebSocket.OPEN) return cdp;
  const ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map(); const ouvintes = [];
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const m = { id: ++id, method, params: params || {} };
    if (sessionId) m.sessionId = sessionId;
    pend.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); return; }
    for (const f of ouvintes) f(m);
  };
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = () => rej(new Error(`CDP não abriu na porta ${CDP_PORT} — o Chrome do leitor está de pé?`));
  });
  cdp = { ws, send, on: (f) => ouvintes.push(f) };
  cdp.ws.onclose = () => { cdp = null; };
  return cdp;
}

async function evalJs(sessionId, expression) {
  const c = await conectar();
  const r = await c.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sessionId);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "erro no eval da aba");
  return r.result?.value;
}

// ---- abas por slot ----
const abas = new Map(); // chave (slot.id) -> { targetId, sessionId }

function chaveSlot(slot) { return String(slot?.id ?? slot?.name ?? "default"); }

async function ehAbaDoLeitor(sessionId) {
  const v = await evalJs(sessionId, "!!window.__zapInstalado").catch(() => true);
  return v === true;
}

// Acha a aba do slot: a já registrada, uma aba bet365 livre (não-leitor e não
// usada por outro slot), ou uma nova. Nunca toca na aba do leitor.
async function acharAba(slot) {
  const c = await conectar();
  const reg = abas.get(chaveSlot(slot));
  const { targetInfos } = await c.send("Target.getTargets");
  const paginas = targetInfos.filter((t) => t.type === "page");

  if (reg && paginas.some((t) => t.targetId === reg.targetId)) return reg.targetId;

  // sessão persistida pelo fluxo de login (quando existir) tem prioridade
  let salvo = null;
  try { salvo = JSON.parse(slot?.session_json || "{}").tabId || null; } catch { salvo = null; }
  if (salvo && paginas.some((t) => t.targetId === salvo)) return salvo;

  const usadas = new Set([...abas.values()].map((a) => a.targetId));
  for (const t of paginas.filter((t) => /bet365\.bet\.br\//.test(t.url) && !usadas.has(t.targetId))) {
    const at = await c.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    if (!(await ehAbaDoLeitor(at.sessionId))) {
      await c.send("Target.detachFromTarget", { sessionId: at.sessionId }).catch(() => {});
      return t.targetId;
    }
    await c.send("Target.detachFromTarget", { sessionId: at.sessionId }).catch(() => {});
  }

  const { targetId } = await c.send("Target.createTarget", { url: URL_INICIAL });
  return targetId;
}

async function anexar(slot) {
  const c = await conectar();
  const targetId = await acharAba(slot);
  const { sessionId } = await c.send("Target.attachToTarget", { targetId, flatten: true });
  await c.send("Page.enable", {}, sessionId);
  await c.send("Runtime.enable", {}, sessionId);
  // injeta agora e em toda navegação futura (login troca o processo da aba)
  await c.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK }, sessionId).catch(() => {});
  await evalJs(sessionId, HOOK).catch(() => {});
  abas.set(chaveSlot(slot), { targetId, sessionId });
  return { targetId, sessionId };
}

let escutaDetach = false;
async function garantirEscuta() {
  if (escutaDetach) return;
  escutaDetach = true;
  const c = await conectar();
  c.on(async (m) => {
    if (m.method !== "Target.detachedFromTarget") return;
    const sid = m.params?.sessionId;
    for (const [chave, reg] of abas) {
      if (reg.sessionId !== sid) continue;
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          const at = await c.send("Target.attachToTarget", { targetId: reg.targetId, flatten: true });
          reg.sessionId = at.sessionId;
          await c.send("Page.enable", {}, reg.sessionId);
          await c.send("Page.addScriptToEvaluateOnNewDocument", { source: HOOK }, reg.sessionId).catch(() => {});
          await evalJs(reg.sessionId, HOOK).catch(() => {});
          return;
        } catch { /* aba em transição */ }
      }
      abas.delete(chave); // aba morreu de vez — próxima harvest recria
    }
  });
}

// Estado do token na aba do slot (diagnóstico): { token, ts, fonte, idadeMs }
async function status(slot) {
  const reg = await anexar(slot);
  const ns = await evalJs(reg.sessionId, "window.__brokabetNS ? { token: __brokabetNS.token, ts: __brokabetNS.ts, fonte: __brokabetNS.fonte } : null");
  if (!ns || !ns.token) return { pronto: false, motivo: "página ainda não gerou token (aba carregando/deslogada?)", tabId: reg.targetId };
  return { pronto: Date.now() - ns.ts <= TTL_MS, token: ns.token, fonte: ns.fonte, idadeMs: Date.now() - ns.ts, tabId: reg.targetId };
}

// O ponto que o adaptador bet365 consome: token fresco ou erro claro.
async function harvest(slot) {
  await garantirEscuta();
  const st = await status(slot);
  if (!st.token) {
    const e = new Error(`X-Net-Sync-Term indisponível: ${st.motivo}`);
    e.code = "NETSYNC_MISSING";
    throw e;
  }
  if (!st.pronto) {
    const e = new Error(`X-Net-Sync-Term velho (${Math.round(st.idadeMs / 1000)}s, fonte ${st.fonte}) — a página parou de gerar tokens`);
    e.code = "NETSYNC_STALE";
    throw e;
  }
  return st.token;
}

module.exports = { harvest, status, HOOK };
