/**
 * As 3 etapas do curso, agora em código:
 *   coletar()      -> "BUSCA DE PRODUTOS MERCADO LIVRE" (lê as categorias ativas e guarda os produtos)
 *   gerarLinks()   -> "GERA LINKS DE AFILIADOS" (lotes de 20 com pausa entre eles)
 *   enviarProximo()-> "ENVIAR PRODUTOS PARA O GRUPO" (título + legenda + imagem + digitando...)
 */
import { loadCategorias, loadGrupos, settings } from './config.js';
import { scrapeCategoria } from './ml/scraper.js';
import { MLAffiliate } from './ml/affiliate.js';
import { buscarOfertasAmazon } from './amazon.js';
import { buscarCuponsAwin, loadAwin } from './awin.js';
import { VENDAS_MINIMAS, motivoVendas } from './ml/vendas.js';
import { evento, origemDe } from './eventos.js';
import { BrowserSession, sessaoNavegador } from './browser.js';
import { estiloDoProduto, gerarTitulo, montarLegenda, tituloCupom } from './caption.js';
import { Store } from './store.js';
import { casaTermo, chunk, diaLocal, log, normalizar, randomDelay, shuffle, sleep } from './util.js';

/** Aplica os filtros do grupo. Retorna o motivo da recusa ou null se passou. */
export function motivoRecusa(p, f, store, { descontoDesconhecidoPassa = false, exigirVendas = true } = {}) {
  const nome = normalizar(p.nome);
  const semDesconto = p.descontoPct === null || p.descontoPct === undefined;
  // Nicho: o nome precisa casar com pelo menos uma das palavras obrigatórias (ex.: fitness).
  if (f.palavrasObrigatorias?.length && !f.palavrasObrigatorias.some((t) => casaTermo(nome, t))) return 'fora do nicho';
  if ((f.palavrasBloqueadas || []).some((w) => casaTermo(nome, w))) return 'palavra bloqueada';
  // Mercado Livre: só com MAIS de N vendas confirmadas pelo rótulo do card (src/ml/vendas.js). A caixa de entrada
  // do dono (escolha manual dele) passa `exigirVendas: false`.
  const vendas = exigirVendas && motivoVendas(p, f.vendasMinimas ?? VENDAS_MINIMAS);
  if (vendas) return vendas;
  if (f.descontoMinimo && !(semDesconto && descontoDesconhecidoPassa) && (p.descontoPct || 0) < f.descontoMinimo) return 'desconto baixo';
  if (f.precoMinimo && p.precoAtual != null && p.precoAtual < f.precoMinimo) return 'preço baixo';
  if (f.precoMaximo && p.precoAtual != null && p.precoAtual > f.precoMaximo) return 'preço alto';
  if (f.notaMinima && p.nota !== null && p.nota !== undefined && p.nota < f.notaMinima) return 'nota baixa';
  if (store && f.diasSemRepetir && store.enviadoRecentemente(p.id, p.grupo, f.diasSemRepetir)) return 'enviado recentemente';
  // Mesmo produto anunciado com outro id (outro vendedor/anúncio, ou título igual em outra loja): conta como repetido.
  if (store && f.diasSemRepetir && store.nomeRecente(p, f.diasSemRepetir)) return 'enviado recentemente';
  if (store && store.duplicadoNaFila(p)) return 'duplicado na fila';
  return null;
}

/**
 * O link de afiliado pode ir para o grupo? Devolve o motivo se não puder. Confere só o formato — o link
 * vem da API oficial de cada programa; abrir o link aqui contaria cliques falsos para a conta de afiliado.
 */
export function motivoLinkInvalido(p) {
  let u;
  try {
    u = new URL(p.linkAfiliado);
  } catch {
    return 'link inválido';
  }
  if (u.protocol !== 'https:') return 'link inválido';
  const host = u.hostname.toLowerCase();
  if (p.loja === 'amazon') return /(^|\.)amazon\.com\.br$/.test(host) && u.searchParams.get('tag') ? null : 'link da Amazon sem etiqueta';
  if (p.loja === 'awin') {
    if (host === 'tidd.ly' && u.pathname.length > 1) return null;
    return /(^|\.)awin1\.com$/.test(host) && u.searchParams.get('awinaffid') ? null : 'link da Awin sem id de afiliado';
  }
  if (host === 'meli.la' && /^\/\w+$/.test(u.pathname)) return null;
  return /(^|\.)mercadoli[vb]re\.com(\.br)?$/.test(host) && u.searchParams.get('matt_word') ? null : 'link do ML sem afiliado';
}

export async function coletar(store = new Store(), { amazon = buscarOfertasAmazon, awin = buscarCuponsAwin, categoriasML = null, raspar = scrapeCategoria, esperar = randomDelay } = {}) {
  const lista = loadGrupos();
  const grupos = Object.fromEntries(lista.map((g) => [g.nome, g]));
  const emEspera = lista.filter((g) => g.emEspera).map((g) => g.nome);
  if (emEspera.length) log(`⏸️  Em espera (ligado, mas sem canal): ${emEspera.join(', ')} — nada é buscado para ele(s).`);
  const categorias = shuffle((categoriasML ?? loadCategorias()).filter((c) => c.ativo && grupos[c.grupo]?.ativo !== false));
  log(`🔎 Coletando ${categorias.length} categoria(s) ativa(s)...`);
  let novos = 0;
  let encontrados = 0;
  const recusas = {};
  const porCategoria = {};
  const paginas = new Map(); // a mesma página de ofertas serve a mais de um grupo: baixa uma vez só
  for (const cat of categorias) {
    const grupo = grupos[cat.grupo];
    if (!grupo) {
      log(`  ⚠️  Categoria "${cat.nome}" aponta para o grupo "${cat.grupo}", que não existe em grupos.json`);
      continue;
    }
    const c = (porCategoria[cat.nome] ??= { encontrados: 0, aceitos: 0 });
    const antes = c.encontrados;
    const chave = `${cat.url}|${cat.paginas || 1}`;
    const jaBaixada = paginas.has(chave);
    if (!jaBaixada) paginas.set(chave, await raspar(cat));
    else log(`  ${cat.nome} (${cat.grupo}): reaproveitando a página já baixada.`);
    for (const bruto of paginas.get(chave)) {
      const p = { ...bruto, grupo: cat.grupo, categoria: cat.nome };
      c.encontrados++;
      const motivo = motivoRecusa(p, grupo.filtros, store);
      if (motivo) {
        recusas[motivo] = (recusas[motivo] || 0) + 1;
        evento('recusado', p, motivo);
        continue;
      }
      c.aceitos++;
      if (store.upsert(p)) {
        novos++;
        evento('na_fila', p);
      }
    }
    encontrados += c.encontrados - antes;
    store.save();
    if (!jaBaixada) await esperar(5, 15); // pausa entre categorias (Wait1 do curso)
  }
  await sessaoNavegador.close();

  // Amazon (API oficial). Só roda com config/amazon.json ativo e credenciais no .env.
  let amazonErro = null;
  try {
    const az = await amazon(undefined, undefined, { gruposAtivos: new Set(lista.filter((g) => g.ativo).map((g) => g.nome)) });
    if (az.motivo) {
      if (!/desligada/.test(az.motivo)) log(`🛒 Amazon: ${az.motivo}`);
    } else {
      log(`🛒 Amazon: ${az.produtos.length} oferta(s) encontrada(s).`);
    }
    for (const [nome, c] of Object.entries(az.categorias || {})) porCategoria[nome] = c;
    for (const p of az.produtos || []) {
      encontrados++;
      const grupo = grupos[p.grupo];
      if (!grupo?.ativo) continue;
      const motivo = motivoRecusa(p, grupo.filtros, store);
      if (motivo) {
        recusas[motivo] = (recusas[motivo] || 0) + 1;
        evento('recusado', p, motivo);
        continue;
      }
      if (porCategoria[p.categoria]) porCategoria[p.categoria].aceitos++;
      if (store.upsert(p)) {
        novos++;
        evento('na_fila', p);
      }
    }
  } catch (e) {
    amazonErro = String(e.message).split('\n')[0];
    log(`❌ Amazon: ${amazonErro}`);
  }

  // Awin (API oficial): cupons e promoções das lojas em que a conta foi aprovada. Já vêm com o link de afiliado.
  let awinErro = null;
  try {
    const dias = loadAwin().cupons.diasSemRepetir || 7;
    const aw = await awin({ grupos: lista, jaTem: (p) => store.conhecido(p.id, p.grupo) || store.enviadoRecentemente(p.id, p.grupo, dias) });
    if (aw.motivo) {
      if (!/desligada|falta AWIN/.test(aw.motivo)) log(`🎟️ Awin: ${aw.motivo}`);
    } else {
      log(`🎟️ Awin: ${aw.produtos.length} cupom(ns)/promoção(ões) novo(s) para os grupos.`);
    }
    for (const [nome, c] of Object.entries(aw.categorias || {})) porCategoria[nome] = c;
    for (const p of aw.produtos || []) {
      encontrados++;
      const c = Object.values(aw.categorias || {})[0];
      if (c) c.aceitos++;
      if (store.upsert(p)) {
        novos++;
        evento('na_fila', p);
      }
    }
  } catch (e) {
    awinErro = String(e.message).split('\n')[0];
    log(`❌ Awin: ${awinErro}`);
  }

  log(`✅ Coleta: ${encontrados} visto(s), ${novos} novo(s). Recusados: ${JSON.stringify(recusas)}`);
  log(`   Por categoria (vistos → aprovados): ${Object.entries(porCategoria).map(([n, x]) => `${n} ${x.encontrados}→${x.aceitos}`).join(' | ')}`);
  const resultado = { encontrados, novos, recusas, categorias: porCategoria, amazonErro, awinErro };
  store.registrarColeta(resultado);
  store.save();
  return resultado;
}

/**
 * Gera os links de afiliado dos produtos PENDENTES.
 * 1ª tentativa: HTTP direto com os cookies (igual ao curso). Plano B: pelo navegador do bot,
 * que continua logado no perfil data/perfil-ml (criado pelo "npm run login-ml").
 */
export async function gerarLinks(
  store = new Store(),
  affiliate = new MLAffiliate(),
  { navegador = sessaoNavegador, temNavegador = BrowserSession.disponivel() } = {}
) {
  const pendentes = store.pendentesDeLink();
  if (!pendentes.length) {
    log('🔗 Nenhum produto aguardando link.');
    return 0;
  }
  if (!affiliate.tag) throw new Error('Configure ML_AFFILIATE_TAG no .env (sua etiqueta de afiliado).');
  log(`🔗 Gerando links de afiliado para ${pendentes.length} produto(s)...`);

  let viaNavegador = false;
  const trocarParaNavegador = (e) => {
    if (viaNavegador || !temNavegador) throw e;
    viaNavegador = true;
    log(`  ↪ ${e.message} — usando o navegador do bot...`);
  };
  try {
    await affiliate.refresh();
  } catch (e) {
    trocarParaNavegador(e);
  }

  const urls = [...new Set(pendentes.map((p) => p.url))];
  let ok = 0;
  try {
    const lotes = chunk(urls, 20);
    for (const [i, lote] of lotes.entries()) {
      let mapa;
      try {
        mapa = viaNavegador ? await navegador.createLinks(lote, affiliate.tag) : await affiliate.createLinks(lote);
      } catch (e) {
        trocarParaNavegador(e);
        mapa = await navegador.createLinks(lote, affiliate.tag);
      }
      for (const [orig, link] of mapa) ok += store.setLink(orig, link);
      for (const u of lote) {
        if (!mapa.has(u)) {
          for (const p of store.list((x) => x.url === u)) {
            store.setStatus(p, 'ERRO', { erro: 'sem link na resposta' });
            evento('sem_link', p, 'o ML não devolveu link de afiliado');
          }
        }
      }
      store.save();
      if (i < lotes.length - 1) await randomDelay(10, 20); // WAIT de 15s do curso entre os lotes
    }
  } finally {
    store.save();
    await navegador.close();
  }
  log(`✅ ${ok} link(s) gerado(s)${viaNavegador ? ' (via navegador)' : ''}.`);
  return ok;
}

/** Simula humano digitando (workflow "SIMULAR HUMANO DIGITANDO"): 1 a 3 rodadas de até 5,5s. */
async function simularDigitando(sender, jid) {
  try {
    const rodadas = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < rodadas; i++) {
      await sender.typing(jid, 1 + Math.random() * 4.5);
      await sleep(500 + Math.random() * 1500);
    }
  } catch (e) {
    // "digitando..." é só enfeite: se falhar, a oferta é enviada do mesmo jeito.
    log(`  (não consegui mostrar "digitando...": ${String(e.message).split('\n')[0]})`);
  }
}

/**
 * A regra de vendas vale de novo na hora de postar: a fila pode ter ofertas de antes da regra (ou de antes de uma
 * mudança nela). A caixa de entrada do dono e os canais que ele liberou da regra ficam de fora, como na coleta.
 */
function vendasNoEnvio(p, grupo) {
  if (p.manual || p.semRegraVendas || origemDe(p) === 'caixa') return null;
  return motivoVendas(p, grupo.filtros?.vendasMinimas ?? VENDAS_MINIMAS);
}

/**
 * Publica a próxima oferta do grupo, com a última checagem contra repetição logo antes de postar.
 * O status ENVIANDO é gravado em disco ANTES de chamar o Telegram/WhatsApp: se o bot cair no meio, ao religar
 * a oferta vira INCERTO e não é repetida. Sem resposta do destino = INCERTO (não repete); recusa clara = ERRO
 * (volta para a fila depois, até 3 vezes).
 * Limite: só o envio pelo Telegram sabe distinguir "sem resposta" de "recusado". No WhatsApp (wwebjs/Evolution/
 * WuzAPI) todo erro vira ERRO — um timeout depois de a mensagem ter saído pode repetir a oferta (até 3 vezes).
 * E o Telegram não deixa o bot consultar o que já está no canal, então um INCERTO não tem como ser confirmado.
 */
export async function enviarProximo(sender, grupo, store = new Store()) {
  const dias = grupo.filtros?.diasSemRepetir || 5;
  let p = null;
  // Cada candidato barrado sai da fila (muda de status), então o laço termina; null = fila realmente vazia.
  while (!p) {
    const candidato = store.proximo(grupo.nome);
    if (!candidato) break;
    const repetido = store.jaPublicado(candidato, dias);
    const linkRuim = !repetido && motivoLinkInvalido(candidato);
    const vendas = !repetido && !linkRuim && vendasNoEnvio(candidato, grupo);
    if (!repetido && !linkRuim && !vendas) p = candidato;
    else {
      const motivo = repetido || linkRuim || vendas;
      store.setStatus(candidato, repetido ? 'DUPLICADO' : 'REJEITADO', { erro: motivo });
      evento(repetido ? 'duplicado' : linkRuim ? 'link_invalido' : 'recusado', candidato, motivo);
      log(`  ⏭️  [${grupo.nome}] ${motivo} — pulando: ${candidato.nome.slice(0, 55)}`);
    }
  }
  if (!p) {
    store.anotarFilaVazia?.(grupo.nome);
    store.save();
    log(`📭 [${grupo.nome}] fila vazia.`);
    return null;
  }
  store.setStatus(p, 'ENVIANDO', { tentativaEm: new Date().toISOString() });
  store.save();
  try {
    const titulo = p.tipo === 'cupom' ? tituloCupom(p) : await gerarTitulo(p, estiloDoProduto(p, grupo));
    const legenda = montarLegenda(p, { titulo, mensagemAdicional: grupo.mensagemAdicional });
    if (settings.simularDigitando && settings.sender !== 'console') await simularDigitando(sender, grupo.jid);
    const r = p.imagem
      ? await sender.sendImage(grupo.jid, p.imagem, legenda)
      : (await sender.sendText(grupo.jid, legenda), { comImagem: false }); // sem foto: o WhatsApp mostra a prévia do link
    const semImagem = r?.comImagem === false;
    store.setStatus(p, 'ENVIADO', { enviadoEm: new Date().toISOString(), semImagem });
    evento('publicado', p, semImagem ? 'sem imagem' : null);
    log(`📤 [${grupo.nome}]${semImagem ? ' (sem imagem)' : ''} ${p.nome.slice(0, 60)} — ${p.linkAfiliado}`);
  } catch (e) {
    const msg = String(e.message).split('\n')[0];
    if (e.incerto) {
      store.setStatus(p, 'INCERTO', { erro: msg, enviadoEm: new Date().toISOString() });
      evento('sem_confirmacao', p, msg);
      log(`⚠️  [${grupo.nome}] sem confirmação do envio (pode ter saído; não vou repetir): ${p.nome.slice(0, 55)} — ${msg}`);
    } else {
      store.setStatus(p, 'ERRO', { erro: msg, tentativas: (p.tentativas || 0) + 1 });
      evento('falha_envio', p, `${msg} (tentativa ${(p.tentativas || 0)})`);
      log(`❌ [${grupo.nome}] erro ao enviar ${p.id}: ${e.stack || e.message}`);
    }
  }
  store.save();
  return p;
}

export async function enviarParaTodos(sender, store = new Store(), avisos = null, ativos = loadGrupos().filter((g) => g.ativo)) {
  for (const [i, g] of ativos.entries()) {
    if (!g.jid || g.jid.startsWith('COLE_AQUI')) {
      log(`⚠️  Grupo "${g.nome}" sem JID configurado (rode: npm run grupos)`);
      continue;
    }
    // Entre um grupo e outro: 1-2 min no WhatsApp (como no curso, contra banimento); no Telegram não precisa.
    if (i > 0) await (settings.sender === 'telegram' ? randomDelay(3, 8) : randomDelay(60, 120));
    const p = await enviarProximo(sender, g, store);
    if (!avisos) continue;
    if (!p) await avisos.filaVazia(g.nome);
    else if (p.status === 'ERRO') await avisos.falhaEnvio(g.nome, p);
    else if (p.status === 'INCERTO') await avisos.envioIncerto(g.nome, p);
  }
}

/** A fila (o que ainda não saiu) foi montada em outro dia? Acontece quando o bot fica desligado na virada do dia. */
export function filaDeOutroDia(store, agora = new Date()) {
  const hoje = diaLocal(agora, settings.tz);
  return store.list((p) => p.status === 'PRONTO' || p.status === 'PENDENTE').some((p) => p.coletadoEm && diaLocal(new Date(p.coletadoEm), settings.tz) !== hoje);
}

export function limpar(store = new Store()) {
  const n = store.limparDia();
  store.save();
  log(`🧹 Limpeza diária: ${n} produto(s) removido(s) da fila (histórico mantido).`);
}
