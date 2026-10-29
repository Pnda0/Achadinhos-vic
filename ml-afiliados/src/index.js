/**
 * Modo automático (npm start): faz o papel dos gatilhos agendados do n8n.
 *   CRON_COLETA  -> coleta ofertas e já gera os links
 *   CRON_ENVIO   -> envia 1 oferta por grupo (padrão do código: a cada 8 min das 8h às 21h59; no PC de casa o .env usa 3 min)
 *   CRON_LIMPEZA -> esvazia a fila à meia-noite
 *   CRON_RESUMO  -> manda o resumo do dia no WhatsApp do dono (AVISOS_DESTINO)
 */
import fs from 'node:fs';
import path from 'node:path';
import cron from 'node-cron';
import { DATA_DIR, loadCategorias, loadFontes, loadGrupos, loadNichos, loadShopee, settings, vincularCanal } from './config.js';
import { Avisos } from './avisos.js';
import { Awin } from './awin.js';
import { Shopee } from './shopee.js';
import { grupoDoTitulo } from './telegram.js';
import { iniciarHeartbeat } from './heartbeat.js';
import { Espelho, resolverFontes } from './espelho.js';
import { LeitorDeCanais, fonteDoGrupoTelegram, fontesDosCanais } from './telegram-canais.js';
import { MLAffiliate } from './ml/affiliate.js';
import { MLApi } from './ml/api.js';
import { PAUSA_ML_HORAS, coletar, filaDeOutroDia, gerarLinks, enviarParaTodos, limpar } from './pipeline.js';
import { createSender } from './senders.js';
import { Store } from './store.js';
import { diaLocal, log, sleep } from './util.js';

import { instalarLogEmArquivo, pedirParaReligar, registrarErro } from './logfile.js';
import { gerarDia, porEmDia } from './analytics/dia.js';
import { membrosDoDia, registrarMembros } from './analytics/membros.js';
import { registrarAwin } from './analytics/ganhos.js';
import { montarPainel } from './analytics/relatorio.js';
import { destaquesDoDia, resumoSemanal } from './analytics/destaques.js';
import { gravarSite } from './analytics/pagina.js';
import { publicarPainel, urlPublicada } from './analytics/publicar.js';
import { MSG_BOT_TRAVADO, MSG_OUTRA_COPIA, outrosBots, travarInstancia } from './instancia.js';
import { desligarEdicaoRapida } from './janela.js';
import { EspelhoWhatsApp } from './whatsapp-espelho.js';
import { ligarGruposWhatsApp } from './grupos-whatsapp.js';
import { generoDoProduto } from './genero.js';

// Caiu (erro inesperado, ou sem internet por 30 min ao ligar): o 3-iniciar.bat liga de novo em 1 min (src/logfile.js).
const religar = () => {
  if (pedirParaReligar()) log('🔁 O bot liga de novo sozinho em 1 minuto.');
  else log('⛔ Várias quedas seguidas: o bot fica parado até alguém ligar de novo.');
};
instalarLogEmArquivo('iniciar', { aoCair: religar });

// Criados no main(), DEPOIS da trava de cópia única: uma 2ª cópia não pode nem abrir o db.json.
let store;
let sender;
let avisos;
let ocupado = false;
let parando = false; // reinício pedido: nenhuma tarefa nova começa
let whatsSender = null;

/**
 * Evita que duas tarefas rodem ao mesmo tempo (ex.: coleta demorada + envio). Envio ocupado = pula (outro vem em 3
 * min). A coleta ESPERA a vez (até 10 min): às 12h e 17h ela cai no mesmo minuto do envio (*\/3) e era pulada
 * inteira quando o envio começava primeiro (visto em 15 e 16/10/2026).
 */
const exclusivo = (nome, fn, { esperarVez = false } = {}) => async (...args) => {
  if (parando) return;
  for (let s = 0; esperarVez && ocupado && !parando && s < 600; s += 5) await sleep(5000);
  if (parando) return;
  if (ocupado) return log(`⏭️  ${nome}: outra tarefa em andamento, pulando.`);
  ocupado = true;
  try {
    await fn(...args);
  } catch (e) {
    registrarErro(nome, e);
    log(`❌ ${nome}: ${e.message}`);
    await avisos.erroTarefa(nome, e);
  } finally {
    ocupado = false;
  }
};

// `apenasGrupos`: busca de reposição só dos grupos vazios (o node-cron passa outra coisa no 1º argumento: ignorada).
const cicloColeta = exclusivo('coleta', async (apenasGrupos) => {
  const reabertas = store.reabrirErros(); // falhas com recusa clara voltam para a fila (até 3 tentativas)
  if (reabertas) log(`♻️  ${reabertas} oferta(s) que tinham falhado no envio voltaram para a fila.`);
  const reposicao = Array.isArray(apenasGrupos);
  // Busca de reposição NUNCA vai ao Mercado Livre (só Shopee e Awin): o ML marcou o bot como robô em 21/10/2026
  // depois que as reposições levaram as páginas de ~70 para ~220 por dia. ML só nas 3 buscas do dia (~66 páginas).
  const r = await coletar(store, { apenasGrupos: reposicao ? apenasGrupos : null, mlMinIntervaloH: reposicao ? 24 : 0 });
  if (r.mlBloqueado) await avisos.avisar('ml-bloqueio', `*Mercado Livre bloqueou a busca* ⛔\n${r.mlBloqueado}.\nO bot fica ${PAUSA_ML_HORAS} h sem pedir páginas ao ML (insistir piora) e segue com os mais vendidos do ML pela API oficial, a Shopee e os cupons. Se continuar, passe pela verificação no PC de casa: npm run ml-liberar abre o ML numa janela do Chrome (entre na sua conta ali).`);
  if (!r.encontrados && !r.mlBloqueado) await avisos.coletaVazia();
  if (r.amazonErro) await avisos.avisar('amazon', `*Amazon fora do ar no bot* ⚠️\n${r.amazonErro}`);
  if (r.awinErro) await avisos.avisar('awin', `*Awin fora do ar no bot* ⚠️\n${r.awinErro}`);
  await gerarLinks(store);
}, { esperarVez: true });

/**
 * Busca de reposição (pedido do dono, 15/10/2026: "acabaram as ofertas do Beleza e do Fitness"): grupo que tem
 * busca própria (categorias do ML ou Shopee) e ficou sem nada na fila ganha uma busca extra — no máximo uma a cada
 * REPOSICAO_MIN minutos. Vale também ao ligar (o PC pode ter perdido o horário). Era 2 h para não forçar o ML; como a
 * reposição não vai mais ao ML (só Shopee, Awin e cupons), caiu para 30 min (o dono, 27/10/2026: "não pode existir a
 * fila vazia de jeito nenhum"). Cada busca da Shopee pega outra página de resultados (shopee-busca.js).
 */
const REPOSICAO_MIN = 30;
function gruposSemFila() {
  const shopee = loadShopee();
  const comBusca = new Set([
    ...loadCategorias().filter((c) => c.ativo).map((c) => c.grupo),
    ...(shopee.ativo === false ? [] : Object.entries(shopee.grupos || {}).filter(([, g]) => g.ativo !== false).map(([n]) => n)),
  ]);
  const ativos = loadGrupos().filter((g) => g.ativo && comBusca.has(g.nome)).map((g) => g.nome);
  // Só masculinos na fila conta como vazio: eles esperam a vez (1 a cada N) e o grupo fica parado (16/10/2026).
  const temOferta = (p) => (p.status === 'PRONTO' || p.status === 'PENDENTE') && generoDoProduto(p) !== 'm';
  return ativos.filter((nome) => !store.list((p) => p.grupo === nome && temOferta(p)).length);
}
async function reporSePreciso(quando) {
  // Conta por grupo: um grupo que nunca foi buscado (ex.: acabou de ganhar busca própria) é buscado na hora.
  const porGrupo = store.data.coletaPorGrupo || {};
  const vazios = gruposSemFila().filter((g) => Date.now() - (Date.parse(porGrupo[g] || 0) || 0) >= REPOSICAO_MIN * 60_000);
  if (vazios.length) {
    log(`🔁 Busca de reposição (${quando}): sem ofertas na fila de ${vazios.join(', ')} — buscando só ${vazios.length > 1 ? 'esses grupos' : 'esse grupo'}.`);
    await cicloColeta(vazios);
  }
  await cupomDoDia(quando);
}

/**
 * Pelo menos 1 cupom de loja por dia em cada grupo (pedido do dono, 21/10/2026): grupo ligado sem cupom hoje (nem
 * postado nem na fila) ganha uma busca só de cupons da Awin — no máximo a cada 2 h, das 8h às 20h.
 */
const cicloCupons = exclusivo('cupons', (grupos) => coletar(store, { apenasGrupos: grupos, soCupons: true }), { esperarVez: true });
async function cupomDoDia(quando) {
  const hora = Number(new Date().toLocaleString('en-GB', { hour: '2-digit', hour12: false, timeZone: settings.tz }));
  if (hora < 8 || hora > 20 || Date.now() - (Date.parse(store.data.ultimaBuscaCupons || 0) || 0) < 2 * 3_600_000) return;
  const hoje = diaLocal(new Date(), settings.tz);
  const temCupom = (g) => store.list((p) => p.grupo === g && p.tipo === 'cupom' && (['PRONTO', 'PENDENTE', 'ENVIANDO'].includes(p.status) || (p.status === 'ENVIADO' && p.enviadoEm && diaLocal(new Date(p.enviadoEm), settings.tz) === hoje))).length > 0;
  const semCupom = loadGrupos().filter((g) => g.ativo && !temCupom(g.nome)).map((g) => g.nome);
  if (!semCupom.length) return;
  store.data.ultimaBuscaCupons = new Date().toISOString();
  log(`🎟️ Cupom do dia (${quando}): ${semCupom.join(', ')} ainda sem cupom de loja hoje — buscando cupons da Awin.`);
  await cicloCupons(semCupom);
}

/** Analytics (data/analytics/): só lê e grava arquivos de relatório; uma falha aqui nunca derruba o bot. */
function analytics(nome, fn) {
  try {
    return fn();
  } catch (e) {
    registrarErro(`analytics-${nome}`, e);
    log(`⚠️  analytics (${nome}): ${String(e.message).split('\n')[0]}`);
  }
}

// Lojas parceiras da Awin: uma instância só, para a lista de lojas aprovadas ficar em memória.
const awin = new Awin();
// Shopee de afiliados (SHOPEE_APP_ID/SHOPEE_SECRET no .env): troca os links da Shopee dos posts copiados.
const shopee = new Shopee();

/**
 * O dono pôs o bot como administrador de um canal: se o título tem o nome de um grupo em espera
 * (Fitness, Beleza, Perfumes...), o canal é ligado a ele sozinho e a primeira busca já roda.
 */
async function ligarCanalNovo({ chatId, titulo, tipo, quem }) {
  const grupos = loadGrupos();
  if (grupos.some((g) => g.telegram === chatId)) return;
  if (!avisos.jid || quem !== avisos.jid) {
    return log(`📋 Canal "${titulo}" [${tipo}] = ${chatId}: não liguei sozinho porque quem adicionou o bot não é o dono (AVISOS_DESTINO_TELEGRAM).`);
  }
  const grupo = grupoDoTitulo(titulo, grupos);
  if (!grupo) {
    const espera = grupos.filter((g) => g.emEspera).map((g) => g.nome).join(', ') || 'nenhum';
    return avisos.avisar(`canal-${chatId}`, `*Canal novo: ${titulo}* 📋\nNão sei a qual grupo ele pertence. Ponha no título do canal o nome de um grupo em espera (${espera}) ou preencha "telegram": "${chatId}" em config/grupos.json.`);
  }
  vincularCanal(grupo.nome, chatId);
  const convite = await sender.conviteDoCanal?.(chatId);
  log(`🔗 Canal "${titulo}" (${chatId}) ligado ao grupo ${grupo.nome}.`);
  await avisos.avisar(`canal-${chatId}`, `*Canal ligado: ${grupo.nome}* ✅\n"${titulo}" já recebe as ofertas de ${grupo.nome}. A primeira busca começa agora.${convite ? `\nConvite para pôr no site: ${convite}` : '\nPara eu gerar o convite do site, dê ao bot a permissão de convidar pessoas.'}`, { sempre: true });
  cicloColeta();
}

function agendarEspelho(espelho, seg) {
  setInterval(() => {
    espelho.tick().catch((e) => {
      registrarErro('espelho', e);
      log(`❌ espelho: ${String(e.message).split('\n')[0]}`);
    });
  }, seg * 1000);
}

/**
 * Telegram: a conversa privada do dono com o bot (AVISOS_DESTINO_TELEGRAM) vira uma caixa de entrada.
 * Ele manda/encaminha uma oferta com link da Amazon ou do ML e o bot posta no canal com o link dele.
 */
function iniciarCaixaDeEntrada(cfg) {
  const dono = avisos.jid;
  if (!dono) return log('📥 Caixa de entrada desligada (preencha AVISOS_DESTINO_TELEGRAM com o chat id da sua conversa com o bot).');
  if (loadGrupos().some((g) => g.jid === dono)) return log('📥 Caixa de entrada desligada: AVISOS_DESTINO_TELEGRAM é o próprio canal de envio.');
  // Com o grupo padrão pausado (o Geral, 16/10/2026), cada oferta vai para o grupo cujo nicho casa com o produto.
  const ativos = loadGrupos().filter((g) => g.ativo);
  const padrao = cfg.destinoPadrao || 'Geral';
  const nichos = loadNichos();
  const porNicho = !ativos.some((g) => g.nome === padrao);
  const destino = porNicho ? ativos.map((g) => g.nome).join('/') : padrao;
  const fontes = [{
    nome: 'Caixa de entrada', nomeWhats: 'Caixa de entrada', jid: dono, destino: porNicho ? ativos[0]?.nome : padrao, manual: true,
    ...(porNicho && { destinos: ativos.map((g) => ({ grupo: g.nome, palavras: g.nicho ? nichos[g.nicho]?.obrigatorias || [] : null })) }),
  }];
  sender.aoVirarAdmin = (canal) => ligarCanalNovo(canal).catch((e) => registrarErro('canal-novo', e));
  const espelho = new Espelho({ sender, store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, janelaMinutos: 180 }, avisos, awin, shopee });
  ligarGruposFonte(espelho, cfg);
  agendarEspelho(espelho, 10);
  log(`📥 Caixa de entrada ligada: mande um link da Amazon, do Mercado Livre${shopee.ligada() ? ', da Shopee' : ''}${awin.ligada() ? ' ou de loja parceira da Awin' : ''} no privado do bot que ele entra na fila ${porNicho ? `do grupo do nicho (${destino})` : `do grupo "${destino}"`}.`);
}

/**
 * Espelho no WhatsApp (WHATSAPP_ESPELHO=true): conecta o chip do bot (na 1ª vez abre o WhatsApp Web para escanear o
 * QR code), acha os 4 grupos pelo nome e posta devagar o que já saiu no Telegram. Roda à parte do envio do Telegram;
 * se o WhatsApp não conectar, o Telegram segue normal.
 */
let espelhoWhats = null;
async function iniciarWhatsApp() {
  if (!settings.whatsappEspelho) return;
  try {
    const whats = createSender('wwebjs');
    whatsSender = whats;
    // Servidor sem tela: o código para conectar o chip chega no Telegram do dono.
    whats.aoCodigo = (codigo) =>
      avisos.avisar('whatsapp-codigo', `*Conectar o WhatsApp do bot* 📲\nNo celular do chip: WhatsApp → Aparelhos conectados → Conectar um aparelho → *Conectar com número de telefone* e digite:\n\n*${codigo}*\n\n(o código muda a cada 3 minutos)`, { sempre: true }).catch(() => {});
    log('📲 WhatsApp: conectando o número do bot (na 1ª vez, escaneie o QR code na janela do WhatsApp Web que abrir)...');
    await whats.init();
    espelhoWhats = new EspelhoWhatsApp({ sender: whats, store, carregarGrupos: loadGrupos, avisos, intervaloMin: settings.whatsappIntervaloMin });
    const { ligados, problemas } = await espelhoWhats.ligarGrupos();
    log(`📲 WhatsApp ligado: ${ligados.map((n) => `${n} → "${loadGrupos().find((g) => g.nome === n)?.whatsapp}"`).join(', ') || 'nenhum grupo'} — 1 mensagem a cada ${settings.whatsappIntervaloMin} min.`);
    for (const p of problemas) log(`   ⚠️  WhatsApp — ${p}`);
    if (problemas.length) {
      await avisos.avisar('whatsapp-grupos', `*WhatsApp conectado* 📲\nEsses grupos ficam sem WhatsApp por enquanto:\n${problemas.join('\n')}\nO nome tem que ser igual ao do grupo no WhatsApp (config/grupos.json, campo "whatsapp").`, { sempre: true });
    }
    const convites = await espelhoWhats.convites().catch(() => ({}));
    for (const [nome, link] of Object.entries(convites)) log(`   🔗 Convite do WhatsApp ${nome}: ${link}`);
    espelhoWhats.rodar().catch((e) => registrarErro('whatsapp', e));
    iniciarGruposWhatsApp(whats).catch((e) => {
      registrarErro('grupos-whatsapp', e);
      log(`❌ Grupos do WhatsApp para copiar: ${String(e.message).split('\n')[0]}`);
    });
  } catch (e) {
    registrarErro('whatsapp', e);
    log(`⚠️  WhatsApp não conectou: ${String(e.message).split('\n')[0]} — o Telegram segue normal.`);
    await avisos.avisar('whatsapp', `*WhatsApp não conectou* ⚠️\n${String(e.message).split('\n')[0]}\nReinicie o bot e escaneie o QR code com o chip do bot (WhatsApp > Aparelhos conectados).`).catch(() => {});
  }
}

/**
 * Grupos do Telegram que o dono pediu para copiar (config/fontes.json > gruposTelegram): o bot precisa estar no grupo
 * e com a privacidade desligada no @BotFather. Os grupos em que ele já entrou ficam em data/db.json (gruposFonte).
 */
function ligarGruposFonte(espelho, cfg) {
  const c = cfg.gruposTelegram;
  if (!c || c.ativo === false || !(c.grupos || []).length) return;
  const opcoes = { nichos: loadNichos(), lojasParceiras: awin.ligada() };
  const conhecidos = (store.data.gruposFonte ||= {});
  const ligar = (jid, titulo) => {
    const f = fonteDoGrupoTelegram(c, { jid, titulo }, opcoes);
    if (f) espelho.fontes.set(f.jid, f);
    return f;
  };
  for (const [jid, titulo] of Object.entries(conhecidos)) ligar(jid, titulo);
  const usuario = sender.eu?.username ? `@${sender.eu.username}` : 'o bot';
  sender.aoMudarNoGrupo = async ({ chatId, titulo, dentro }) => {
    if (!dentro) {
      if (!conhecidos[chatId]) return;
      delete conhecidos[chatId];
      espelho.fontes.delete(chatId);
      store.save();
      return avisos.avisar('grupo-fonte', `Saí do grupo "${titulo}" (ou me tiraram): parei de copiar as ofertas de lá.`, { sempre: true });
    }
    const f = ligar(chatId, titulo);
    if (!f) return log(`📋 Entrei no grupo "${titulo}" (${chatId}), que não está em config/fontes.json > gruposTelegram: não copio nada de lá.`);
    conhecidos[chatId] = titulo;
    store.save();
    await avisos.avisar('grupo-fonte', `Entrei no grupo "${titulo}": as ofertas de lá entram em ${f.destinos.map((d) => d.grupo).join(', ')} com as suas regras.`, { sempre: true });
  };
  const nomes = Object.values(conhecidos);
  log(`👥 Grupos do Telegram para copiar: ${nomes.length ? nomes.join(', ') : `nenhum ainda (adicione ${usuario} em: ${c.grupos.map((g) => g.titulo || g).join(', ')})`}.`);
  // Com a privacidade ligada (padrão de todo bot), ele só enxerga comandos dentro de grupos.
  if (sender.eu?.can_read_all_group_messages === false) {
    avisos.avisar('privacidade-bot', `Para eu ler os grupos que você pediu para copiar, desligue a privacidade do bot: no @BotFather mande /setprivacy, escolha ${usuario} e toque em Disable. Depois me adicione no grupo (se eu já estiver lá, me tire e adicione de novo).`);
  }
}

/** Canais públicos do Telegram (config/fontes.json > canaisTelegram): as ofertas de lá entram sozinhas com o link do dono. */
function iniciarCanais() {
  const { cfg } = loadFontes();
  const c = cfg.canaisTelegram || {};
  if (c.ativo === false || !(c.canais || []).length) return;
  const lojasParceiras = c.lojasParceiras !== false && awin.ligada();
  const fontes = fontesDosCanais(c, { destinoPadrao: cfg.destinoPadrao, nichos: loadNichos(), lojasParceiras, amazonTag: process.env.AMAZON_PARTNER_TAG?.trim() });
  if (!fontes.length) return log('📡 Canais do Telegram desligados: falta AMAZON_PARTNER_TAG no .env.');
  const maxPorHora = c.maxPorHora ?? 1;
  const espelho = new Espelho({ sender: new LeitorDeCanais(), store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, maxPorHora }, avisos, awin, shopee, mlApi: new MLApi() });
  const seg = Math.max(60, Number(c.intervaloSegundos) || 180);
  agendarEspelho(espelho, seg);
  const descricao = (f) =>
    `${f.nome} (${f.apenasAmazon ? `${f.mlPeloNome ? 'Amazon e ML (achado pelo nome na API oficial)' : 'só Amazon'}${f.copiarTexto ? '' : ', no formato do bot'}` : `${f.soAmazon ? 'só Amazon' : 'Amazon e ML'}${f.lojasParceiras ? ' + lojas da Awin' : ''}${shopee.ligada() ? ' + Shopee' : ''}`}${f.exigirVendas ? '' : ', sem a regra de vendas'} → ${f.destinos.map((d) => d.grupo).join(', ')})`;
  log(`📡 Canais do Telegram ligados (até ${maxPorHora} por hora em cada grupo; confere a cada ${seg}s): ${fontes.map(descricao).join(' | ')}`);
}

/**
 * Grupos de WhatsApp para copiar (config/fontes.json > gruposWhatsApp; pedido do dono, 29/10/2026): o chip do bot
 * entra pelo convite e só lê. As ofertas passam pelo mesmo espelho dos canais do Telegram.
 */
async function iniciarGruposWhatsApp(whats) {
  const { cfg } = loadFontes();
  const c = cfg.gruposWhatsApp;
  if (!c || c.ativo === false || !(c.grupos || []).length) return;
  const fontes = await ligarGruposWhatsApp(whats, c, {
    nichos: loadNichos(),
    lojasParceiras: c.lojasParceiras !== false && awin.ligada(),
    avisar: (texto) => avisos.avisar('grupo-whatsapp', texto, { sempre: true }),
  });
  if (!fontes.length) return log('👥 Grupos do WhatsApp para copiar: nenhum ligado.');
  const maxPorHora = c.maxPorHora ?? 3;
  const espelho = new Espelho({ sender: whats, store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, maxPorHora }, avisos, awin, shopee, mlApi: new MLApi() });
  const seg = Math.max(60, Number(c.intervaloSegundos) || 60);
  agendarEspelho(espelho, seg);
  log(`👥 Grupos do WhatsApp para copiar (até ${maxPorHora} por hora em cada grupo; confere a cada ${seg}s): ${fontes.map((f) => `"${f.nome}" (${f.apenasAmazon ? `Amazon${f.mlPeloNome ? ' e ML achado pelo nome' : ''}` : 'Amazon, ML e lojas'} → ${f.destinos.map((d) => d.grupo).join(', ')})`).join(' | ')}`);
}

/** Liga o espelho de grupos, se houver grupos-fonte em config/fontes.json. */
async function iniciarEspelho() {
  const { ativo, fontes, cfg } = loadFontes();
  if (ativo && sender.tipo === 'telegram') return iniciarCaixaDeEntrada(cfg);
  if (!ativo || !fontes.length) return log('🪞 Espelho desligado (nenhum grupo-fonte em config/fontes.json).');
  if (typeof sender.lerMensagens !== 'function') return log('🪞 Espelho só funciona com SENDER=wwebjs.');
  try {
    const { ok, problemas } = resolverFontes(fontes, await sender.listGroups());
    for (const p of problemas) log(`⚠️  Espelho — fonte ${p}`);
    const meus = new Set(loadGrupos().map((g) => g.jid));
    const validas = ok.filter((f) => {
      if (meus.has(f.jid)) log(`⚠️  Espelho — "${f.nomeWhats}" é o seu próprio grupo de envio; ignorado como fonte.`);
      return !meus.has(f.jid);
    });
    if (!validas.length) return log('🪞 Espelho desligado: nenhum grupo-fonte válido.');
    const espelho = new Espelho({ sender, store, affiliate: new MLAffiliate(), fontes: validas, grupos: loadGrupos(), cfg, avisos });
    const seg = Math.max(30, Number(cfg.intervaloSegundos) || 60);
    agendarEspelho(espelho, seg);
    log(`🪞 Espelho ligado: ${validas.map((f) => `"${f.nomeWhats}"`).join(', ')} — confere a cada ${seg}s.`);
  } catch (e) {
    registrarErro('espelho', e);
    log(`❌ Não consegui ligar o espelho: ${String(e.message).split('\n')[0]}`);
  }
}

/**
 * Reinício com calma (`npm run reiniciar`, pela porta da trava): não começa tarefa nova, espera o envio/coleta em
 * andamento (até 90 s), grava a fila e sai deixando o aviso data/.reiniciar — o 3-iniciar.bat vê o aviso e liga o
 * bot de novo na mesma janela, já com o que foi para o GitHub.
 */
let aoPedirParada = () => {};
async function reiniciarComCalma(sair, { religar = true } = {}) {
  if (parando) return;
  parando = true;
  log(religar ? '🔁 Reinício pedido: termino o que estiver fazendo e ligo de novo.' : '⏹️  Desligamento pedido (mudança para o servidor): termino o que estiver fazendo e desligo.');
  for (let i = 0; i < 90 && ocupado; i++) await sleep(1000);
  if (religar) {
    try {
      fs.writeFileSync(path.join(DATA_DIR, '.reiniciar'), new Date().toISOString());
    } catch {}
  }
  await sair(religar ? 'reinício pedido' : 'desligado para a mudança');
}

async function main() {
  const trava = await travarInstancia({ aoPedirParada: () => aoPedirParada() });
  if (!trava.ok) {
    log(`❌ ${MSG_OUTRA_COPIA}`);
    process.exit(1);
  }
  if (trava.semTrava) log(`⚠️  Não consegui usar a trava de cópia única (${trava.semTrava}). Cuidado para não abrir o bot duas vezes.`);
  // A porta não pega um bot congelado que segura a trava sem responder (27/10/2026): confere também os processos.
  const outros = await outrosBots();
  if (outros.length) {
    log(`❌ ${MSG_BOT_TRAVADO(outros)}`);
    process.exit(1);
  }
  desligarEdicaoRapida();
  store = new Store();
  sender = createSender();
  avisos = new Avisos({ sender, store });
  // Logo no começo: a partida (listar chats, coleta inicial) pode levar minutos, e um Ctrl+C nela não pode sumir sem rastro.
  // Fechar a janela do cmd chega como SIGHUP (o Windows dá uns 10 s antes de matar). Grava a fila antes de sair:
  // o Ctrl+C pode cair no meio de uma coleta (um envio em andamento já está gravado como ENVIANDO).
  let saindo = false;
  const sair = async (sinal) => {
    if (saindo) return;
    saindo = true;
    log(`Encerrando (${sinal === 'SIGHUP' ? 'janela fechada' : sinal === 'SIGINT' ? 'Ctrl+C' : sinal})...`);
    try {
      store?.save();
    } catch (e) {
      log(`⚠️  Não consegui gravar a fila ao sair: ${String(e.message).split('\n')[0]}`);
    }
    await sender?.close();
    await Promise.race([whatsSender?.close?.(), sleep(15_000)]).catch(() => {}); // fecha o WhatsApp Web direito
    process.exit(0);
  };
  for (const sinal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sinal, sair);
  aoPedirParada = (op) => reiniciarComCalma(sair, op).catch((e) => registrarErro('reiniciar', e));
  log(`🚀 ml-afiliados iniciando (envio via "${settings.sender}")`);
  // Envio que ficou pela metade quando o bot parou: pode ter saído — vira INCERTO e entra no histórico (antes de limpar).
  const incertos = store.recuperarEnvios();
  if (incertos.length) {
    store.save();
    log(`⚠️  ${incertos.length} oferta(s) estavam sendo enviadas quando o bot parou: podem ter saído, não vou repetir.`);
  }
  // Resumo dos dias que ficaram sem o arquivo fechado (o PC desliga às 22h): ANTES de descartar a fila de ontem,
  // que diz quanto sobrou no fim do dia.
  analytics('pôr em dia', () => {
    const gerados = porEmDia({ store, membrosDoDia: (dia) => membrosDoDia(dia) });
    if (gerados.length) log(`📊 Resumo guardado dos dias: ${gerados.join(', ')}`);
  });
  // Ligou num dia novo (o PC ficou desligado e a limpeza da meia-noite não rodou): a fila de ontem já venceu.
  // Fica antes de tudo: a caixa de entrada e o espelho, que ligam depois, já podem pôr ofertas de hoje na fila.
  if (filaDeOutroDia(store)) {
    log('🌅 A fila é de outro dia (o bot ficou desligado): descartando e buscando ofertas novas.');
    limpar(store);
  }
  const reabertas = store.reabrirErros();
  if (reabertas) {
    store.save();
    log(`♻️  ${reabertas} oferta(s) que tinham falhado no envio voltaram para a fila.`);
  }
  // O PC liga antes da internet: sem resposta do Telegram, tenta de novo a cada 30 s (até 30 min) em vez de
  // desistir — em 21/10/2026 o bot ficou parado das 10h33 às 11h26 por isso. Erro claro (token errado) para na hora.
  for (let tentativa = 1; ; tentativa++) {
    try {
      await sender.init();
      break;
    } catch (e) {
      if (!e.incerto || tentativa >= 60) throw e;
      if (tentativa === 1) log(`🌐 Sem internet ainda (${String(e.message).split('\n')[0]}) — tentando de novo a cada 30 s.`);
      await sleep(30_000);
    }
  }
  if (sender.tipo === 'telegram') {
    // Mostra no log os chats que o bot enxerga (para preencher "telegram" em config/grupos.json).
    try {
      const chats = await sender.listGroups();
      log(`📋 Chats do Telegram que o bot vê: ${chats.length ? chats.map((c) => `${c.nome} [${c.tipo}] = ${c.jid}`).join(' | ') : 'nenhum ainda (poste algo no canal e mande /start no privado do bot)'}`);
    } catch (e) {
      log(`⚠️  Não consegui listar os chats do Telegram: ${String(e.message).split('\n')[0]}`);
    }
  }
  await avisos.iniciar();

  const opts = { timezone: settings.tz };
  cron.schedule(settings.cron.coleta, cicloColeta, opts);
  cron.schedule(settings.cron.envio, exclusivo('envio', () => enviarParaTodos(sender, store, avisos)), opts);
  cron.schedule(
    settings.cron.limpeza,
    exclusivo('limpeza', async () => {
      analytics('fim do dia', () => gerarDia(diaLocal(new Date(Date.now() - 60_000), settings.tz), { store })); // o dia que acabou, antes de esvaziar a fila
      espelhoWhats?.podar();
      limpar(store);
    }),
    opts
  );
  // O PC desliga às 22h: o resumo fechado de hoje sai ao ligar no dia seguinte (porEmDia).
  // Membros de cada canal e o resumo parcial de hoje (21h55). Fora do "exclusivo": não mexem na fila.
  // Membros: 12h30 e 21h50, e ao ligar (o PC pode estar desligado num desses horários); fica a última leitura do dia.
  const contarMembros = () => registrarMembros({ sender, grupos: loadGrupos() }).catch((e) => registrarErro('analytics-membros', e));
  cron.schedule('30 12 * * *', contarMembros, opts);
  cron.schedule('50 21 * * *', contarMembros, opts);
  // Relatório da Awin (cliques, vendas, comissão pendente x aprovada): ao ligar, 12h30 e 21h52; só leitura, pela fila
  // de 20 chamadas/min (cada rodada busca hoje e ontem e preenche os dias que faltam).
  const relatorioAwin = () => registrarAwin({ awin }).catch((e) => registrarErro('analytics-awin', e));
  cron.schedule('30 12 * * *', relatorioAwin, opts);
  cron.schedule('52 21 * * *', relatorioAwin, opts);
  setTimeout(relatorioAwin, 2 * 60_000).unref(); // ao ligar, depois da coleta inicial começar (o PC pode dormir às 21h52)
  contarMembros();
  cron.schedule(
    '55 21 * * *',
    () => analytics('hoje', () => {
      const hoje = diaLocal(new Date(), settings.tz);
      gerarDia(hoje, { store, parcial: true, membros: membrosDoDia(hoje) });
    }),
    opts
  );
  // O resumo não usa o "exclusivo": só lê a fila, pode sair mesmo com uma coleta em andamento.
  // O resumo ganha os destaques do analytics; se o analytics falhar, o resumo sai sem eles.
  const urlPainel = () => process.env.PAINEL_URL?.trim() || analytics('url', () => urlPublicada()) || null;
  cron.schedule(
    settings.avisos.resumoCron,
    () => {
      const destaques = analytics('destaques', () => destaquesDoDia(montarPainel({ store, periodos: ['hoje', '7d'] }), { url: urlPainel() })) || [];
      return avisos.resumoDiario(loadGrupos(), destaques).catch((e) => registrarErro('resumo', e));
    },
    opts
  );
  // Painel (data/analytics/site) gerado e publicado no Cloudflare só com a trava do Access confirmada.
  // Fora do "exclusivo"; o wrangler tem 3 min no máximo; pula quando nada mudou.
  let publicando = false;
  const atualizarPainel = async () => {
    if (publicando) return;
    publicando = true;
    try {
      const hash = analytics('painel', () => gravarSite(montarPainel({ store })));
      if (hash) await publicarPainel({ hash, avisos });
    } catch (e) {
      registrarErro('analytics-publicar', e);
    } finally {
      publicando = false;
    }
  };
  for (const quando of ['5 8 * * *', '30 12 * * *', '30 17 * * *', '57 21 * * *']) cron.schedule(quando, atualizarPainel, opts);
  // Resumo da semana, toda segunda às 9h (só para o dono).
  cron.schedule(
    '0 9 * * 1',
    () => {
      const texto = analytics('semanal', () => resumoSemanal(montarPainel({ store, periodos: ['7d'] }), { url: urlPainel() }));
      if (texto) return avisos.avisar('semanal', texto, { sempre: true }).catch((e) => registrarErro('semanal', e));
    },
    opts
  );
  log(`⏰ Coleta: "${settings.cron.coleta}" | Envio: "${settings.cron.envio}" | Limpeza: "${settings.cron.limpeza}" | Resumo: "${settings.avisos.resumoCron}"`);
  await avisos.ligado({ grupos: loadGrupos() });
  await avisos.aoReligar({ incertos, recuperacao: store.recuperacao });
  iniciarHeartbeat();

  iniciarCanais();
  await iniciarEspelho();
  iniciarWhatsApp(); // sem await: esperar o QR code não pode segurar o resto

  // Ao ligar: grupo com busca própria e fila vazia já ganha uma busca (o PC pode ter perdido o horário da coleta).
  // Durante o dia, a cada 10 min, a mesma conferência (no máximo uma busca extra a cada REPOSICAO_MIN minutos).
  await reporSePreciso('ao ligar');
  cron.schedule('*/10 8-21 * * *', () => reporSePreciso('fila vazia').catch((e) => registrarErro('reposicao', e)), opts);
}

main().catch((e) => {
  registrarErro('iniciar', e);
  log('❌ Falha ao iniciar:', e.message);
  if (e.incerto) religar(); // sem internet: tenta de novo daqui a 1 min (erro claro, como token errado, para)
  process.exit(1);
});
