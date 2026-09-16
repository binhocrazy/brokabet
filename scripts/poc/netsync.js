#!/usr/bin/env node
"use strict";
// [BROKABET_FASE1] Valida a colheita do X-Net-Sync-Term SEM apostar nada.
// Gruda numa aba bet365 livre do Chrome do leitor (ou abre uma), injeta o hook
// e mostra a cada 2s o token mais fresco que a página gerou:
//
//   node scripts/poc/netsync.js
//
// O que observar:
//   - fonte "zap": tokens chegando dos frames pshudws (assinatura __udsv) —
//     esperado com a aba logada e "Minhas Apostas" ativo
//   - fonte "fetch"/"xhr": a página fez uma chamada de API (config etc.)
//   - idade baixa e estável = colheita viável pro executor
//
// Teste de fogo (manual): com a aba logada, faça uma ação na página que chame
// a API (atualizar saldo, abrir o cupom) e veja o token mudar na hora.
//
// Env: BET365_CDP_PORT (9222) · NET_SYNC_TTL_MS (60000) · NETSYNC_URL (ao vivo)

const netSync = require("../../src/executor/netSync");

const slotFake = { id: "poc", name: "poc-netsync" };

(async () => {
  console.log(`[netsync] colando na aba bet365 (CDP ${process.env.BET365_CDP_PORT || 9222})…`);
  let ultimo = null;
  for (;;) {
    try {
      const st = await netSync.status(slotFake);
      if (!st.token) {
        console.log(`[netsync] sem token ainda — ${st.motivo}`);
      } else {
        const ini = st.token.slice(0, 12);
        const mudou = ultimo && ultimo !== st.token ? " (mudou)" : "";
        console.log(`[netsync] ${st.pronto ? "FRESCO" : "VELHO "} · ${Math.round(st.idadeMs / 1000)}s · fonte=${st.fonte} · ${ini}… (${st.token.length}b)${mudou}`);
        ultimo = st.token;
      }
    } catch (e) {
      console.log(`[netsync] erro: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
})().catch((e) => { console.error("[netsync] erro fatal:", e.message); process.exit(1); });
