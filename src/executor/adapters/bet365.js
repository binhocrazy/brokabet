"use strict";
// Adaptador BET365 direto — o objetivo final. Reproduz o protocolo capturado na
// Fase 0 (docs/PROTOCOLO_BET365.md): addbet → placebet, tratando sr=14 (odd mudou).
//
// O gargalo era o `X-Net-Sync-Term`. Sem esse header a Bet365 devolve
// resultCode=fail no login e recusa o placebet. netSyncTerm() fica isolado de
// propósito: é o ponto único de troca se a estratégia de colheita mudar.
//
// O X-Net-Sync-Term vem de COLHEITA na aba do slot (src/executor/netSync.js):
// hook via CDP captura os tokens que o JS da própria página gera. Se a Bet365
// amarrar o token ao request de origem, a saída é invocar o gerador no
// contexto da página — o hook grava a fonte do token pra esse diagnóstico.
//
// A sessão do slot (pstk, cookies) fica em slots.session_json, criada por um login
// que também depende do mesmo header. Enquanto o fluxo não é completado, este
// adaptador lança um erro claro em vez de fingir que apostou.

const netSync = require("../netSync");

const NET_SYNC_READY = process.env.BET365_NETSYNC_READY === "1";

// Fase 1: token fresco colhido da aba do slot (fetch/xhr da página ou A_<token>
// dos frames zap — mesmo gerador). Erros NETSYNC_MISSING/NETSYNC_STALE dizem se
// a aba está deslogada/parada. node scripts/poc/netsync.js valida no PC.
async function netSyncTerm(slot) {
  return netSync.harvest(slot);
}

module.exports = {
  name: "bet365",
  netSyncReady: NET_SYNC_READY,
  async placeBet(slot, tip, params) {
    if (!NET_SYNC_READY) {
      const e = new Error("executor bet365 indisponível: falta o gerador X-Net-Sync-Term (Fase 1)");
      e.code = "NETSYNC_MISSING";
      throw e;
    }
    // Esqueleto do fluxo real (a completar quando netSyncTerm existir):
    //   1. garantir sessão logada do slot (slots.session_json)
    //   2. POST /BetsWebAPI/addbet  ns=pt=N#o=<odd>#f=<fixture>#fp=<odd_id>#c=<sport>#mt=<mkt>#|TP=... → {bg,cc,pc,sa}
    //   3. POST /BetsWebAPI/placebet?betGuid=bg&c=cc&p=pc  ns=...#sa=sa#ust=<stake>#st=<stake>#tr=<retorno># aa=null
    //   4. se sr=14 (selections_changed): reler od, checar min-odd/range, reenviar com bg/cc/sa novos e aa=0
    //   5. sucesso → br (código), ms (bet delay)
    throw new Error("placeBet bet365 não implementado");
    // eslint-disable-next-line no-unused-vars, no-unreachable
    await netSyncTerm(slot);
  },
  async settle() { return null; }, // via WebSocket pshudws (SETTLEDBETS) — Fase 2
};
