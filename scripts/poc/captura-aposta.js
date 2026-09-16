#!/usr/bin/env node
"use strict";
// [BROKABET_FASE0_2026_09_16] Captura o que a Bet365 faz por baixo quando VOCÊ
// aposta à mão. Abre uma aba NOVA no Chrome do leitor (mesma sessão/login) e
// grava, em JSONL, todo o tráfego dessa aba que não seja estático:
//
//   - requisições HTTP (método, url, headers, corpo do POST)
//   - respostas (status, tipo, corpo de json/texto)
//   - frames de WebSocket enviados e recebidos (menos o firehose de odds do
//     premws recebido, que o leitor já conhece — desse só contamos)
//
// Aba própria porque o leitor recarrega a aba DELE a cada 15s (RECARREGAR_MS)
// e derrubaria o cupom no meio da aposta.
//
// Enquanto roda, tudo que você digitar no terminal vira um MARCADOR no dump
// ("adicionei ao cupom", "confirmei", "odd mudou"...) — é isso que depois
// permite casar cada clique com as requisições. Ctrl+C encerra, fecha a aba e
// imprime um resumo dos endpoints vistos.
//
// Dois modos:
//   - interativo (padrão, terminal): cria a aba, marcadores vêm do stdin, Ctrl+C encerra.
//   - assistido (CAPTURA_ABA=existente): gruda numa aba bet365 JÁ ABERTA que não
//     seja a do leitor (a do leitor tem window.__zapInstalado). Marcadores e fim
//     chegam por HTTP em 127.0.0.1:CAPTURA_CTRL_PORT:
//        POST /marcador  {"texto":"..."}      POST /fim
//     É o modo que o Claude usa quando dirige a aba pelo agent-browser.
//
// Env: BET365_CDP_PORT (9222) · CAPTURA_URL (ao vivo) · CAPTURA_MAX_BODY (65536)
//      CAPTURA_ABA (nova|existente) · CAPTURA_CTRL_PORT (8399)

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const http = require("http");

const CDP_PORT = Number(process.env.BET365_CDP_PORT || 9222);
const URL_INICIAL = process.env.CAPTURA_URL || "https://www.bet365.bet.br/#/IP/B1";
const MAX_BODY = Number(process.env.CAPTURA_MAX_BODY || 65536);
const ABA_EXISTENTE = process.env.CAPTURA_ABA === "existente";
const CTRL_PORT = Number(process.env.CAPTURA_CTRL_PORT || 8399);
const DIR = path.join(__dirname, "..", "..", "capturas");
const ESTATICO = /\.(js|css|png|jpe?g|gif|svg|webp|ico|woff2?|ttf|otf|mp4|webm|map)(\?|$)/i;

fs.mkdirSync(DIR, { recursive: true });
const carimbo = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const arquivo = path.join(DIR, `aposta-${carimbo}.jsonl`);
const saida = fs.createWriteStream(arquivo, { flags: "a" });
const t0 = Date.now();
function gravar(tipo, dados) { saida.write(JSON.stringify({ t: Date.now() - t0, tipo, ...dados }) + "\n"); }

// ---- resumo (impresso no fim) ----
const endpoints = new Map();   // "METHOD host/path" -> { n, comCorpo, status: Set }
const contadores = { premwsRecebidos: 0, http: 0, wsEnviados: 0, wsRecebidos: 0 };
function chaveEndpoint(method, url) {
  try { const u = new URL(url); return `${method} ${u.host}${u.pathname}`; } catch { return `${method} ${url}`; }
}

// ---- CDP ----
async function conectar() {
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
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`CDP não abriu na porta ${CDP_PORT} — o Chrome do leitor está de pé?`)); });
  return { ws, send, on: (f) => ouvintes.push(f) };
}

(async () => {
  const cdp = await conectar();
  console.log(`[captura] conectado ao Chrome na porta ${CDP_PORT}`);

  // aba própria — não mexe na aba do leitor
  let targetId, sessionId;
  async function acharAbaLivre() {
    // acha a aba bet365 que NÃO é a do leitor (a dele tem o hook __zapInstalado)
    const { targetInfos } = await cdp.send("Target.getTargets");
    for (const t of targetInfos.filter(t => t.type === "page" && /bet365\.bet\.br\/(#|$)/.test(t.url))) {
      const at = await cdp.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
      const r = await cdp.send("Runtime.evaluate", { expression: "!!window.__zapInstalado", returnByValue: true }, at.sessionId).catch(() => ({ result: { value: true } }));
      if (r.result?.value === false) return { targetId: t.targetId, sessionId: at.sessionId };
      await cdp.send("Target.detachFromTarget", { sessionId: at.sessionId }).catch(() => {});
    }
    return null;
  }
  async function ligarEscuta() {
    await cdp.send("Network.enable", { maxPostDataSize: MAX_BODY }, sessionId);
    await cdp.send("Page.enable", {}, sessionId);
  }
  if (ABA_EXISTENTE) {
    const a = await acharAbaLivre();
    if (!a) throw new Error("nenhuma aba bet365 além da do leitor — abra uma antes");
    ({ targetId, sessionId } = a);
    console.log(`[captura] grudado na aba existente ${targetId.slice(0, 8)}…`);
  } else {
    ({ targetId } = await cdp.send("Target.createTarget", { url: URL_INICIAL }));
    ({ sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true }));
    console.log(`[captura] aba nova aberta (${targetId.slice(0, 8)}…). Aposte NELA, não na aba do leitor.`);
  }
  // [REANEXA_2026_09_16] A navegação pós-login (www → members → www) troca o
  // processo da aba e o Chrome DESCARTA a sessão CDP — o Network.enable morre junto
  // e a captura fica surda sem erro nenhum (foi assim que perdemos o 1º clique no
  // cupom). Ao ver o detach, re-anexa no mesmo target e religa a escuta.
  cdp.on(async (m) => {
    if (m.method !== "Target.detachedFromTarget" || m.params?.sessionId !== sessionId) return;
    gravar("detach", { targetId });
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 500));
      try {
        const at = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
        sessionId = at.sessionId; await ligarEscuta();
        gravar("reanexou", { targetId }); console.log("[captura] sessão caiu na navegação — re-anexada");
        return;
      } catch { /* target ainda em transição */ }
    }
    console.log("[captura] AVISO: não consegui re-anexar — captura surda");
  });

  const wsUrl = new Map();       // requestId -> url do socket
  const reqUrl = new Map();      // requestId -> { method, url }
  const pedidosCorpo = new Set();

  cdp.on(async (m) => {
    if (m.sessionId !== sessionId) return;
    const p = m.params || {};
    switch (m.method) {
      case "Network.requestWillBeSent": {
        const r = p.request || {};
        if (ESTATICO.test(r.url) || /^(data|blob):/.test(r.url)) return;
        reqUrl.set(p.requestId, { method: r.method, url: r.url });
        contadores.http++;
        const k = chaveEndpoint(r.method, r.url);
        const e = endpoints.get(k) || { n: 0, comCorpo: false, status: new Set() };
        e.n++; if (r.postData) e.comCorpo = true; endpoints.set(k, e);
        gravar("req", { id: p.requestId, method: r.method, url: r.url, tipo_recurso: p.type, headers: r.headers, corpo: r.postData || null, iniciador: p.initiator?.type });
        break;
      }
      case "Network.responseReceived": {
        const q = reqUrl.get(p.requestId); if (!q) return;
        const r = p.response || {};
        endpoints.get(chaveEndpoint(q.method, q.url))?.status.add(r.status);
        gravar("res", { id: p.requestId, url: q.url, status: r.status, mime: r.mimeType, headers: r.headers });
        if (/json|text|javascript|xml|x-www-form/i.test(r.mimeType || "") || p.type === "XHR" || p.type === "Fetch") pedidosCorpo.add(p.requestId);
        break;
      }
      case "Network.loadingFinished": {
        if (!pedidosCorpo.has(p.requestId)) return;
        pedidosCorpo.delete(p.requestId);
        try {
          const b = await cdp.send("Network.getResponseBody", { requestId: p.requestId }, sessionId);
          const corpo = b.base64Encoded ? `<base64 ${b.body.length}b>` : b.body.slice(0, MAX_BODY);
          gravar("res_corpo", { id: p.requestId, url: reqUrl.get(p.requestId)?.url, truncado: !b.base64Encoded && b.body.length > MAX_BODY, corpo });
        } catch { /* corpo já descartado pelo Chrome — segue */ }
        break;
      }
      case "Network.webSocketCreated":
        wsUrl.set(p.requestId, p.url);
        gravar("ws_abriu", { id: p.requestId, url: p.url });
        break;
      case "Network.webSocketFrameSent": {
        contadores.wsEnviados++;
        gravar("ws_env", { id: p.requestId, url: wsUrl.get(p.requestId), corpo: String(p.response?.payloadData || "").slice(0, MAX_BODY) });
        break;
      }
      case "Network.webSocketFrameReceived": {
        const u = wsUrl.get(p.requestId) || "";
        const corpoWs = String(p.response?.payloadData || "");
        if (/premws/.test(u) || (!u && /^[]/.test(corpoWs))) { contadores.premwsRecebidos++; return; }   // firehose de odds: o leitor já decodifica
        contadores.wsRecebidos++;
        gravar("ws_rec", { id: p.requestId, url: u, corpo: String(p.response?.payloadData || "").slice(0, MAX_BODY) });
        break;
      }
      case "Page.frameNavigated":
        if (!p.frame?.parentId) gravar("navegou", { url: p.frame?.url });
        break;
    }
  });

  await ligarEscuta();

  gravar("inicio", { url: URL_INICIAL, cdp_port: CDP_PORT });
  console.log(`[captura] gravando em ${arquivo}`);
  console.log("[captura] digite um marcador + Enter a cada passo (ex.: 'cliquei na odd', 'confirmei'). Ctrl+C pra encerrar.\n");

  function marcar(txt) { gravar("marcador", { texto: txt }); console.log(`  ✔ marcador: ${txt}`); }
  // stdin só quando há terminal — em segundo plano o stdin fecha na hora e derrubaria a captura
  const rl = process.stdin.isTTY ? readline.createInterface({ input: process.stdin }) : null;
  rl?.on("line", (linha) => { const txt = linha.trim(); if (txt) marcar(txt); });
  // controle por HTTP (modo assistido)
  const ctrl = http.createServer((req, res) => {
    let body = ""; req.on("data", c => body += c);
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/marcador") { try { marcar(JSON.parse(body || "{}").texto || body); } catch { marcar(body); } res.end("ok"); }
      else if (req.method === "POST" && req.url === "/fim") { res.end("ok"); umaVez(); }
      else { res.statusCode = 404; res.end(); }
    });
  }).listen(CTRL_PORT, "127.0.0.1", () => console.log(`[captura] controle em http://127.0.0.1:${CTRL_PORT} (POST /marcador, POST /fim)`));

  async function encerrar() {
    gravar("fim", contadores);
    saida.end();
    if (!ABA_EXISTENTE) { try { await cdp.send("Target.closeTarget", { targetId }); } catch {} }
    console.log(`\n[captura] encerrado. http=${contadores.http} ws_env=${contadores.wsEnviados} ws_rec=${contadores.wsRecebidos} (premws recebidos ignorados: ${contadores.premwsRecebidos})`);
    console.log("[captura] endpoints vistos (fora estáticos):");
    const linhas = [...endpoints.entries()].sort((a, b) => b[1].n - a[1].n);
    for (const [k, e] of linhas) console.log(`  ${String(e.n).padStart(4)}x ${e.comCorpo ? "[POST c/ corpo] " : ""}${k}  → ${[...e.status].join(",") || "?"}`);
    console.log(`\n[captura] arquivo: ${arquivo}`);
    process.exit(0);
  }
  let encerrando = false;
  const umaVez = () => { if (!encerrando) { encerrando = true; encerrar(); } };
  process.on("SIGINT", umaVez);
  rl?.on("close", umaVez);
})().catch((e) => { console.error("[captura] erro:", e.message); process.exit(1); });
