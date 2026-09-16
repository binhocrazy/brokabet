# Protocolo da Bet365 — o que a captura de 16/09/2026 mostrou

Fonte: `capturas/aposta-2026-09-16T04-18-45.jsonl` (aposta manual do Binho, navegador
limpo, captura passiva via CDP). Conta `washalcan30`, aposta R$1,00 em River Plate
(Simaponika) 1.20, Resultado Final, Boca × River, E-Soccer Battle. Ref `CB7121021151F`.

## Visão geral

```
1. GET  /BetsWebAPI/config                                  (sessão do cupom)
2. POST members.bet365.bet.br/loginapi/lp/login             → resultCode=success, txtPSTK, txtSWT
3. POST /loginpageredirectapi/redirect?IS=1                  → recarrega a página logado
4. POST /BetsWebAPI/addbet        (clicou na odd)            → betGuid (bg), cc, pc, sa
5. POST /BetsWebAPI/placebet?betGuid=&c=&p=   (clicou Apostar)
      → sr=14 "selections_changed" (odd mudou 1/6 → 1/5): novo bg/cc/sa
6. POST /BetsWebAPI/placebet  (de novo, com odd nova, aa=0)  → br="CB7121021151F"  ✔
```

Tudo HTTP. Os WebSockets (`premws`, `pshudws`, `sportspublisher/zap`) não carregam a
aposta — são odds/placar (o que o leitor já lê) e push de conta.

Todas as chamadas levam dois headers gerados pelo JS da Bet365:

| Header | O que parece ser |
|---|---|
| `X-Request-Id` | UUID fixo por carregamento de página |
| `X-Net-Sync-Term` | blob base64 (~1–2 KB) que **muda a cada request** (prefixo comum, cauda diferente). É o que distingue humano de robô — o login por script falhou só por ele. **É o muro do projeto.** |

## 1. Login

```
POST https://members.bet365.bet.br/loginapi/lp/login
Content-Type: application/x-www-form-urlencoded

txtType=85&txtTKN=<token de sessão>&txtLCNOVR=BR&platform=1&IS=11
&txtUNEM=<email>&txtPassword=<senha>&AuthenticationMethod=0&txtScreenSize=1920 x 1080
```
- `txtTKN` — token de sessão anônima (vem do cookie/config antes do login).
- Antes do login: `POST /moswrapperapi/authenticationmethods {"CountryCode":"28","CountryStateId":"545"}` → `["Pin","Touch","KML","Fingerprint","Standard"]`.

Resposta (text/plain, chave=valor separados por vírgula):
```
resultCode=success,txtPSTK=<token logado>,txtSWT=<blob>,txtUN=washalcan30,
notificationsActive=true,notificationsRequired=False,countryID=28,countryStateID=0,...
```
Falha: `resultCode=fail,txtPSTK=,...` (foi o que o login automatizado recebeu).

Depois: `POST /loginpageredirectapi/redirect?IS=1` body `IS=1` → `True|33|0|2|<txtPSTK>|28|E|Y|2|true`, e a página recarrega já logada.

## 2. addbet — colocar a seleção no cupom

```
POST https://www.bet365.bet.br/BetsWebAPI/addbet
Content-type: application/x-www-form-urlencoded

&ns=pt=N#o=1/6#f=201345771#fp=6778807#so=#c=1#pv=1/6#mt=11#id=201345771-6778807Y#|TP=BS201345771-6778807#av=1#||
&rbp=undefined&betsource=FlashInPLay&bs=99&cr=1&xb=1
```
(`ns` vai url-encodado; acima está decodificado.)

| Campo | Valor | Significado |
|---|---|---|
| `f`  | 201345771 | **FI do jogo** — o mesmo `fi` que o leitor e o JBot usam |
| `fp` | 6778807   | **id da seleção (odd_id)** — o mesmo que o leitor indexa em `OV<fi>-<odd_id>` |
| `o` / `pv` | 1/6 | odd fracionária que o usuário viu |
| `c`  | 1 | classificação (1 = futebol) |
| `mt` | 11 | tipo de mercado (11 = Resultado Final aqui) |
| `TP` | BS<fi>-<odd_id> | id da "tip" no cupom |
| `betsource` | FlashInPLay | ao vivo |
| `bs` | 99 | bet string (mesmo `bt=99` que aparece nos logs de erro) |

Resposta:
```json
{"bg":"4285d58e-…","cs":1,"pc":"3450820706123997864","cc":"sqKLzG6MQ…=",
 "bt":[{"fi":201345771,"od":"1/6","sa":"6aaa18d2-0ADBA2F7","tp":"BS201345771-6778807",
        "pt":[{"bd":"River Plate (Simaponika)","pi":6778807,"pk":"201305236|FTRS|1|Team2","md":"Resultado Final"}],
        "fd":"Boca Juniors (ssstasonn) x River Plate (Simaponika)","lk":"ESOCCERBATTLE","nf":201305236}],
 "ir":true,"ab":true,"vr":"339","st":99}
```
- `bg` = betGuid, `cc` = checksum, `pc` = p → vão na query do placebet.
- `sa` = autorização da seleção (muda a cada resposta) → vai dentro do `ns` do placebet.
- `nf` 201305236 = FI "pai" (evento); `pk` = chave da seleção.

## 3. placebet — confirmar

```
POST https://www.bet365.bet.br/BetsWebAPI/placebet?betGuid=<bg>&c=<cc>&p=<pc>

&ns=pt=N#o=1/6#pv=1/6#f=201345771#fp=6778807#so=#c=1#sa=6aaa18d2-ADBA2F7#mt=11#|TP=BS201345771-6778807#ust=1.00#st=1.00#tr=1.16#||
&xb=1&aa=null&betsource=FlashInPLay&tagType=WindowsDesktopBrowser&bs=99&qb=1
```
| Campo | Significado |
|---|---|
| `st` / `ust` | stake (R$) |
| `tr` | retorno esperado (stake × odd decimal) |
| `aa` | aceitar alteração de odd: `null` na 1ª tentativa, `0` ao reenviar |
| `sl` | aparece como `sl=0` na 2ª tentativa |

### 3a. Odd mudou (o caso "selections_changed")
1ª resposta: `{"sr":14,"mi":"selections_changed","bg":"26eb0cfa-…","cc":"ws1QSw…","cs":2,"st":1,
"bt":[{"od":"1/5","go":"1/5","re":1.2,"fi":201345771,"pt":[{"pi":6778807}]}]}`
→ a odd foi de 1/6 pra 1/5. O cliente reenviou o placebet com **novo `bg`/`cc`** da resposta,
`o=1/5`, novo `sa`, `tr=1.20`, `aa=0`.

### 3b. Sucesso
```json
{"ts":1.00,"tu":1.00,"br":"CB7121021151F","re":1.2,"cs":3,"sr":0,"st":1,
 "la":[{"fi":201305236,"ak":"ESOCCERBATTLE","fd":"Boca Juniors (ssstasonn) x River Plate (Simaponika)","t1":"230197","t2":"236669"}],
 "bt":[{"tk":"3224591626872067141","fx":"20260916051100","ms":3500.0,"br":"CB7121021151F","od":"1/5","re":1.2,"fi":201345771,"pt":[{"pi":6778807}]}]}
```
- `br` = **referência da aposta** (o "code" que o JBot devolvia por slot).
- `ms` 3500 = provável bet delay do ao vivo (ms) aplicado no servidor.
- `sr` = status: 0 ok, 14 seleção mudou. Outros a descobrir (rejeitada, suspensa, limite).

## O que isso significa pro Brokabet

- O leitor **já tem `f` e `fp`** (FI e odd_id) de toda seleção virtual ao vivo. A ponte
  Brokalab → Brokabet é direta: a tip do Brokalab traz `fixture_id`/`odd_id`, e eles
  entram em `addbet`/`placebet` sem tradução.
- `adjust_line` do JBot = nosso lado: quando a linha muda, o `odd_id` muda; achar a
  seleção nova no mesmo mercado (o leitor tem o mapa) e reenviar.
- O fluxo `sr=14` é o "odd mudou" — o executor precisa tratar: reler `od`, decidir se
  aceita (min odd), reenviar com `bg`/`cc`/`sa` novos.


## 4. Saldo, apostas abertas e resolvidas — WebSocket `pshudws` (protocolo zap)

"Minhas Apostas" e o saldo **não são HTTP**: chegam pelo socket
`wss://pshudws.z2.365lpodds.com/zap/` no mesmo protocolo zap que o leitor decodifica
(`zapDecoder.js`). A sessão é o `txtPSTK` do login.

```
→ #\x03P\x01__time,S_<PSTK>\x00                                     handshake (sessão logada)
→ \x16\x00S_<PSTK>,__udsv,A_<token>\x01                              assina a sessão
→ \x02\x00command\x01getBalance\x01<PSTK>\x02SPTBK                   pede saldo
← <PSTK>_SPTBK_BAL2  {"nw":"2852.83","tb":"2852.83","wb":"2852.83",...}   saldo (nw = líquido)
→ \x16\x00OPENBETS,A_<token>\x01                                      apostas em aberto
← OPENBETS  F|OP;...|BE;ID=BE…;ST=35.00;RE=63.00;...|PA;OD=4/5;HT=25.5;FI=…;NA=Mais de 25.5;...|
→ \x16\x00SETTLEDBETS,A_<token>\x01                                   resolvidas (BC=200 últimas)
← SETTLEDBETS F|OP;...|BE;...|PA;...|BE;...|PA;...
← OPENBETS/BE…\x01U|EE=0;|                                             update de uma aposta aberta
```
O `A_<token>` tem o mesmo formato do `X-Net-Sync-Term` (`A0gABAC…`) — é o mesmo
gerador; o leitor já captura esse token da página pra assinar odds.

### Nó `BE` (a aposta) e `PA` (a seleção)

| Campo | Onde | Significado (empírico, conferido com a tela) |
|---|---|---|
| `ID`/`IT` | BE | id da aposta: `BE…` aberta, `BSB…` resolvida (o número é o `tk`/`tr` do placebet) |
| `ST` | BE | stake |
| `RE` | BE (aberta) | retorno potencial |
| `CR` | BE (resolvida) | retorno creditado: `0.00` = red, `> ST` = green, `= ST` = void |
| `RC` | PA (resolvida) | resultado: **1 = ganhou, 2 = perdeu, 3 = void** (bate com CR) |
| `TP` | BE | timestamp (ms) da aposta |
| `NA` | BE | tipo (`Simples`) |
| `OD` | PA | odd fracionária |
| `HT` | PA | linha/handicap (`25.5`, `+3.5`, `+0.75`) |
| `FP` | PA | **odd_id** da seleção (o `fp` do addbet) |
| `FI` | PA | fixture (o `nf` do addbet — evento "pai"); `FD` = FI do jogo |
| `PE` | PA | chave: `<fi>·<mercado>·<n>·<seleção>` ex. `201305156·ASHC·14·ManCity(Nightxx)·0-3` |
| `MI` | PA | id do mercado (10147 = HC Asiático, 180098 = 3º Q total, ...) |
| `EX` | PA | `evento~mercado` legível |
| `L3` | PA | código da liga (`ESOCCERBATTLE`, `B-EBASKBLITZ4X5`, `ESOCH2HGG-8MP`) |
| `BD`/`NA` | PA | nome da seleção |
| `ED` | PA (aberta) | estado (`Ainda Por Acontecer`) |

Isso é exatamente o que o JBot devolvia em `/api/tips/{id}/slots` (`code`, `stake`,
`odds`, `starting_line`, `tip_result`, `total_returns`) — dá pra montar a mesma resposta
a partir de `SETTLEDBETS`. Complemento HTTP: `POST /mybetscontentapi/settledstats`
`{"it":"BSB…","pt":[{"cl":1,"mi":1777,"mc":"FTRS","fi":201305236,"te":2,"fp":6778807}]}`
→ zap com `SS=2-4` (placar final).

## 5. Sessão única por conta

~56s depois da aposta o socket recebeu `S_<PSTK>\x01D` (sessão apagada) e a página caiu
pra deslogado; o Binho relogou. Provável política de **uma sessão ativa por conta**
(havia outro navegador logado). É o mesmo motivo do flag `using`/"em uso" nos slots do
JBot: um slot logado derruba o dono se ele entrar pelo celular. Precisa estar na UI do
Brokabet como aviso.

## O que ainda falta

1. **`X-Net-Sync-Term`** — como o JS gera. Sem isso nada acima funciona fora do navegador.
2. Cookies exatos enviados (a captura pegou só os headers do JS; precisa de
   `Network.requestWillBeSentExtraInfo` pra ver o `Cookie`).
3. Tabela de `sr` (códigos de erro do placebet) e `mt`/`MI` (tipos de mercado).
4. Frames grandes: `SETTLEDBETS` estourou os 64 KB da captura — subir `CAPTURA_MAX_BODY` na próxima.
