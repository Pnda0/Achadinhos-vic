# Achadinhos da Vic — contexto para o Claude

Grupos de ofertas no Telegram por nicho (**Fitness**, **Beleza**, **Perfumes**) + o canal **Geral** (de tudo, não divulgado no site).
O dono fala português e prefere que o Claude **faça tudo sozinho** (inclusive commit e push no `main`), deixando para ele só o que exige login nas contas dele. Respostas curtas, em português, sem jargão.

## Onde cada coisa roda (out/2026)

- **Bot** (`ml-afiliados/`): roda **no PC de casa** do dono (Windows), pelo `ml-afiliados/3-iniciar.bat`, que liga com o Windows (atalho na pasta Inicializar). Ao ligar, ele faz `git pull` e `npm install`: **o que for para o `main` chega no bot na próxima vez que ele ligar**. O Render foi abandonado — `render.yaml` ficou só de referência.
- **Site** (`Vic Site/index.html`): Cloudflare Pages, https://achadinhos-vic.pages.dev, conta Cloudflare **alanribeiro8352@icloud.com** (o dono também tem a conta Alan_carvalho2015@hotmail.com — não é essa). Push NÃO publica o site: `npx wrangler@4 pages deploy "Vic Site" --project-name achadinhos-vic --branch main` (pede `wrangler login` na conta certa).
- **Telegram**: bot @achadinhosvic_bot; o dono é o usuário 2078974860 (é o `AVISOS_DESTINO_TELEGRAM`). Chat id de cada canal em `ml-afiliados/config/grupos.json`; convites de cada canal no `GRUPOS` do site.
- **WhatsApp** (desde 15/10/2026): espelho do Telegram num chip só do bot, 1 mensagem a cada 6 min no total (`WHATSAPP_ESPELHO`/`WHATSAPP_INTERVALO_MIN` no `.env` de casa; README 3.13b). Não acelere sem o dono: risco de banimento.
- **Afiliados**: Mercado Livre (etiqueta `pndaaaa`), Shopee (desde 15/10/2026: `shope_appID`/`Senha_shopee` no `.env` de casa; busca própria — README 3.13e; `npm run shopee` testa), Awin (conta de afiliado 1694399; lojas e grupos em `ml-afiliados/config/awin.json`; `npm run awin` mostra aprovadas/pendentes/cupons), Amazon (etiqueta `achadin09027e-20` em `AMAZON_PARTNER_TAG`; sem API ainda).

## Regras importantes

- **Nunca ligar uma segunda cópia do bot** (`npm start`, `3-iniciar.bat`) fora do PC de casa: cada oferta sairia duas vezes (aconteceu em 14/10/2026 com duas janelas abertas). No mesmo PC a trava de porta (`src/instancia.js`, 127.0.0.1:47831) já impede; em outro PC, não. Para testar, use `npm test` ou scripts que não postam.
- Regras que o dono pediu e não devem ser afrouxadas sem ele: **desde 16/10/2026 o bot busca tudo ele mesmo nas lojas e NÃO copia canal nenhum** (pedido do dono: "pare de copiar dos outros, ficou com muito produto ruim"): Mercado Livre (`config/categorias.json`), Shopee pela API de afiliados (`config/shopee.json`, por marca e palavra; README 3.13e) e cupons da Awin. `canaisTelegram.ativo: false` em `config/fontes.json` (nem o @promobigodeperfumes nem a Amazon dos canais). **Amazon** (etiqueta `achadin09027e-20`): sem API (só depois de 3 vendas) e sem raspar o site (proibido pelo Associados), entra só pelo privado do bot. **O Geral está pausado** (`"ativo": false` em `config/grupos.json`, 16/10/2026): não busca nem posta. **Público-alvo: meninas** (pedido do dono, 15/10/2026): em todos os grupos os produtos femininos saem primeiro, depois os neutros, e masculino no máximo 1 a cada 4 posts (1 a cada 5 no Perfumes, desde 15/10 à noite) — `"preferirFeminino"` em `config/grupos.json`, gênero em `src/genero.js`. **Marcas primeiro** (pedido do dono, 15/10/2026): as marcas de `config/marcas.json` passam na frente em todos os grupos, e **Fitness, Beleza e Perfumes só postam marcas da lista** (`"soMarcas": true` em `config/grupos.json`; o Geral posta de tudo). As marcas também contam como palavra do nicho (README 3.13d). Na busca direta que sobrar, oferta do ML só com **mais de 50 vendas** confirmadas pelo rótulo do card (sem rótulo = fora); nada é postado duas vezes no mesmo grupo (id + nome normalizado, histórico em `data/db.json`); envio sem resposta vira `INCERTO` e não é repetido. Detalhes: README do bot, seção 3.14. Histórico de cada oferta: `npm run historico -- <id ou nome>`.
- **Reiniciar o bot**: o dono autorizou o Claude a reiniciar quando precisar (16/10/2026). Use `cd ml-afiliados && npm run reiniciar`: o bot termina o envio/coleta em andamento, grava a fila e o `3-iniciar.bat` liga de novo na mesma janela, com `git pull` (sem bot rodando, abre o .bat). Nunca abra uma segunda janela com o bot rodando.
- Ao commitar, use `git add` com caminhos explícitos: outras sessões do Claude podem estar mexendo em outros arquivos da mesma pasta.
- Segredos **não** vão para o git: `ml-afiliados/.env` e `ml-afiliados/data/` (inclui `data/cookies.txt`, a sessão do ML). Num PC novo eles não existem — e não precisam, porque o bot não roda lá.
- **Sessão do Mercado Livre**: o ML bloqueia login em janela aberta pelo bot. Quando vencer (o bot avisa no Telegram), o dono copia o header `cookie` do Link Builder pelo F12 do navegador dele e cola em `ml-afiliados/data/cookies.txt` **no PC de casa**.
- Testes: `cd ml-afiliados && npm test` (Node 18.17+; no PC de casa está o Node 24).
- **Skills do projeto** (`.claude/skills/`): `curadoria-de-ofertas` (padrão de qualidade, onde está cada regra, o que fazer quando aparece produto ruim) e `operar-o-bot` (reiniciar, investigar, onde fica cada coisa). Histórico de preço e nota de qualidade: README 3.13h.
- Mais detalhes: `ml-afiliados/README.md` (seções 3.6b nichos, 3.12 canais, 3.13 Awin).

## Pendências (14/10/2026)

- Awin: nenhuma loja aprovada é de beleza/perfume ainda. Pedir **Phebo** (aceita pessoa física); **Granado** está em análise. Várias grandes (O Boticário, Natura, Eudora, Beleza na Web) só aceitam CNPJ.
- Se o dono criou o serviço no Render, ele deve estar suspenso/apagado (senão posta em dobro).
- O PC de casa precisa ficar ligado e acordado das 7h às 22h (busca às 7h/12h/17h; envio a cada 3 min das 8h às 21h59 — `CRON_ENVIO` no `.env` de casa, mudado a pedido do dono em 15/10/2026).
