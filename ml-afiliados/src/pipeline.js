/**
 * As 3 etapas do curso, agora em código:
 *   coletar()      -> "BUSCA DE PRODUTOS MERCADO LIVRE" (lê as categorias ativas e guarda os produtos)
 *   gerarLinks()   -> "GERA LINKS DE AFILIADOS" (lotes de 20 com pausa entre eles)
 *   enviarProximo()-> "ENVIAR PRODUTOS PARA O GRUPO" (título + legenda + imagem + digitando...)
 */
import { loadCategorias, loadGrupos, loadShopee, settings } from './config.js';
import { ErroBloqueioML, scrapeCategoria } from './ml/scraper.js';

/** Quanto tempo o bot fica sem pedir páginas ao ML depois de um bloqueio (verificação de tráfego suspeito). */
export const PAUSA_ML_HORAS = 6;
import { MLAffiliate } from './ml/affiliate.js';
import { buscarOfertasAmazon } from './amazon.js';
import { Awin, buscarCuponsAwin, loadAwin } from './awin.js';
import { buscarProdutosAwin, motivoForaDoPublico } from './awin-produtos.js';

// Testes nunca baixam catálogo de verdade (a chave pode estar no .env do PC).
const produtosAwinPadrao = process.env.NODE_TEST_CONTEXT
  ? async () => ({ produtos: [], categorias: {}, motivo: 'desligada (teste)' })
  : (o) => buscarProdutosAwin({ api: new Awin(), cfg: loadAwin().produtos || {}, ...o });
import { buscarOfertasShopee } from './shopee-busca.js';
import { HistoricoDePrecos } from './precos.js';
import fs from 'node:fs';
import path from 'node:path';
import { VENDAS_MINIMAS, motivoVendas } from './ml/vendas.js';
import { evento, origemDe } from './eventos.js';
import { preferenciaFeminina } from './genero.js';
import { marcaDoProduto, preferenciaDeMarca } from './marcas.js';
import { BrowserSession, sessaoNavegador } from './browser.js';
import { montarLegenda, tituloCupom } from './caption.js';
import { Store } from './store.js';
import { casaTermo, chunk, diaLocal, log, normalizar, randomDelay, shuffle, sleep } from './util.js';

/** Aplica os filtros do grupo. Retorna o motivo da recusa ou null se passou. */
export function motivoRecusa(p, f, store, { descontoDesconhecidoPassa = false, exigirVendas = true } = {}) {
  const nome = normalizar(p.nome);
  const semDesconto = p.descontoPct === null || p.descontoPct === undefined;
  // Nicho: o nome precisa casar com pelo menos uma das palavras obrigatórias (ex.: fitness).
  if (f.palavrasObrigatorias?.length && !f.palavrasObrigatorias.some((t) => casaTermo(nome, t))) return 'fora do nicho';
  if ((f.palavrasBloqueadas || []).some((w) => casaTermo(nome, w))) return 'palavra bloqueada';
  // Grupo "soMarcas" (grupos.json): só produto de uma marca de config/marcas.json. Cupom de loja passa.
  if (f.soMarcas && p.tipo !== 'cupom' && !marcaDoProduto(p)) return 'sem marca da lista';
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
  if (p.loja === 'shopee') return /^(s\.shopee\.com\.br|shope\.ee)$/.test(host) && u.pathname.length > 1 ? null : 'link da Shopee sem afiliado';
  if (p.loja === 'awin') {
    if (host === 'tidd.ly' && u.pathname.length > 1) return null;
    // awinaffid (link de cupom/página) ou a= (link de produto dos catálogos, pclick.php?p=...&a=<afiliado>&m=<loja>)
    return /(^|\.)awin1\.com$/.test(host) && (u.searchParams.get('awinaffid') || u.searchParams.get('a')) ? null : 'link da Awin sem id de afiliado';
  }
  if (host === 'meli.la' && /^\/\w+$/.test(u.pathname)) return null;
  return /(^|\.)mercadoli[vb]re\.com(\.br)?$/.test(host) && u.searchParams.get('matt_word') ? null : 'link do ML sem afiliado';
}

export async function coletar(store = new Store(), { amazon = buscarOfertasAmazon, awin = buscarCuponsAwin, awinProdutos = produtosAwinPadrao, shopee = buscarOfertasShopee, categoriasML = null, raspar = scrapeCategoria, esperar = randomDelay, grupos: gruposDados = null, apenasGrupos = null, precos = null, mlMinIntervaloH = 0, soCupons = false } = {}) {
  // `soCupons`: só os cupons da Awin (garantia de 1 cupom por dia em cada grupo), sem ML, Shopee nem Amazon.
  // Histórico de preços (src/precos.js), ao lado do db.json desta fila (nos testes, numa pasta temporária).
  const historico = precos ?? new HistoricoDePrecos({ arquivo: path.join(path.dirname(store.file), 'precos.json') });
  /** Filtros do grupo + o histórico de preço: já esteve bem mais barato = não é oferta de verdade. Anota o preço visto. */
  const recusa = (p, filtros) => {
    const h = historico.avaliar(p);
    historico.anotar(p);
    const motivo = motivoRecusa(p, filtros, store);
    if (motivo) return motivo;
    if (h.caro) return 'já esteve mais barato (30 dias)';
    if (h.menorEm30Dias) p.menorPreco30d = true;
    return null;
  };
  // `grupos`: só nos testes (não dependem de qual grupo está pausado). `apenasGrupos`: busca de reposição, só desses grupos.
  const so = Array.isArray(apenasGrupos) && apenasGrupos.length ? new Set(apenasGrupos) : null;
  const lista = (gruposDados ?? loadGrupos()).map((g) => (so && !so.has(g.nome) ? { ...g, ativo: false } : g));
  const grupos = Object.fromEntries(lista.map((g) => [g.nome, g]));
  const emEspera = lista.filter((g) => g.emEspera).map((g) => g.nome);
  if (emEspera.length) log(`⏸️  Em espera (ligado, mas sem canal): ${emEspera.join(', ')} — nada é buscado para ele(s).`);
  // Mercado Livre com calma (21/10/2026: páginas demais = acesso marcado como suspeito): quando ele bloqueia, para
  // por PAUSA_ML_HORAS; nas buscas de reposição, no máximo uma ida ao ML a cada `mlMinIntervaloH` horas.
  let mlBloqueado = null;
  const agoraMs = Date.now();
  // O dono resolveu o captcha no navegador do bot (npm run ml-liberar): tira a pausa e volta a ler o ML.
  const liberado = path.join(path.dirname(store.file), '.ml-liberado');
  if (fs.existsSync(liberado)) {
    fs.rmSync(liberado, { force: true });
    if (store.data.pausaML) log('🧩 Mercado Livre liberado pelo dono (captcha resolvido): pausa encerrada.');
    delete store.data.pausaML;
  }
  const pausadoAte = Date.parse(store.data.pausaML || 0) || 0;
  const ultimaML = Date.parse(store.data.ultimaColetaML || 0) || 0;
  let pularML = null;
  if (pausadoAte > agoraMs) pularML = `em pausa até ${new Date(pausadoAte).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: settings.tz })} (o ML bloqueou)`;
  else if (mlMinIntervaloH && agoraMs - ultimaML < mlMinIntervaloH * 3_600_000) pularML = `última ida ao ML há menos de ${mlMinIntervaloH} h`;
  if (soCupons) pularML = 'só cupons nesta busca';
  const categorias = pularML ? [] : shuffle((categoriasML ?? loadCategorias()).filter((c) => c.ativo && grupos[c.grupo]?.ativo !== false));
  if (pularML) log(`🔎 Mercado Livre: pulado nesta busca (${pularML}).`);
  else log(`🔎 Coletando ${categorias.length} categoria(s) ativa(s)...`);
  if (categorias.length) store.data.ultimaColetaML = new Date(agoraMs).toISOString();
  let novos = 0;
  let encontrados = 0;
  const recusas = {};
  const porCategoria = {};
  const paginas = new Map(); // a mesma página de ofertas serve a mais de um grupo: baixa uma vez só
  for (const cat of categorias) {
    if (mlBloqueado) break;
    const grupo = grupos[cat.grupo];
    if (!grupo) {
      log(`  ⚠️  Categoria "${cat.nome}" aponta para o grupo "${cat.grupo}", que não existe em grupos.json`);
      continue;
    }
    const c = (porCategoria[cat.nome] ??= { encontrados: 0, aceitos: 0 });
    const antes = c.encontrados;
    const chave = `${cat.url}|${cat.paginas || 1}`;
    const jaBaixada = paginas.has(chave);
    if (!jaBaixada) {
      try {
        paginas.set(chave, await raspar(cat));
      } catch (e) {
        if (!(e instanceof ErroBloqueioML)) throw e;
        mlBloqueado = e.message;
        store.data.pausaML = new Date(Date.now() + PAUSA_ML_HORAS * 3_600_000).toISOString();
        log(`⛔ Mercado Livre bloqueou (${e.message}): sem novas páginas do ML por ${PAUSA_ML_HORAS} h. Shopee e Awin seguem normais.`);
        break;
      }
    } else log(`  ${cat.nome} (${cat.grupo}): reaproveitando a página já baixada.`);
    for (const bruto of paginas.get(chave)) {
      const p = { ...bruto, grupo: cat.grupo, categoria: cat.nome };
      c.encontrados++;
      const motivo = recusa(p, grupo.filtros);
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
    const az = soCupons ? { produtos: [], categorias: {}, motivo: 'desligada' } : await amazon(undefined, undefined, { gruposAtivos: new Set(lista.filter((g) => g.ativo).map((g) => g.nome)) });
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
      const motivo = recusa(p, grupo.filtros);
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

  // Shopee (API oficial de afiliados): busca própria por marca e palavra (config/shopee.json). Já vem com o link do dono.
  let shopeeErro = null;
  try {
    const sh = soCupons ? { produtos: [], categorias: {}, motivo: 'desligada' } : await shopee({ grupos: lista, vez: (store.data.shopeeVez ??= {}) });
    if (sh.motivo) {
      if (!/desligada/.test(sh.motivo)) log(`🛍️  Shopee: ${sh.motivo}`);
    } else {
      log(`🛍️  Shopee: ${sh.produtos.length} oferta(s) encontrada(s).`);
    }
    for (const [nome, c] of Object.entries(sh.categorias || {})) porCategoria[nome] = c;
    for (const p of sh.produtos || []) {
      encontrados++;
      const grupo = grupos[p.grupo];
      if (!grupo?.ativo) continue;
      const motivo = recusa(p, grupo.filtros);
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
    shopeeErro = String(e.message).split('\n')[0];
    log(`❌ Shopee: ${shopeeErro}`);
  }

  // Awin — produtos dos catálogos das lojas aprovadas (22/10/2026: revezar com a Shopee). No máximo `porGrupo` novos por grupo.
  let awinProdutosErro = null;
  try {
    const ap = soCupons ? { produtos: [], categorias: {}, motivo: 'desligada' } : await awinProdutos({ grupos: lista, vez: (store.data.awinVez ??= {}) });
    if (ap.motivo) {
      if (!/desligad/.test(ap.motivo)) log(`🛍️  Awin (produtos): ${ap.motivo}`);
    } else log(`🛍️  Awin: ${ap.produtos.length} produto(s) dos catálogos para conferir.`);
    for (const [nome, c] of Object.entries(ap.categorias || {})) porCategoria[nome] = c;
    const maxAw = loadAwin().produtos?.porGrupo ?? 8;
    const novosAw = {};
    for (const p of ap.produtos || []) {
      const grupo = grupos[p.grupo];
      if (!grupo?.ativo || (novosAw[p.grupo] || 0) >= maxAw) continue;
      encontrados++;
      const motivo = recusa(p, grupo.filtros);
      if (motivo) {
        recusas[motivo] = (recusas[motivo] || 0) + 1;
        evento('recusado', p, motivo);
        continue;
      }
      if (porCategoria[p.categoria]) porCategoria[p.categoria].aceitos++;
      if (store.upsert(p)) {
        novos++;
        novosAw[p.grupo] = (novosAw[p.grupo] || 0) + 1;
        evento('na_fila', p);
      }
    }
  } catch (e) {
    awinProdutosErro = String(e.message).split('\n')[0];
    log(`❌ Awin (produtos): ${awinProdutosErro}`);
  }

  // Awin (API oficial): cupons e promoções das lojas em que a conta foi aprovada. Já vêm com o link de afiliado.
  let awinErro = null;
  try {
    const dias = loadAwin().cupons.diasSemRepetir || 7;
    // Um cupom de loja por grupo por dia: grupo que já postou (ou tem na fila) um cupom hoje não recebe outro.
    const hoje = diaLocal(new Date(), settings.tz);
    const temCupomHoje = (g) =>
      store.list((p) => p.grupo === g && p.tipo === 'cupom' && (p.status === 'PRONTO' || p.status === 'PENDENTE' || p.status === 'ENVIANDO' || (p.status === 'ENVIADO' && p.enviadoEm && diaLocal(new Date(p.enviadoEm), settings.tz) === hoje))).length > 0;
    const aw = await awin({ grupos: lista, jaTem: (p) => store.conhecido(p.id, p.grupo) || store.enviadoRecentemente(p.id, p.grupo, dias), temCupomHoje });
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
  const resultado = { encontrados, novos, recusas, categorias: porCategoria, amazonErro, awinErro, awinProdutosErro, shopeeErro, mlBloqueado };
  historico.salvar();
  store.registrarColeta(resultado);
  const agora = new Date().toISOString(); // quando cada grupo foi buscado (a reposição conta por grupo)
  if (!soCupons) for (const g of lista.filter((x) => x.ativo)) (store.data.coletaPorGrupo ??= {})[g.nome] = agora;
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
 * Nicho e palavras bloqueadas do grupo valem de novo na hora de postar: o que entrou antes de uma correção não sai
 * (16/10/2026: um rack de TV "Off White Dior" entrou no Perfumes pela busca "Dior"). Cupom e caixa de entrada passam.
 */
function nichoNoEnvio(p, grupo) {
  if (p.manual || p.tipo === 'cupom' || origemDe(p) === 'caixa') return null;
  const f = grupo.filtros || {};
  const nome = normalizar(p.nome);
  if (f.palavrasObrigatorias?.length && !f.palavrasObrigatorias.some((t) => casaTermo(nome, t))) return 'fora do nicho';
  if ((f.palavrasBloqueadas || []).some((w) => casaTermo(nome, w))) return 'palavra bloqueada';
  return null;
}

/** Catálogo da Awin: o que entrou na fila antes da regra do público (masculino, infantil, caro demais) não sai. */
function publicoNoEnvio(p, grupo) {
  return doCatalogoAwin(p) ? motivoForaDoPublico(p, grupo, loadAwin().produtos || {}) : null;
}

/** Grupo "soMarcas": o que entrou na fila antes do filtro (ou sem marca) não sai. Cupom e caixa de entrada passam. */
function marcaNoEnvio(p, grupo) {
  if (!grupo.soMarcas || p.manual || p.tipo === 'cupom' || origemDe(p) === 'caixa') return null;
  return marcaDoProduto(p) ? null : 'sem marca da lista';
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
/** De quantos em quantos posts a Shopee pode aparecer (config/shopee.json > "umACada"; 0 = sem limite). */
export const umACadaShopee = () => Number(loadShopee().umACada) || 0;
/** Minutos entre envios (CRON_ENVIO "*\/3 ..." = 3). */
const minutosEntreEnvios = () => Number(String(settings.cron.envio).match(/^\*\/(\d+)/)?.[1]) || 3;

/**
 * Uma fonte (`daFonte`) pode sair agora neste grupo? Sim se nenhum dos últimos N-1 posts foi dela — ou, quando só há
 * ela para postar, se o último post dela foi há N envios de tempo (assim o grupo não trava: vira 1 a cada N×3 min).
 */
function fonteLiberada(store, grupo, daFonte, n, minutos = minutosEntreEnvios(), agora = Date.now()) {
  if (!(n >= 2)) return true;
  const enviados = store
    .list((p) => p.grupo === grupo && (p.status === 'ENVIADO' || p.status === 'INCERTO') && p.enviadoEm)
    .sort((a, b) => String(b.enviadoEm).localeCompare(String(a.enviadoEm)));
  if (!enviados.slice(0, n - 1).some(daFonte)) return true;
  const ultima = enviados.find(daFonte);
  return agora - Date.parse(ultima.enviadoEm) >= n * minutos * 60_000;
}

/** A Shopee pode sair agora neste grupo? (1 a cada N posts) */
export const shopeeLiberada = (store, grupo, n = umACadaShopee(), minutos, agora) => fonteLiberada(store, grupo, (p) => p.loja === 'shopee', n, minutos, agora);

/** Produto dos catálogos da Awin (não cupom). */
export const doCatalogoAwin = (p) => String(p.id || '').startsWith('AWF-');

/**
 * Catálogo da Awin com calma (o dono, 27/10/2026: "os tênis da Nike tão muito exagerados" — saíram 4 Nike seguidos):
 * no máximo 1 a cada `umACada` posts e `maxPorDia` por grupo (config/awin.json > produtos).
 */
export function awinLiberada(store, grupo, cfg = loadAwin().produtos || {}, minutos, agora = Date.now()) {
  if (cfg.maxPorDia) {
    const hoje = diaLocal(new Date(agora), settings.tz);
    const hojeNoGrupo = store.list((p) => p.grupo === grupo && doCatalogoAwin(p) && (p.status === 'ENVIADO' || p.status === 'INCERTO') && p.enviadoEm && diaLocal(new Date(p.enviadoEm), settings.tz) === hoje).length;
    if (hojeNoGrupo >= cfg.maxPorDia) return false;
  }
  return fonteLiberada(store, grupo, doCatalogoAwin, Number(cfg.umACada) || 0, minutos, agora);
}

export async function enviarProximo(sender, grupo, store = new Store()) {
  const dias = grupo.filtros?.diasSemRepetir || 5;
  // Público principal: meninas. Femininos na frente, depois os neutros; masculino no máximo 1 a cada N posts.
  // E as marcas da lista (config/marcas.json) passam na frente das sem marca (pedido do dono, 15/10/2026).
  const feminina = grupo.preferirFeminino ? preferenciaFeminina(store, grupo.nome, grupo.preferirFeminino) : {};
  const marca = preferenciaDeMarca();
  // Shopee no máximo 1 a cada N posts (a comissão é baixa — pedido do dono, 26/10/2026); catálogo da Awin com calma.
  const shopeeOk = shopeeLiberada(store, grupo.nome);
  const awinOk = awinLiberada(store, grupo.nome);
  const temLimite = feminina.aceitar || !shopeeOk || !awinOk;
  const preferencia = {
    aceitar: temLimite ? (x) => (feminina.aceitar ? feminina.aceitar(x) : true) && (shopeeOk || x.loja !== 'shopee') && (awinOk || !doCatalogoAwin(x)) : undefined,
    preferir: (x) => (feminina.preferir ? feminina.preferir(x) : 0) + marca(x),
  };
  let p = null;
  // Cada candidato barrado sai da fila (muda de status), então o laço termina; null = fila realmente vazia.
  while (!p) {
    const candidato = store.proximo(grupo.nome, preferencia);
    if (!candidato) break;
    const repetido = store.jaPublicado(candidato, dias);
    const linkRuim = !repetido && motivoLinkInvalido(candidato);
    const vendas = !repetido && !linkRuim && (vendasNoEnvio(candidato, grupo) || marcaNoEnvio(candidato, grupo) || nichoNoEnvio(candidato, grupo) || publicoNoEnvio(candidato, grupo));
    if (!repetido && !linkRuim && !vendas) p = candidato;
    else {
      const motivo = repetido || linkRuim || vendas;
      store.setStatus(candidato, repetido ? 'DUPLICADO' : 'REJEITADO', { erro: motivo });
      evento(repetido ? 'duplicado' : linkRuim ? 'link_invalido' : 'barrado', candidato, motivo); // "barrado" = na hora de postar (≠ recusado na busca)
      log(`  ⏭️  [${grupo.nome}] ${motivo} — pulando: ${candidato.nome.slice(0, 55)}`);
    }
  }
  if (!p && preferencia.aceitar && store.proximo(grupo.nome)) {
    store.save();
    const limites = [!shopeeOk && `Shopee: 1 a cada ${umACadaShopee()} posts`, !awinOk && 'catálogo da Awin: no limite'].filter(Boolean);
    log(`⏳ [${grupo.nome}] ${limites.length ? `só ofertas no limite ou masculinos na fila (${limites.join('; ')})` : 'só masculinos na fila'}: esperando outro produto.`);
    return { esperando: true };
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
    const titulo = p.tipo === 'cupom' ? tituloCupom(p) : null; // produto não tem mais título (formato de 20/10/2026)
    const legenda = montarLegenda(p, { titulo, mensagemAdicional: grupo.mensagemAdicional });
    if (settings.simularDigitando && settings.sender !== 'console') await simularDigitando(sender, grupo.jid);
    const r = p.imagem
      ? await sender.sendImage(grupo.jid, p.imagem, legenda)
      : (await sender.sendText(grupo.jid, legenda), { comImagem: false }); // sem foto: o WhatsApp mostra a prévia do link
    const semImagem = r?.comImagem === false;
    store.setStatus(p, 'ENVIADO', { enviadoEm: new Date().toISOString(), semImagem, legenda }); // a legenda vai igual para o WhatsApp
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
