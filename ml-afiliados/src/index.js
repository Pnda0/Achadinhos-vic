/**
 * Modo automático (npm start): faz o papel dos gatilhos agendados do n8n.
 *   CRON_COLETA  -> coleta ofertas e já gera os links
 *   CRON_ENVIO   -> envia 1 oferta por grupo (padrão do código: a cada 8 min das 8h às 21h59; no PC de casa o .env usa 5 min)
 *   CRON_LIMPEZA -> esvazia a fila à meia-noite
 *   CRON_RESUMO  -> manda o resumo do dia no WhatsApp do dono (AVISOS_DESTINO)
 */
import cron from 'node-cron';
import { loadFontes, loadGrupos, loadNichos, settings, vincularCanal } from './config.js';
import { Avisos } from './avisos.js';
import { Awin } from './awin.js';
import { grupoDoTitulo } from './telegram.js';
import { iniciarHeartbeat } from './heartbeat.js';
import { Espelho, resolverFontes } from './espelho.js';
import { LeitorDeCanais, jidDoCanal } from './telegram-canais.js';
import { MLAffiliate } from './ml/affiliate.js';
import { coletar, filaDeOutroDia, gerarLinks, enviarParaTodos, limpar } from './pipeline.js';
import { createSender } from './senders.js';
import { Store } from './store.js';
import { log } from './util.js';
import { instalarLogEmArquivo, registrarErro } from './logfile.js';

instalarLogEmArquivo('iniciar');

const store = new Store();
const sender = createSender();
const avisos = new Avisos({ sender, store });
let ocupado = false;

/** Evita que duas tarefas rodem ao mesmo tempo (ex.: coleta demorada + envio). */
const exclusivo = (nome, fn) => async () => {
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
  const r = await coletar(store);
  if (!r.encontrados) await avisos.coletaVazia();
  if (r.amazonErro) await avisos.avisar('amazon', `*Amazon fora do ar no bot* ⚠️\n${r.amazonErro}`);
  if (r.awinErro) await avisos.avisar('awin', `*Awin fora do ar no bot* ⚠️\n${r.awinErro}`);
  await gerarLinks(store);
});

// Lojas parceiras da Awin: uma instância só, para a lista de lojas aprovadas ficar em memória.
const awin = new Awin();

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
  agendarEspelho(new Espelho({ sender, store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, janelaMinutos: 180 }, avisos, awin }), 10);
  log(`📥 Caixa de entrada ligada: mande um link da Amazon, do Mercado Livre${awin.ligada() ? ' ou de loja parceira da Awin' : ''} no privado do bot que ele entra na fila do grupo "${destino}".`);
}

/** Canais públicos do Telegram (config/fontes.json > canaisTelegram): as ofertas de lá entram sozinhas com o link do dono. */
function iniciarCanais() {
  const { cfg } = loadFontes();
  const c = cfg.canaisTelegram || {};
  const canais = (c.canais || []).filter(Boolean);
  if (c.ativo === false || !canais.length) return;
  const destino = c.destino || cfg.destinoPadrao || 'Geral';
  const soAmazon = c.soAmazon !== false;
  const lojasParceiras = c.lojasParceiras !== false && awin.ligada();
  if (soAmazon && !lojasParceiras && !process.env.AMAZON_PARTNER_TAG?.trim()) return log('📡 Canais do Telegram desligados: falta AMAZON_PARTNER_TAG no .env.');
  // Cada destino pode ter um nicho: a oferta só entra naquele grupo se o nome casar com as palavras dele.
  const nichos = loadNichos();
  const destinos = (c.destinos?.length ? c.destinos : [{ grupo: destino }]).map((d) => ({ grupo: d.grupo, palavras: d.nicho ? nichos[d.nicho]?.obrigatorias || [] : null }));
  const fontes = canais.map((n) => {
    const nome = `@${jidDoCanal(n).slice('canal:'.length)}`;
    return { nome, nomeWhats: nome, jid: jidDoCanal(n), destino, destinos, soAmazon, lojasParceiras };
  });
  const maxPorHora = c.maxPorHora ?? 1;
  const espelho = new Espelho({ sender: new LeitorDeCanais(), store, affiliate: new MLAffiliate(), fontes, grupos: loadGrupos(), carregarGrupos: loadGrupos, cfg: { ...cfg, maxPorHora }, avisos, awin });
  const seg = Math.max(60, Number(c.intervaloSegundos) || 180);
  agendarEspelho(espelho, seg);
  log(`📡 Canais do Telegram ligados (${soAmazon ? 'só Amazon' : 'Amazon e ML'}${lojasParceiras ? ' + lojas da Awin' : ''}, até ${maxPorHora} por hora em cada grupo) → ${destinos.map((d) => d.grupo).join(', ')}: ${fontes.map((f) => f.nome).join(', ')} — confere a cada ${seg}s.`);
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

async function main() {
  log(`🚀 ml-afiliados iniciando (envio via "${settings.sender}")`);
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
  cron.schedule(settings.cron.limpeza, exclusivo('limpeza', async () => limpar(store)), opts);
  // O resumo não usa o "exclusivo": só lê a fila, pode sair mesmo com uma coleta em andamento.
  cron.schedule(settings.avisos.resumoCron, () => avisos.resumoDiario(loadGrupos()).catch((e) => registrarErro('resumo', e)), opts);
  log(`⏰ Coleta: "${settings.cron.coleta}" | Envio: "${settings.cron.envio}" | Limpeza: "${settings.cron.limpeza}" | Resumo: "${settings.avisos.resumoCron}"`);
  await avisos.ligado({ grupos: loadGrupos() });
  iniciarHeartbeat();

  iniciarCanais();
  await iniciarEspelho();

  // Se não há nada na fila dos grupos ATIVOS ao ligar, já faz uma coleta.
  const ativos = new Set(loadGrupos().filter((g) => g.ativo).map((g) => g.nome));
  if (!store.list((p) => ativos.has(p.grupo) && (p.status === 'PRONTO' || p.status === 'PENDENTE')).length) await cicloColeta();

  const sair = async () => {
    log('Encerrando...');
    await sender.close();
    process.exit(0);
  };
  process.on('SIGINT', sair);
  process.on('SIGTERM', sair);
}

main().catch((e) => {
  registrarErro('iniciar', e);
  log('❌ Falha ao iniciar:', e.message);
  process.exit(1);
});
