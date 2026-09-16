#!/usr/bin/env node
"use strict";
// [BROKABET_FASE0_2026_09_16] Driver mínimo de uma aba do Chrome do leitor via CDP.
// Serve pra dirigir a aba de captura (login, clicar, digitar, tirar foto) sem
// depender de ferramenta externa. Nunca toca na aba do leitor (a que tem
// window.__zapInstalado) a não ser que o id seja passado explicitamente.
//
//   node aba.js list                      abas bet365 (marca qual é do leitor)
//   node aba.js new [url]                 abre aba nova e imprime o id
//   node aba.js close <id>                fecha aba
//   node aba.js shot <id> <arquivo.png>   screenshot
//   node aba.js eval <id> <js>            avalia JS (returnByValue)
//   node aba.js goto <id> <url>
//   node aba.js click <id> <x> <y>        clique real (Input.dispatchMouseEvent)
//   node aba.js type <id> <texto>         digita no elemento focado (Input.insertText)
//   node aba.js key <id> <tecla>          ex.: Enter, Tab, Backspace
//   node aba.js sel <id> <seletor>        clica no centro do 1º elemento que casa o seletor CSS
//
// Env: BET365_CDP_PORT (9222)
const fs = require("fs");
const CDP_PORT = Number(process.env.BET365_CDP_PORT || 9222);

async function conectar() {
  const ver = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json();
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const pend = new Map();
  const send = (method, params, sessionId) => new Promise((res, rej) => {
    const m = { id: ++id, method, params: params || {} }; if (sessionId) m.sessionId = sessionId;
    pend.set(m.id, { res, rej }); ws.send(JSON.stringify(m));
  });
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error("CDP não abriu")); });
  return { ws, send };
}

async function sessao(cdp, targetId) {
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  return sessionId;
}
async function evalJs(cdp, sid, expression) {
  const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, sid);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || "erro no eval");
  return r.result?.value;
}
async function clicar(cdp, sid, x, y) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await cdp.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 }, sid);
    await new Promise(r => setTimeout(r, 60));
  }
}

(async () => {
  const [cmd, a, b, c] = process.argv.slice(2);
  const cdp = await conectar();
  const alvo = (id) => { if (!id) throw new Error("falta o id da aba"); return id; };
  try {
    if (cmd === "list") {
      const { targetInfos } = await cdp.send("Target.getTargets");
      for (const t of targetInfos.filter(t => t.type === "page")) {
        let leitor = "?";
        try { const sid = await sessao(cdp, t.targetId); leitor = (await evalJs(cdp, sid, "!!window.__zapInstalado")) ? "LEITOR" : "livre"; await cdp.send("Target.detachFromTarget", { sessionId: sid }); } catch {}
        console.log(`${t.targetId}  ${leitor.padEnd(6)}  ${t.url}  ${t.title ? "· " + t.title.slice(0, 40) : ""}`);
      }
    } else if (cmd === "new") {
      const { targetId } = await cdp.send("Target.createTarget", { url: a || "https://www.bet365.bet.br/#/IP/B1" });
      console.log(targetId);
    } else if (cmd === "close") {
      await cdp.send("Target.closeTarget", { targetId: alvo(a) }); console.log("fechada");
    } else {
      const sid = await sessao(cdp, alvo(a));
      if (cmd === "shot") {
        const r = await cdp.send("Page.captureScreenshot", { format: "png" }, sid);
        fs.writeFileSync(b || "aba.png", Buffer.from(r.data, "base64")); console.log(`foto em ${b || "aba.png"}`);
      } else if (cmd === "eval") {
        const v = await evalJs(cdp, sid, b); console.log(typeof v === "string" ? v : JSON.stringify(v, null, 1));
      } else if (cmd === "goto") {
        await cdp.send("Page.navigate", { url: b }, sid); console.log("navegou");
      } else if (cmd === "click") {
        await clicar(cdp, sid, Number(b), Number(c)); console.log(`clique em ${b},${c}`);
      } else if (cmd === "sel") {
        const box = await evalJs(cdp, sid, `(() => { const el = document.querySelector(${JSON.stringify(b)}); if (!el) return null; el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2, w: r.width, h: r.height }; })()`);
        if (!box) throw new Error(`seletor não achou nada: ${b}`);
        await new Promise(r => setTimeout(r, 150));
        await clicar(cdp, sid, box.x, box.y); console.log(`clique em ${b} (${Math.round(box.x)},${Math.round(box.y)})`);
      } else if (cmd === "type") {
        await cdp.send("Input.insertText", { text: b }, sid); console.log("digitado");
      } else if (cmd === "key") {
        const map = { Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 }, Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 }, Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 }, Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 } };
        const k = map[b] || { key: b, code: b };
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...k }, sid);
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...k }, sid); console.log(`tecla ${b}`);
      } else throw new Error(`comando desconhecido: ${cmd}`);
    }
  } finally { cdp.ws.close(); }
})().catch(e => { console.error("[aba] erro:", e.message); process.exitCode = 1; });
