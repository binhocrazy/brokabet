# Brokabet

Executor próprio de apostas na Bet365. Faz o papel que o portal JBot fazia pro
Brokalab — slots (contas logadas), placebet, resultado por slot — servindo a
**mesma API do apijbot**, pra plataforma só trocar o endereço (`BROKABET_BASE`).

Irmão do leitor (`brokalab/src/providers/bet365feed/`, porta 8365): o leitor é o
olho, o Brokabet é a mão. Os dois rodam no PC; o Brokalab (VPS) consome via Tailscale.

```
PC                                                     VPS
leitor.js   :8365  lê odds/placar  ◀── BET365_READ_BASE ── sync-jbot
brokabet    :8367  executa apostas ◀── BROKABET_BASE ────── jarvis/dispatchTip
```

## Estado

- **Fase 0 (agora):** descobrir como a Bet365 recebe uma aposta.
  `npm run poc:captura` abre uma aba no Chrome do leitor e grava todo o tráfego
  HTTP/WS enquanto você aposta à mão. Ver `scripts/poc/captura-aposta.js`.
- Fase 1: executor 1 slot em modo sombra (loga o que faria, compara com JBot).
- Fase 2: execução real → multi-slot, IP por conta.
- Fase 3: tela do portal.

## Layout

| Pasta | O quê |
|---|---|
| `shared/`   | contrato comum com o leitor (zapDecoder, mapMarkets) — a mover |
| `executor/` | slots, cupom, placebet, API compatível com apijbot |
| `scripts/poc/` | experimentos da Fase 0 |
| `capturas/` | dumps dos experimentos (fora do git) |
