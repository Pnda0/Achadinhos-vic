# ml-afiliados — bot de ofertas do Mercado Livre para WhatsApp

Recriação em Node.js da parte **Mercado Livre** da Comunidade VIP (workflows n8n), com as correções necessárias para funcionar hoje (out/2026).

```
categorias.json ──▶ COLETA ──▶ fila (data/db.json) ──▶ LINKS meli.la ──▶ ENVIO pro grupo
  (URLs /ofertas)    raspa       PENDENTE → PRONTO       (sua tag)        título + imagem + legenda
```

---

## 1. Como o sistema do curso funciona (e o que mudou aqui)

| Etapa no n8n (curso) | Como era | Neste projeto |
|---|---|---|
| **BUSCA DE PRODUTOS ML** | Lê a aba *Categoria* da planilha (URLs de `/ofertas` com status ATIVO), baixa o HTML e extrai os cards com regex (`poly-card` ou `dynamic-carousel`). Grava na aba *Produtos* com status `PENDENTE`. | `src/ml/parser.js` lê primeiro o **JSON que o ML embute na página** (mais estável e com mais dados: cupom, frete grátis, FULL, nota, vendidos, fim da oferta relâmpago). A regex do curso fica como reserva. |
| *(bug)* desconto | Procurava `poly-price__disc_label` | O ML trocou para `poly-price__discount-polylabel`, então o curso hoje grava o desconto **vazio**. Corrigido aqui e nos workflows limpos. |
| **GERA LINKS DE AFILIADOS** | `POST /affiliate-program/api/v2/affiliates/createLink` com `{urls, tag}`, cookies da conta (guardados no Redis) e header `x-csrf-token`. Lotes de 20, espera de 15s. Antes, um `GET /afiliados/linkbuilder` renova os cookies (*merge cookies*). | `src/ml/affiliate.js`: mesma técnica. Os cookies renovados ficam em `data/cookies.txt` (em vez do Redis). |
| **ENVIAR PRODUTOS PARA O GRUPO** | A cada 8 min (8h–21h): pega o 1º produto `PRONTO`, gera título com IA (Groq/Gemini/OpenRouter/OpenAI), monta a legenda, coloca uma borda na imagem, comprime, simula "digitando..." e envia via WuzAPI/Evolution. Marca `ENVIADO`. | `src/pipeline.js` + `src/caption.js` + `src/senders.js`. Escolhe entre os 5 maiores descontos (não só o 1º da fila). Envia via **whatsapp-web.js** (o mesmo do seu promo-bot), Evolution ou WuzAPI. |
| **Limpeza à meia-noite** | Apaga a aba *Produtos*. | Esvazia a fila, mas **guarda o histórico**, para não repetir produto por N dias (`diasSemRepetir`). |
| — | — | **Filtros por grupo**: desconto mínimo, faixa de preço, nota mínima e palavras bloqueadas. |

---

## 2. Colocando no ar (Windows) — 3 cliques

Pré-requisitos: **Node.js 18.17+** (recomendado o 22 LTS, https://nodejs.org/pt) e **Chrome ou Edge** instalado.

| Arquivo | O que faz |
|---|---|
| **`1-instalar.bat`** | Confere o Node, instala as dependências e roda os testes. |
| **`2-configurar.bat`** | Assistente: abre o navegador para você **logar no ML**, confere a etiqueta, busca ofertas, gera os links, conecta o **WhatsApp** (QR code), deixa você **escolher o grupo** numa lista e manda **1 oferta de teste**. Pode rodar de novo quando quiser. |
| **`3-iniciar.bat`** | Liga o bot no modo automático. Fica rodando enquanto a janela estiver aberta. |

Pelo terminal é a mesma coisa: `npm install` → `npm run configurar` → `npm start`.

## 3. Configuração (o que o assistente faz por você)

### 3.1 Tag de afiliado
O assistente lê as etiquetas da sua conta na página do Link Builder e grava em `ML_AFFILIATE_TAG=` no `.env`.
Para criar/ver etiquetas: Central de Afiliados do ML → **Administrar etiquetas**.

### 3.2 Login do Mercado Livre
`npm run login-ml` (o assistente chama sozinho) abre uma janela do Chrome/Edge **controlada pelo bot**. Você faz login normalmente e a sessão fica guardada em:
- `data/cookies.txt` — usada nas chamadas HTTP diretas (o jeito do curso, mais rápido);
- `data/perfil-ml/` — o perfil do navegador do bot, usado como **plano B**: se o ML recusar a chamada direta (401/403, página sem produtos), o bot repete a operação por dentro desse navegador, invisível.

Sua senha é digitada direto no site do ML; o bot não a vê nem guarda. Quando a sessão expirar (o log avisa), rode `npm run login-ml` de novo.

> `data/` e `.env` são a sua sessão logada: **não compartilhe** e não suba para o GitHub (o `.gitignore` já protege).

<details><summary>Jeito manual do curso (F12), se preferir</summary>

1. No Chrome, logado, abra `https://www.mercadolivre.com.br/afiliados/linkbuilder`
2. **F12** → aba **Network** → filtro `createLink` → gere um link pela página
3. Na requisição **createLink** → **Request Headers** → copie o valor de **cookie** para `data/cookies.txt`
4. Teste: `npm run testar-afiliado`
</details>

> Validado ao vivo em 01/10/2026: o `createLink` respondeu `200` com `short_url` (meli.la) para URLs de produto (`produto.mercadolivre.com.br/MLB-...`) e de catálogo (`/p/MLB...`), e o token CSRF vem em `<meta name="csrf-token">`.

### 3.3 Categorias — `config/categorias.json`
Equivale à aba *Categoria* da planilha. Qualquer URL de `mercadolivre.com.br/ofertas?...` funciona. Monte o filtro no site, copie a URL e cole aqui. Exemplos:
- Relâmpago: `/ofertas?container_id=MLB779362-1&promotion_type=lightning`
- Uma categoria: `/ofertas?category=MLB1276` (Esportes). O código da categoria aparece na URL quando você filtra no site.
- `"paginas": 2` busca 96 produtos (48 por página).

### 3.4 Grupos — `config/grupos.json`
- `nome` precisa ser igual ao `grupo` das categorias.
- `jid`: o assistente (`2-configurar.bat`) mostra seus grupos numerados e grava o JID escolhido. Manualmente: `npm run grupos` lista os grupos com o JID (`...@g.us`).
- `filtros` sobrescreve os `filtrosPadrao` daquele grupo.

### 3.5 WhatsApp — `SENDER` no `.env`
- `console`: **modo teste**. Mostra a mensagem na tela e não envia nada. Comece por aqui.
- `wwebjs`: abre o WhatsApp Web numa janela do Chrome/Edge; na primeira vez você escaneia o QR code (a sessão fica salva em `.wwebjs_auth/`). Use um **número separado** do seu pessoal. `WHATSAPP_JANELA=false` esconde a janela.
- `evolution` / `wuzapi`: se você já tiver um servidor rodando (como no curso).

### 3.6 Título com IA (opcional)
Com `LLM_API_KEY` vazio, ele usa títulos prontos por faixa de desconto. Com chave, usa o mesmo prompt do curso. A **Groq** tem plano gratuito e já vem configurada no `.env.example`.

---

## 3.6b Nichos — grupo só de um tema (ex.: fitness)

Um grupo pode receber só um tipo de produto. Em `config/grupos.json` o grupo ganha `"nicho": "fitness"`, e `config/nichos.json` diz o que é esse nicho:

- `obrigatorias`: o nome do produto precisa casar com **pelo menos uma** linha. `tenis+corrida` = precisa ter as duas palavras. Vale palavra inteira, sem ligar para acento, maiúscula ou plural simples.
- `extras`: também entram, mas com os títulos gerais (ex.: ração, perfume, fone comum, tênis casual — não faz sentido "BORA TREINAR" em ração).
- `bloqueadas`: se casar com alguma, fica de fora (ex.: `aquario`).
- `titulos`: títulos prontos com a cara do nicho (usados quando não há IA configurada).

Como o ML não tem uma página de ofertas "só fitness", o bot varre as ofertas de várias categorias (`config/categorias.json`) e **o filtro de palavras é que faz a seleção**. No log da coleta, `Recusados: {"fora do nicho": N, ...}` mostra quanto ficou de fora; para ajustar, edite as listas e reinicie o bot.

## 3.7 Espelho — aproveitar ofertas de outros grupos

O bot pode ficar "ouvindo" outros grupos de ofertas em que o seu WhatsApp já participa. Quando alguém posta um link do Mercado Livre (`meli.la/...`), ele:

1. abre o link (como um visitante comum) e lê **qual produto** está sendo divulgado — título, preço, desconto, cupom, frete e foto vêm da página do ML, não da mensagem;
2. gera o **seu** link de afiliado para esse produto;
3. põe na fila com prioridade e posta no seu grupo **no nosso formato**. Nada do texto, da imagem, do link ou do convite do outro grupo é reaproveitado.

Configuração em `config/fontes.json` (ou `npm run fontes -- "Nome do grupo A" "Nome do grupo B"`): os nomes são os que aparecem no WhatsApp; pode ser só uma parte, se for única. Reinicie o bot depois.

| Opção | O que faz |
|---|---|
| `intervaloSegundos` | de quanto em quanto tempo confere os grupos-fonte (mín. 30) |
| `janelaMinutos` | só considera mensagens postadas nos últimos N minutos |
| `maxPorHora` | teto de ofertas aproveitadas por hora |

Cuidados: valem os mesmos filtros do grupo de destino (desconto mínimo, preço, palavras bloqueadas, não repetir). Se o Mercado Livre pedir verificação de segurança (captcha) ou recusar a sessão, o espelho **pausa por 1 hora** em vez de insistir. Para testar um link sem WhatsApp: `npm run testar-espelho -- https://meli.la/XXXX`.

## 3.8 Avisos e resumo diário no seu WhatsApp

Com `AVISOS_DESTINO` no `.env`, o bot te avisa quando algo dá errado — em vez de falhar calado:

- **sessão do ML expirou** (sem ela não sai link de afiliado) — com o passo a passo para renovar;
- **a busca no ML não trouxe nada** (bloqueio ou mudança na página);
- **acabaram as ofertas** do grupo antes da próxima busca;
- **falha ao postar** no grupo; **espelho pausado** por verificação do ML;
- **bot ligado** (confirmação a cada vez que liga).

Cada tipo de alerta sai no máximo 1 vez a cada 3 horas. Às 22h (`CRON_RESUMO`) chega o **resumo do dia**: quantas ofertas foram postadas e de quais categorias, maior desconto, quantos produtos cada categoria trouxe e quantos foram aprovados, e os motivos de recusa. Para ver o resumo a qualquer hora: `npm run resumo`.

Destino recomendado: crie um grupo **"Avisos do bot"** só com você e o número do bot e ponha `AVISOS_DESTINO=Avisos do bot`. Também aceita o seu número (`5579999998888`). Se o WhatsApp do bot cair, ele não consegue avisar por lá — nesse caso só o log (`data/bot.log`) registra.

### Monitoramento externo: ser avisado se o bot cair

Os avisos acima saem do próprio bot — se o processo morrer (deploy quebrado, Render fora do ar, sessão do WhatsApp presa), ele não consegue avisar. Para isso serve o `HEARTBEAT_URL`: o bot faz um GET nessa URL a cada 5 min (`CRON_HEARTBEAT`), e se os pings pararem um serviço externo te avisa.

1. Crie uma conta grátis em https://healthchecks.io (ou use o "heartbeat monitor" do UptimeRobot / Better Stack) e crie um check com **período de 5 min** e **tolerância de uns 10 min**.
2. Configure nele para onde quer ser avisado (e-mail, Telegram, etc.).
3. Copie a URL de ping (`https://hc-ping.com/<uuid>`) e cole em `HEARTBEAT_URL` — no `.env` local e nas variáveis de ambiente do serviço no Render.

Sem `HEARTBEAT_URL` o bot funciona normalmente, só não tem esse monitoramento.

## 3.9 Amazon (API oficial)

A Amazon entra pela **Creators API** (a API oficial que substituiu a PA-API 5). Não raspamos o site da Amazon: o contrato do Associados proíbe robôs no site e só permite mostrar preço vindo da API — raspando, a conta pode ser encerrada e as comissões retidas.

1. Associates Central > **Ferramentas > Creators API** > *Create Application* > *Add New Credential*. Só o dono da conta consegue. O **Secret aparece uma vez só**.
2. No `.env`: `AMAZON_CREDENTIAL_ID`, `AMAZON_CREDENTIAL_SECRET` e `AMAZON_PARTNER_TAG` (sua etiqueta, ex.: `xxxx-20`).
3. Teste: `npm run testar-amazon -- "air fryer"` (no Docker: `docker compose run --rm bot npm run testar-amazon`).
4. As buscas ficam em `config/amazon.json` (palavra + departamento + desconto mínimo). Cada busca é 1 chamada; o limite inicial da Amazon é 1 por segundo.

**Espelho da Amazon (funciona sem a API):** se um grupo-fonte do espelho postar link da Amazon (`amazon.com.br/...`, `amzn.to/...`), o bot pega o código do produto (ASIN), monta `https://www.amazon.com.br/dp/ASIN?tag=SUA-ETIQUETA` e posta no nosso formato usando o nome/preço/cupom escritos na mensagem — sem abrir a página da Amazon. A foto vem da prévia de link do WhatsApp. Precisa só de `AMAZON_PARTNER_TAG` no `.env`.

**Sem a API, automático (canais públicos do Telegram):** em `config/fontes.json` > `canaisTelegram` ficam os canais públicos de ofertas que o bot acompanha sozinho. Ele lê a página aberta do canal (`https://t.me/s/<canal>`) a cada 3 min, pega as mensagens com link da Amazon (`amazon.com.br`, `amzn.to`, `link.amazon`), troca pela sua etiqueta e põe na fila no nosso formato, com a foto e o preço que estiverem na mensagem — sem abrir a página da Amazon. `soAmazon: true` ignora o que for do Mercado Livre (que já tem a busca própria); `maxPorHora` limita quantas entram por hora, porque elas passam na frente da fila. Para trocar os canais, edite a lista `canais` (só o nome, sem `@`) e reinicie o bot. Precisa só de `AMAZON_PARTNER_TAG`.

**Sem a API, à mão (caixa de entrada):** com `SENDER=telegram`, `AVISOS_DESTINO_TELEGRAM` (o chat id da sua conversa privada com o bot) e `AMAZON_PARTNER_TAG`, mande ou encaminhe para o bot, no privado, qualquer oferta com link da Amazon (`amazon.com.br/...`, `amzn.to/...`). Ele troca pela sua etiqueta, usa o nome/preço/cupom que estiverem escritos na mensagem e a foto que vier junto, põe na frente da fila e responde confirmando (ou dizendo por que não entrou). Link do Mercado Livre também vale. Só a sua conversa é lida; mensagem de outras pessoas para o bot é ignorada. Mensagem com mais de 3 horas é descartada (o preço já pode ter mudado).

A Amazon só libera a API para contas com vendas qualificadas recentes; sem isso ela responde 403 e o bot avisa no grupo "Avisos do bot" (o Mercado Livre segue normal). Toda oferta da Amazon sai com a hora em que o preço foi consultado e o aviso de que pode mudar, como a Amazon exige.

## 3.10 Testar pelo Telegram (sem WhatsApp)

1. No Telegram, fale com **@BotFather** > `/newbot` > dê nome e usuário (terminando em `bot`). Ele devolve o **token**.
2. Crie um **canal** (ex.: "Achadinhos da Vic (teste)") e adicione o bot como **administrador** com permissão de postar. Poste qualquer coisa no canal e mande `/start` no privado do bot.
3. No `.env`: `SENDER=telegram` e `TELEGRAM_BOT_TOKEN=<token>`.
4. `npm run telegram` mostra os chats que o bot viu, com o **chat id** (canal começa com `-100`). Ponha o do canal em `config/grupos.json` → `"telegram": "-100..."` e o da sua conversa privada em `AVISOS_DESTINO_TELEGRAM`.
5. Ligue o bot normalmente. Para voltar ao WhatsApp, é só `SENDER=wwebjs` (o JID do WhatsApp continua guardado em `jid`).

O espelho de outros grupos só funciona no WhatsApp.

## 3.11 Rodar na nuvem (Render), postando no Telegram

Assim o bot fica ligado sem depender do seu PC. O arquivo `render.yaml` (na raiz do repositório) já descreve o **bot** (worker em Docker, com um disco para a fila e a sessão do ML). O site não vai para o Render. O worker com disco exige plano pago do Render.

1. Tenha em mãos, do seu `.env`: `ML_AFFILIATE_TAG`, `TELEGRAM_BOT_TOKEN` e `AVISOS_DESTINO_TELEGRAM` (seção 3.10). `HEARTBEAT_URL` é opcional (seção 3.10, "Monitoramento externo").
2. Pegue os cookies do ML pelo F12 (seção 3.2, "Jeito manual") — é o valor que vai em `ML_COOKIES`. Na nuvem não há janela para o `npm run login-ml`.
3. No Render: **Dashboard > New > Blueprint** > escolha este repositório. Ele lê o `render.yaml` e pede os segredos; cole os valores. Amazon (`AMAZON_*`) e `LLM_API_KEY` são opcionais.
4. Acompanhe em **Logs** do serviço `achadinhos-vic-bot`: deve aparecer `✅ Telegram conectado`, a primeira busca e os links gerados. O aviso **"Bot ligado"** chega no seu Telegram.

No dia a dia:

- **Sessão do ML expirou** (o bot avisa no Telegram): pegue os cookies de novo pelo F12, cole em **Environment > `ML_COOKIES`** e salve. O Render reinicia o bot e o valor novo passa a valer.
- **Mudar categorias, grupos ou filtros**: edite os arquivos em `config/`, faça commit e push — o Render publica sozinho.
- **Ver a fila ou o log**: aba **Shell** do serviço > `npm run status` ou `tail -n 50 data/bot.log`.

Atenção: os servidores do Render ficam fora do Brasil. Se o Mercado Livre pedir verificação ou recusar a sessão vinda de lá, o bot avisa (`busca não trouxe nenhum produto` / `sessão expirou`) em vez de falhar calado — nesse caso, o caminho é rodar no seu PC (seção 2) ou num servidor no Brasil.

## 4. Uso

Cada etapa também roda separada:

```powershell
npm run login-ml          # login do ML (abre o navegador)
npm run coletar           # busca ofertas → fila PENDENTE
npm run links             # gera os links meli.la → PRONTO
npm run status            # mostra a fila por grupo
npm run enviar            # envia 1 oferta para cada grupo ativo (SENDER=console só mostra)
npm run enviar -- Geral   # só para um grupo
```

Tudo funcionando? Deixe rodando sozinho:

```powershell
npm start
```

Agenda padrão (edite no `.env`, formato cron):
- **coleta + links**: 7h, 12h e 17h
- **envio**: a cada 8 min, das 8h às 21h59
- **limpeza**: meia-noite
- **heartbeat** (se `HEARTBEAT_URL` estiver preenchido): a cada 5 min

O bot só funciona com o computador ligado e a janela do `3-iniciar.bat` aberta. Para subir junto com o Windows: `Win+R` → `shell:startup` → cole ali um **atalho** do `3-iniciar.bat`.

---

## 5. Exemplo de mensagem gerada

```
*CORRE QUE ACABA 🏃*

Tênis Masculino Feminino Kappa Park 2.0

~De R$ 169,99~
🔥 *Por R$ 69,34* no Pix (59% OFF)

🎟️ R$ 15 OFF com cupom
🚚 Frete grátis ⚡FULL
⭐ 4.7 · +250mil vendidos
⏳ Oferta relâmpago — acaba hoje!

🏬 Mercado Livre:
🛒 https://meli.la/xxxxx

🔗 Convide um amigo para o grupo: https://chat.whatsapp.com/...
```

---

## 6. Estrutura

```
config/categorias.json   URLs de ofertas por grupo (= aba Categoria)
config/grupos.json       grupos, JIDs, mensagem adicional, filtros
src/ml/parser.js         extrai produtos (JSON embutido → poly-card → carousel)
src/ml/scraper.js        baixa as páginas (com paginação)
src/ml/affiliate.js      cookies + createLink (links meli.la)
src/ml/login.js          login do ML pelo navegador do bot
src/browser.js           acha o Chrome/Edge do PC; plano B por navegador
src/setup.js             assistente de configuração (npm run configurar)
src/espelho.js           espelho: lê grupos-fonte e enfileira as ofertas com o seu link
src/ml/resolver.js       do link de outro afiliado (meli.la) até os dados do produto
src/patch-wwebjs.js      correção do envio de imagem no whatsapp-web.js
config/fontes.json       grupos-fonte do espelho
config/nichos.json       palavras e títulos de cada nicho (fitness)
src/store.js             fila e histórico em data/db.json (= aba Produtos)
src/caption.js           título (IA ou pronto) + legenda
src/senders.js           whatsapp-web.js / Evolution / WuzAPI / console
src/pipeline.js          coletar → gerarLinks → enviarProximo → limpar
src/index.js             agendador (npm start)
src/cli.js               comandos manuais
test/                    testes com HTML real do ML (out/2026)
```

## 7. Problemas comuns

| Sintoma | Causa provável / solução |
|---|---|
| `0 produtos (via html-polycard)` | O ML mudou a página. Rode `npm test`; se passar, o problema é o HTML novo. Salve a página e ajuste `parser.js`. |
| `createLink HTTP 401/403` / `Sessão expirada` | Rode `npm run login-ml` de novo. |
| `Não encontrei Chrome nem Edge` | Instale o Chrome ou preencha `CHROME_PATH=` no `.env` com o caminho do `chrome.exe`. |
| WhatsApp não conecta / QR não aparece | Apague a pasta `.wwebjs_auth` e rode o `2-configurar.bat` de novo. |
| Produto repetido | Aumente `diasSemRepetir`. |
| Poucos produtos passando | Veja `Recusados: {...}` no log da coleta e afrouxe os filtros. |

## 8. Pontos de atenção

- O `createLink` é uma **API interna** do ML (a mesma que a página do Link Builder usa), não uma API oficial. Pode mudar sem aviso, e o uso automatizado pode ir contra os termos do programa de afiliados. Use em volume moderado.
- WhatsApp não oficial (whatsapp-web.js/WuzAPI/Evolution) pode banir o número. Os intervalos aleatórios e o "digitando..." reduzem o risco, mas não eliminam.
- Os workflows n8n originais do curso traziam **cookies de sessão e token da conta do autor**. As versões em `../n8n-mercado-livre-limpos/` estão sem esses dados.
