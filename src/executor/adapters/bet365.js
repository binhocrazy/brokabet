"use strict";
// Adaptador BET365 direto — o objetivo final. Reproduz o protocolo capturado na
// Fase 0 (docs/PROTOCOLO_BET365.md): addbet → placebet, tratando sr=14 (odd mudou).
//
// BLOQUEADO até termos o gerador de `X-Net-Sync-Term`. Sem esse header a Bet365
// devolve resultCode=fail no login e recusa o placebet. netSyncTerm() está isolado
// de propósito: quando a engenharia reversa terminar, é o único ponto a preencher.
//
// A sessão do slot (pstk, cookies) fica em slots.session_json, criada por um login
// que também depende do mesmo header. Enquanto isso, este adaptador lança um erro
// claro em vez de fingir que apostou.

const NET_SYNC_READY = process.env.BET365_NETSYNC_READY === "1";

function netSyncTerm(/* context */) {
  // TODO(fase-1): reimplementar o gerador do X-Net-Sync-Term.
  // Entrada provável: sessão + contador + fingerprint; saída: blob base64 "A0gABAC…".
  throw new Error("X-Net-Sync-Term ainda não implementado — ver docs/PROTOCOLO_BET365.md");
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
    // eslint-disable-next-line no-unused-vars
    netSyncTerm();
  },
  async settle() { return null; }, // via WebSocket pshudws (SETTLEDBETS) — Fase 2
};
