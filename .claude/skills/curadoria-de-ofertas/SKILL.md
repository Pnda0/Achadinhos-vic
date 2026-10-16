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
| Fontes | busca própria nas lojas: ML (`config/categorias.json`), Shopee (`config/shopee.json`, uma busca por marca), cupons Awin. **Não copia canal nenhum** (pedido do dono, 16/10/2026). Amazon só pelo privado do bot (sem API até 3 vendas; raspar o site é proibido pelo Associados) | `src/pipeline.js` `coletar()` |
| Nicho | o nome precisa ter palavra do nicho; marcas de cabelo/maquiagem/skincare/fitness contam como palavra (perfume NÃO: Dior vende roupa e casa) | `config/nichos.json`, `config/marcas.json` > `nichos` |
| Só marcas | Fitness, Beleza e Perfumes só com marca da lista | `"soMarcas"` em `config/grupos.json`, `src/marcas.js` |
| Força | ML: mais de 50 vendas pelo rótulo; Shopee: 50+ vendas, nota 4,5+, 15%+ de desconto, até 4 por busca | `src/ml/vendas.js`, `config/shopee.json` |
| Preço real | já esteve >10% mais barato em 30 dias = fora; menor preço em 30 dias = selo 📉 | `src/precos.js` (`data/precos.json`) |
| Repetido | mesmo id, mesmo nome, ou mesmo produto escrito de outro jeito (70% das palavras) em 5 dias | `parecido()` em `src/store.js` |
| Ordem | femininos > neutros > masculino (1 a cada 4; 1 a cada 5 no Perfumes), marca +1,5; dentro disso, **nota de qualidade** (desconto + vendas + avaliação + menor preço), sorteio entre as 3 melhores | `src/genero.js`, `notaDeQualidade()` em `src/store.js` |
| Na hora de postar | confere de novo: repetido, link, vendas, só marcas, nicho e palavras bloqueadas | `enviarProximo()` em `src/pipeline.js` |
| WhatsApp | mesmas regras, 1 mensagem a cada 6 min no total (só os melhores; o dono escolheu assim) | `src/whatsapp-espelho.js` |

Regras que **não se afrouxam sem o dono**: vendas mínimas, não repetir, público feminino, só marcas, ritmo do WhatsApp (risco de banir o chip), não copiar canais.

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
