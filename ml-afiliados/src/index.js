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
import { LeitorDeCanais, fontesDosCanais } from './telegram-canais.js';
import { MLAffiliate } from './ml/affiliate.js';
import { coletar, filaDeOutroDia, gerarLinks, enviarParaTodos, limpar } from './pipeline.js';
import { createSender } from './senders.js';
import { Store } from './store.js';
import { diaLocal, log, sleep } from './util.js';

import { instalarLogEmArquivo, registrarErro } from './logfile.js';
import { gerarDia, porEmDia } from './analytics/dia.js';
import { membrosDoDia, registrarMembros } from './analytics/membros.js';
import { registrarAwin } from './analytics/ganhos.js';
import { montarPainel } from './analytics/relatorio.js';
import { destaquesDoDia, resumoSemanal } from './analytics/destaques.js';
import { gravarSite } from './analytics/pagina.js';
import { publicarPainel, urlPublicada } from './analytics/publicar.js';
import { MSG_OUTRA_COPIA, travarInstancia } from './instancia.js';
import { EspelhoWhatsApp } from './whatsapp-espelho.js';

instalarLogEmArquivo('iniciar');

// Criados no main(), DEPOIS da trava de cópia única: uma 2ª cópia não pode nem abrir o db.json.
let store;
let sender;
let avisos;
let ocupado = false;
let parando = false; // reinício pedido: nenhuma tarefa nova começa
let whatsSender = null;

/** Evita que duas tarefas rodem ao mesmo tempo (ex.: coleta demorada + envio). */
const exclusivo = (nome, fn) => async () => {
  if (parando) return;
  if (ocupado) return log(`⏭️  ${nome}: outra tarefa em andamento, pulando.`);
  ocupado = true;
  try {
    await fn();
  } catch (e) {
    registrarErro(nome, e);
    log(`❌ ${nome}: ${e.message}`);
    await avisos.erroTarefa(nome, e);
  } finally {
    ocupado = false;
  }
};

const cicloColeta = exclusivo('coleta', async () => {
  const reabertas = store.reabrirErros(); // falhas com recusa clara voltam para a fila (até 3 tentativas)
  if (reabertas) log(`♻️  ${reabertas} oferta(s) que tinham falhado no envio voltaram para a fila.`);
  const r = await coletar(store);
  if (!r.encontrados) await avisos.coletaVazia();
  if (r.amazonErro) await avisos.avisar('amazon', `*Amazon fora do ar no bot* ⚠️\n${r.amazonErro}`);
  if (r.awinErro) await avisos.avisar('awin', `*Awin fora do ar no bot* ⚠️\n${r.awinErro}`);
  await gerarLinks(store);
});

/**
 * Busca de reposição (pedido do dono, 15/10/2026: "acabaram as ofertas do Beleza e do Fitness"): grupo que tem
 * busca própria (categorias do ML ou Shopee) e ficou sem nada na fila ganha uma busca extra — no máximo uma a cada
 * REPOSICAO_MIN minutos, para não forçar o Mercado Livre. Vale também ao ligar (o PC pode ter perdido o horário).
 */
const REPOSICAO_MIN = 120;
function gruposSemFila() {
  const shopee = loadShopee();
  const comBusca = new Set([
    ...loadCategorias().filter((c) => c.ativo).map((c) => c.grupo),
    ...(shopee.ativo === false ? [] : Object.entries(shopee.grupos || {}).filter(([, g]) => g.ativo !== false).map(([n]) => n)),
  ]);
  const ativos = loadGrupos().filter((g) => g.ativo && comBusca.has(g.nome)).map((g) => g.nome);
  return ativos.filter((nome) => !store.list((p) => p.grupo === nome && (p.status === 'PRONTO' || p.status === 'PENDENTE')).length);
}
async function reporSePreciso(quando) {
  const vazios = gruposSemFila();
  const ultima = Date.parse(store.data.ultimaColeta || 0) || 0;
  if (!vazios.length || Date.now() - ultima < REPOSICAO_MIN * 60_000) return;
  log(`🔁 Busca de reposição (${quando}): sem ofertas na fila de ${vazios.join(', ')}.`);
  await cicloColeta();
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
  const destino = cfg.destinoPadrao || 'Geral';
  const fontes = [{ nome: 'Caixa de entrada', nomeWhats: 'Caixa de entrada', jid: dono, destino, manual: true }];
  sender.aoVirarAdmin = (canal) => ligarCanalNovo(canal).catch((e) => registrarErro('canal-novo', e));
  agendarEspelho(new Espelho({ sender, store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, janelaMinutos: 180 }, avisos, awin, shopee }), 10);
  log(`📥 Caixa de entrada ligada: mande um link da Amazon, do Mercado Livre${shopee.ligada() ? ', da Shopee' : ''}${awin.ligada() ? ' ou de loja parceira da Awin' : ''} no privado do bot que ele entra na fila do grupo "${destino}".`);
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
  } catch (e) {
    registrarErro('whatsapp', e);
    log(`⚠️  WhatsApp não conectou: ${String(e.message).split('\n')[0]} — o Telegram segue normal.`);
    await avisos.avisar('whatsapp', `*WhatsApp não conectou* ⚠️\n${String(e.message).split('\n')[0]}\nReinicie o bot e escaneie o QR code com o chip do bot (WhatsApp > Aparelhos conectados).`).catch(() => {});
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
  const espelho = new Espelho({ sender: new LeitorDeCanais(), store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, maxPorHora }, avisos, awin, shopee });
  const seg = Math.max(60, Number(c.intervaloSegundos) || 180);
  agendarEspelho(espelho, seg);
  const descricao = (f) =>
    `${f.nome} (${f.apenasAmazon ? `só Amazon${f.copiarTexto ? '' : ', no formato do bot'}` : `${f.soAmazon ? 'só Amazon' : 'Amazon e ML'}${f.lojasParceiras ? ' + lojas da Awin' : ''}${shopee.ligada() ? ' + Shopee' : ''}`}${f.exigirVendas ? '' : ', sem a regra de vendas'} → ${f.destinos.map((d) => d.grupo).join(', ')})`;
  log(`📡 Canais do Telegram ligados (até ${maxPorHora} por hora em cada grupo; confere a cada ${seg}s): ${fontes.map(descricao).join(' | ')}`);
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
async function reiniciarComCalma(sair) {
  if (parando) return;
  parando = true;
  log('🔁 Reinício pedido: termino o que estiver fazendo e ligo de novo.');
  for (let i = 0; i < 90 && ocupado; i++) await sleep(1000);
  try {
    fs.writeFileSync(path.join(DATA_DIR, '.reiniciar'), new Date().toISOString());
  } catch {}
  await sair('reinício pedido');
}

async function main() {
  const trava = await travarInstancia({ aoPedirParada: () => aoPedirParada() });
  if (!trava.ok) {
    log(`❌ ${MSG_OUTRA_COPIA}`);
    process.exit(1);
  }
  if (trava.semTrava) log(`⚠️  Não consegui usar a trava de cópia única (${trava.semTrava}). Cuidado para não abrir o bot duas vezes.`);
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
  aoPedirParada = () => reiniciarComCalma(sair).catch((e) => registrarErro('reiniciar', e));
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
  await sender.init();
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
  process.exit(1);
});
