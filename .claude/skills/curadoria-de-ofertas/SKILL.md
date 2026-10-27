---
name: curadoria-de-ofertas
description: Padrão de qualidade das ofertas dos grupos Achadinhos da Vic e como o bot decide o que posta. Use quando o dono reclamar de um produto ruim/estranho/repetido/masculino num grupo, pedir mais ou menos ofertas, pedir para mudar filtros, marcas, nichos, fontes (Mercado Livre, Shopee, Awin, Amazon) ou a ordem dos posts, ou quando for avaliar a qualidade dos grupos.
---

# Curadoria de ofertas — Achadinhos da Vic

Objetivo do dono: **grupos de ofertas da melhor qualidade possível**, no padrão dos maiores (Promobit, Pelando):
oferta de verdade (desconto real, não inflado), produto que vende e é bem avaliado, marca conhecida, público **meninas**,
sem repetir, foto boa, texto limpo. Pouca oferta boa vale mais que muita oferta ruim.

## Como o bot decide (onde está cada regra)

| Etapa | Regra | Onde |
|---|---|---|
| Fontes | busca própria nas lojas: ML (`config/categorias.json`), Shopee (`config/shopee.json`, uma busca por marca), cupons Awin e produtos dos catálogos da Awin (`src/awin-produtos.js`, precisa de `AWIN_FEED_KEY`). **Não copia canal nenhum** (pedido do dono, 16/10/2026), salvo a **Amazon** de canais públicos (desde 27/10/2026: `canaisTelegram` em `config/fontes.json` com `apenasAmazon` — @xetdaspromocoes, @urubupromo, @HomemCheiroso — formato do bot, etiqueta do dono, todas as regras; ML/Shopee/Awin dos canais ficam de fora). WePink tem prioridade própria (`"peso": 3` no item de `config/marcas.json`, 27/10/2026); brindes com o nome dela são palavras bloqueadas. Antes de pôr um canal na lista, medir quantas ofertas da Amazon dele passam nos filtros (só marcas + nicho). O grupo "A Promo da Luh" ficou de fora (`gruposTelegram.ativo: false`). Amazon também pelo privado do bot (sem API até 3 vendas; raspar o site é proibido pelo Associados) | `src/pipeline.js` `coletar()` |
| Nicho | o nome precisa ter palavra do nicho; marcas de cabelo/maquiagem/skincare/fitness contam como palavra (perfume NÃO: Dior vende roupa e casa) | `config/nichos.json`, `config/marcas.json` > `nichos` |
| Só marcas | Fitness, Beleza e Perfumes só com marca da lista | `"soMarcas"` em `config/grupos.json`, `src/marcas.js` |
| Força | ML: mais de 50 vendas pelo rótulo; Shopee: 50+ vendas, nota 4,5+, 15%+ de desconto, até 4 por busca | `src/ml/vendas.js`, `config/shopee.json` |
| Falsificação | marca cara vendida barata demais fica de fora (27/10/2026: "Lattafa Yara" de R$ 27): árabes abaixo de R$ 60, grifes abaixo de R$ 100 | `config/marcas.json` > `precoMinimo`, `motivoPrecoDaMarca()` em `src/marcas.js` |
| Preço real | já esteve >10% mais barato em 30 dias = fora; menor preço em 30 dias = pontos na fila (sem selo no post: o dono não gostou) | `src/precos.js` (`data/precos.json`) |
| Repetido | mesmo id, mesmo nome, ou mesmo produto escrito de outro jeito (70% das palavras) em 5 dias | `parecido()` em `src/store.js` |
| Ordem | femininos > neutros > masculino (1 a cada 10 desde 27/10/2026: "coisa masculina demais"; camisa/bermuda sem "feminina" e árabes masculinos famosos contam como masculino — `src/genero.js`), marca +1,5; dentro disso, **nota de qualidade** (desconto + vendas + avaliação + menor preço), sorteio entre as 3 melhores | `src/genero.js`, `notaDeQualidade()` em `src/store.js` |
| Na hora de postar | confere de novo: repetido, link, vendas, só marcas, nicho e palavras bloqueadas | `enviarProximo()` em `src/pipeline.js` |
| Equilíbrio de lojas | depois de uma oferta de uma loja, a vez é de outra loja do mesmo nível (alterna ML e Shopee quando as duas têm oferta) | `proximo()` em `src/store.js` |
| Shopee com limite | comissão baixa (dono, 26/10/2026): no máximo 1 Shopee a cada 4 posts por grupo; só Shopee na fila = 1 a cada 12 min | `shopeeLiberada()` em `src/pipeline.js`, `config/shopee.json` > `umACada` |
| Catálogo da Awin com calma | dono, 27/10/2026 ("os tênis da Nike tão muito exagerados, o grupo é pra mulheres"): sem peça masculina nos grupos de meninas, sem infantil, até R$ 400, femininas primeiro; no máximo 1 a cada 4 posts e 6 por dia por grupo | `motivoForaDoPublico()` em `src/awin-produtos.js`, `awinLiberada()` em `src/pipeline.js`, `config/awin.json` > `produtos` |
| Cupom do dia | pelo menos 1 cupom de loja (Awin) por dia em cada grupo: o do tema/loja do grupo, senão o melhor genérico que não exclua o grupo; passa na frente na fila, nunca dois seguidos | `buscarCuponsAwin()` em `src/awin.js`, `cupomDoDia()` em `src/index.js` |
| ML com calma | ~22 páginas por busca; bloqueio (verificação de tráfego suspeito) = 6 h sem pedir páginas ao ML; reposição NÃO vai ao ML (só nas 3 buscas do dia, ~66 páginas; o bloqueio de 21/10 veio de ~220 páginas/dia) | `ErroBloqueioML` em `src/ml/scraper.js`, `coletar()` |
| WhatsApp | mesmas regras, 1 mensagem a cada 6 min no total (só os melhores; o dono escolheu assim) | `src/whatsapp-espelho.js` |

Regras que **não se afrouxam sem o dono**: vendas mínimas, não repetir, público feminino, só marcas, ritmo do WhatsApp (risco de banir o chip), não copiar canais (fora a Amazon dos canais de `canaisTelegram`, 27/10/2026).

## Quando o dono reclama de um produto

1. Ache o produto e de onde ele veio: `cd ml-afiliados && npm run historico -- "<parte do nome>"` (ou `data/produtos.log`; o campo `busca` no `data/db.json` diz qual busca da Shopee o trouxe).
2. Ache a **causa**, não o sintoma. Ex. reais: rack de TV "Off White Dior" veio da busca "Dior" e passou porque marca contava como palavra de perfume; o mesmo perfume saiu 6 vezes porque cada vendedor escreve o nome de um jeito.
3. Corrija a regra na raiz (config ou código), com teste em `ml-afiliados/test/` que reproduz o caso real.
4. Garanta que o que **já está na fila** também não sai (a conferência na hora de postar existe para isso).
5. `npm test`, commit com `git add` de caminhos explícitos, push, e reinicie o bot (skill `operar-o-bot`).
6. Responda curto, em português, sem jargão: o que era, o que mudou, se precisa de algo dele.

## Ao mexer em marcas, nichos ou buscas

- Marca nova: `config/marcas.json` (nome ou `{"marca", "termos"}` se escrita de outro jeito; `re:` para expressão regular). Confira falso positivo com produtos reais do `data/produtos.log`.
- Antes de apertar um filtro, meça o efeito com o histórico (quantos posts de hoje passariam) e conte ao dono — filtro forte demais esvazia o grupo.
- Grupo vazio dispara busca de reposição sozinho (no máximo 1 a cada 2 h por grupo). Se esvaziar sempre, falta fonte, não filtro.
