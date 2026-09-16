-- Brokabet — esquema PostgreSQL
--
-- Entidades (espelham o que o portal JBot expõe, pra API ser compatível):
--   users      — dono do portal; api_key = o "client_key" que o Brokalab manda no Authorization
--   slots      — uma conta na casa de aposta (token = id público do slot, como no JBot)
--   tips       — tip recebida pela API (unique_id) ou criada no portal/CopyBet
--   tip_slots  — execução da tip em cada slot (code, stake, odd, linha, resultado)
--   events     — log legível por slot/tip (o que o dashboard mostra)
--
-- tip_result segue o enum do JBot: 0 pendente · 1 green · 2 red · 3 void · 4 ½green · 5 ½red

CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  api_key       UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  role          TEXT NOT NULL DEFAULT 'owner',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (
  id            BIGSERIAL PRIMARY KEY,
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token         UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  bookie        TEXT NOT NULL DEFAULT 'B365',
  bet_user      TEXT NOT NULL DEFAULT '',
  bet_pass      TEXT NOT NULL DEFAULT '',
  executor      TEXT NOT NULL DEFAULT 'shadow',      -- shadow | jbot | bet365
  jbot_key      TEXT,                                 -- client_key do JBot (executor = jbot)
  stake         NUMERIC(12,2) NOT NULL DEFAULT 0,     -- stake padrão do slot (0 = usa o da tip)
  max_stake     NUMERIC(12,2) NOT NULL DEFAULT 0,
  paused        BOOLEAN NOT NULL DEFAULT FALSE,
  hibernating   BOOLEAN NOT NULL DEFAULT FALSE,
  using_now     BOOLEAN NOT NULL DEFAULT FALSE,
  status        TEXT NOT NULL DEFAULT 'offline',      -- offline | online | login_fail | error
  status_msg    TEXT NOT NULL DEFAULT '',
  balance       NUMERIC(12,2),
  open_balance  NUMERIC(12,2),
  session_json  JSONB,                                -- sessão logada na casa (pstk, cookies, token)
  last_login_at TIMESTAMPTZ,
  last_sync_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_slots_user ON slots(user_id);

CREATE TABLE IF NOT EXISTS tips (
  id            BIGSERIAL PRIMARY KEY,
  unique_id     UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bookie        TEXT NOT NULL DEFAULT 'B365',
  sport_id      INTEGER,
  fixture_id    BIGINT,
  event_id      TEXT,
  odd_id        BIGINT,
  fraction_odd  TEXT,
  line          TEXT,
  description   TEXT NOT NULL DEFAULT '',
  parameters    JSONB NOT NULL DEFAULT '{}'::jsonb,   -- stake, adjust_line, min/max_line, unlimited_*
  source        TEXT NOT NULL DEFAULT 'api',          -- api | portal | copybet
  status        TEXT NOT NULL DEFAULT 'received',     -- received | dispatched | done
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tips_user_created ON tips(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tip_slots (
  id            BIGSERIAL PRIMARY KEY,
  tip_id        BIGINT NOT NULL REFERENCES tips(id) ON DELETE CASCADE,
  slot_id       BIGINT NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'pending',      -- pending | placed | rejected | failed | shadow
  code          TEXT,                                 -- referência da aposta na casa (br)
  stake         NUMERIC(12,2),
  odds          NUMERIC(10,4),
  starting_line TEXT,
  ending_line   TEXT,
  tip_result    SMALLINT NOT NULL DEFAULT 0,
  unit          NUMERIC(10,4),
  total_returns NUMERIC(12,2),
  error         TEXT,
  request_json  JSONB,
  response_json JSONB,
  latency_ms    INTEGER,
  placed_at     TIMESTAMPTZ,
  settled_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tip_slots_tip ON tip_slots(tip_id);
CREATE INDEX IF NOT EXISTS ix_tip_slots_pending ON tip_slots(status, tip_result);

CREATE TABLE IF NOT EXISTS events (
  id            BIGSERIAL PRIMARY KEY,
  level         TEXT NOT NULL DEFAULT 'info',         -- info | warn | error
  slot_id       BIGINT,
  tip_id        BIGINT,
  message       TEXT NOT NULL,
  data_json     JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_events_created ON events(created_at DESC);
