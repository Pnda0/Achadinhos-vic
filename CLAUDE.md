# Achadinhos da Vic — contexto para o Claude

Grupos de ofertas no Telegram por nicho (**Fitness**, **Beleza**, **Perfumes**) + o canal **Geral** (de tudo, não divulgado no site).
O dono fala português e prefere que o Claude **faça tudo sozinho** (inclusive commit e push no `main`), deixando para ele só o que exige login nas contas dele. Respostas curtas, em português, sem jargão.

## Onde cada coisa roda (out/2026)

- **Bot** (`ml-afiliados/`): roda **no PC de casa** do dono (Windows), pelo `ml-afiliados/3-iniciar.bat`, que liga com o Windows (atalho na pasta Inicializar). Ao ligar, ele faz `git pull` e `npm install`: **o que for para o `main` chega no bot na próxima vez que ele ligar**. O Render foi abandonado — `render.yaml` ficou só de referência.
- **Site** (`Vic Site/index.html`): Cloudflare Pages, https://achadinhos-vic.pages.dev, conta Cloudflare **alanribeiro8352@icloud.com** (o dono também tem a conta Alan_carvalho2015@hotmail.com — não é essa). Push NÃO publica o site: `npx wrangler@4 pages deploy "Vic Site" --project-name achadinhos-vic --branch main` (pede `wrangler login` na conta certa).
- **Telegram**: bot @achadinhosvic_bot; o dono é o usuário 2078974860 (é o `AVISOS_DESTINO_TELEGRAM`). Chat id de cada canal em `ml-afiliados/config/grupos.json`; convites de cada canal no `GRUPOS` do site.
- **Afiliados**: Mercado Livre (etiqueta `pndaaaa`), Awin (conta de afiliado 1694399; lojas e grupos em `ml-afiliados/config/awin.json`; `npm run awin` mostra aprovadas/pendentes/cupons), Amazon ainda sem etiqueta.

## Regras importantes

- **Nunca ligar uma segunda cópia do bot** (`npm start`, `3-iniciar.bat`) fora do PC de casa: cada oferta sairia duas vezes. Para testar, use `npm test` ou scripts que não postam.
- Segredos **não** vão para o git: `ml-afiliados/.env` e `ml-afiliados/data/` (inclui `data/cookies.txt`, a sessão do ML). Num PC novo eles não existem — e não precisam, porque o bot não roda lá.
- **Sessão do Mercado Livre**: o ML bloqueia login em janela aberta pelo bot. Quando vencer (o bot avisa no Telegram), o dono copia o header `cookie` do Link Builder pelo F12 do navegador dele e cola em `ml-afiliados/data/cookies.txt` **no PC de casa**.
- Testes: `cd ml-afiliados && npm test` (Node 18.17+; no PC de casa está o Node 24).
- Mais detalhes: `ml-afiliados/README.md` (seções 3.6b nichos, 3.12 canais, 3.13 Awin).

## Pendências (14/10/2026)

- Awin: nenhuma loja aprovada é de beleza/perfume ainda. Pedir **Phebo** (aceita pessoa física); **Granado** está em análise. Várias grandes (O Boticário, Natura, Eudora, Beleza na Web) só aceitam CNPJ.
- Se o dono criou o serviço no Render, ele deve estar suspenso/apagado (senão posta em dobro).
- O PC de casa precisa ficar ligado e acordado das 7h às 22h (busca às 7h/12h/17h; envio a cada 5 min das 8h às 21h59 — `CRON_ENVIO` no `.env` de casa, mudado a pedido do dono em 14/10/2026).
