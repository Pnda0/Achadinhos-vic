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
