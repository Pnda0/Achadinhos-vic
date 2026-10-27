---
name: operar-o-bot
description: Como operar o bot ml-afiliados no PC de casa do dono — reiniciar com calma depois de uma mudança, investigar por que algo aconteceu (grupo vazio, post estranho, WhatsApp diferente, erro), ler logs e números, e onde fica cada configuração e segredo. Use depois de qualquer push que mude o bot, ou quando o dono perguntar "por que…", "cadê…", "tá sem…".
---

# Operar o bot (ml-afiliados)

O bot roda **neste PC** (Windows do dono), na janela do `ml-afiliados/3-iniciar.bat`. Ao ligar ele faz `git pull` e
`npm install`: o que foi para o `main` só vale depois de reiniciar.

## Reiniciar (o dono autorizou, 16/10/2026)

```bash
cd /d/Github/Achadinhos-vic/ml-afiliados && npm run reiniciar
```
O bot não começa tarefa nova, espera o envio/busca em andamento, grava a fila, fecha o WhatsApp e o `.bat` liga de
novo na mesma janela (~10 s). Sem bot rodando, o comando abre o `.bat`. Depois confira:
`tail -20 data/bot.log` deve mostrar "Bot ligado" e "WhatsApp ligado".

**Nunca** abra uma segunda janela do bot (posta tudo em dobro). Matar o processo à força é bloqueado — e desnecessário.

**Bot congelado** (27/10/2026): o log para no meio ("🔁 Reinício pedido" sem "Encerrando"), o processo não gasta CPU e
a porta 47831 fica presa sem responder. Causa provável: clique dentro da janela preta (edição rápida do Windows segura
o bot até apertar uma tecla) — desde 27/10 o bot desliga a edição rápida ao ligar (`src/janela.js`). Nesse estado o
`npm run reiniciar` NÃO abre outra cópia (confere os processos: `outrosBots()` em `src/instancia.js`) e o bot novo
também se recusa a ligar. Peça ao dono para fechar a janela travada; depois `npm run reiniciar` abre uma só.

**ML bloqueado por dias** ("⛔ Mercado Livre bloqueou" toda busca; desde 21/10/2026, em 27/10 até a página de
ofertas sem o bot caía em "account-verification"): rode `npm run ml-liberar` (em segundo plano) e avise o dono — abre o
ML numa janela comum do Chrome com o perfil do bot, ele entra na conta e passa pela verificação (até 20 min). Não
aumente páginas nem tente contornar a verificação.

## Investigar

- `data/bot.log` — tudo que o bot fez (hora local). Linhas úteis: `📤 [Grupo]` postou, `📲 [WhatsApp Grupo]`, `⏭️` barrado na hora de postar, `📭 fila vazia`, `🔁 Busca de reposição`, `✅ Coleta:` com recusas por motivo, `Por categoria (vistos → aprovados)`.
- `data/produtos.log` (JSONL) — cada produto: recusado (motivo), na_fila, publicado, barrado, whatsapp. `npm run historico -- <id ou nome>`.
- `data/db.json` — a fila (`produtos`, status PRONTO/ENVIADO/...), `whatsapp` (o que foi pro WhatsApp), `coletaPorGrupo`. Só leia: o bot regrava o arquivo.
- `data/precos.json` — histórico de preço por produto.
- Números: `npm run analytics -- hoje|7d|30d` (só lê). Painel: https://achadinhos-vic-painel.pages.dev (senha em `data/analytics/senha-painel.txt`).
- Para testar algo de verdade **sem postar**: monte um script com Store numa pasta temporária (veja os testes); nunca rode `npm start`.

## Onde fica cada coisa

- Grupos, nichos, só marcas, gênero, WhatsApp: `config/grupos.json` (Geral pausado desde 16/10/2026: `"ativo": false`).
- Buscas: `config/categorias.json` (ML), `config/shopee.json`, `config/awin.json`; canais (desligados): `config/fontes.json`.
- Marcas: `config/marcas.json`. Palavras de nicho: `config/nichos.json`.
- `.env` (segredo, fora do git): Telegram, ML, `shope_appID`/`Senha_shopee`, `API_KEY_AWIN`, `AMAZON_PARTNER_TAG`, `CRON_ENVIO` (*/3), WhatsApp. Nunca mostre valores; mascare.
- Site: `Vic Site/index.html`, publicar com `npx wrangler@4 pages deploy "Vic Site" --project-name achadinhos-vic --branch main`.

## Rotina depois de mudar o bot

`npm test` → `git add <caminhos>` → commit → `git push` → `npm run reiniciar` → conferir o log → contar ao dono em
poucas linhas, em português, sem jargão.
