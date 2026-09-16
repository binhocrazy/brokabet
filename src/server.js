"use strict";
require("dotenv").config();

const path = require("path");
const express = require("express");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const db = require("./db");
const jbotCompat = require("./api/jbotCompat");
const portal = require("./portal/routes");
const reader = require("./reader");
const { startSettlement } = require("./settlement");

const PORT = Number(process.env.BROKABET_PORT || 8367);
const app = express();

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "portal", "views"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use("/static", express.static(path.join(__dirname, "portal", "static")));

// health (sem auth) — pro monitor
app.get("/saude", async (req, res) => {
  let leitor = null;
  try { leitor = await reader.health(); } catch (e) { leitor = { ok: false, error: e.message }; }
  res.json({ ok: true, service: "brokabet", port: PORT, reader_base: reader.base, reader: leitor });
});

// API compatível JBot (auth por api_key) — ANTES da sessão, pra não exigir cookie
app.use(jbotCompat);

// portal (sessão por cookie)
app.use(session({
  secret: process.env.SESSION_SECRET || "brokabet-dev-secret-troque-no-env",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: "lax", maxAge: 7 * 24 * 3600 * 1000 },
}));
app.use(portal);

app.use((err, req, res, next) => {
  console.error("erro:", err.stack || err.message);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message });
});

async function main() {
  await db.init();
  const n = await db.users.count();
  if (n === 0) {
    const email = process.env.BOOTSTRAP_EMAIL || "operacao@brokalab.com";
    const pass = process.env.BOOTSTRAP_PASS || "brokabet";
    const u = await db.users.create({ email, name: "Brokalab", password: pass });
    console.log(`\n★ usuário inicial criado: ${email} / senha "${pass}"`);
    console.log(`★ api_key (client_key p/ o Brokalab): ${u.api_key}\n`);
  }
  startSettlement();
  app.listen(PORT, () => {
    console.log(`Brokabet no ar → http://127.0.0.1:${PORT}  (portal) · /api/* (compat JBot) · /saude`);
    console.log(`Leitor Bet365: ${reader.base}`);
  });
}

main().catch(e => { console.error("boot falhou:", e); process.exit(1); });
