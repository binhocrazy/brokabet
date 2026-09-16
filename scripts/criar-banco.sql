-- Rode isto no pgAdmin (Query Tool, conectado como postgres) UMA vez.
-- Cria o usuário e o banco do Brokabet. Senha já combinada com o .env.
CREATE ROLE brokabet WITH LOGIN PASSWORD 'bkb_kuH3bAo_GWzs';
CREATE DATABASE brokabet OWNER brokabet;
GRANT ALL PRIVILEGES ON DATABASE brokabet TO brokabet;
