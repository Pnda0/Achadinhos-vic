/**
 * Analytics — publica o painel no Cloudflare Pages, projeto SEPARADO "achadinhos-vic-painel" (nunca no
 * "achadinhos-vic", que é o site público). O painel é privado: Cloudflare Access libera só o e-mail do dono
 * (passo a passo no README, seção 3.15).
 *
 * TRAVA, antes de CADA publicação: abre a URL do painel sem cookie e sem seguir redirecionamento.
 *   - redireciona para *.cloudflareaccess.com -> protegido: publica os dados;
 *   - 404 ou sem DNS (projeto ainda não existe) -> cria o projeto e publica só uma página "configurando…", sem dados;
 *   - 200 (aberto para qualquer um) ou erro   -> NÃO publica e avisa o dono no Telegram (1x por dia).
 *
 * Precisa de CLOUDFLARE_API_TOKEN (permissão "Cloudflare Pages: Edit") e CLOUDFLARE_ACCOUNT_ID no .env e do
 * wrangler (dependência opcional, Node 22+). Sem isso, o painel fica só no PC (data/analytics/relatorio.html).
 * Pula a publicação quando o conteúdo não mudou. Nunca mostra o token (nem no log). Falha nunca derruba o bot.
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { settings } from '../config.js';
import { diaLocal, log } from '../util.js';
import { PASTA_ANALYTICS } from './dia.js';
import { pastaSite } from './pagina.js';

export const PROJETO = 'achadinhos-vic-painel';
export const URL_PAINEL = `https://${PROJETO}.pages.dev`;
const PROIBIDO = 'achadinhos-vic'; // o site público: nunca publicar o painel lá
const TEMPO_MAXIMO = 3 * 60_000;

const arquivoEstado = (base) => path.join(base, 'publicacao.json');
export function lerEstado(base = PASTA_ANALYTICS) {
  try {
    return JSON.parse(fs.readFileSync(arquivoEstado(base), 'utf8')) || {};
  } catch {
    return {};
  }
}
function gravarEstado(base, estado) {
  fs.mkdirSync(base, { recursive: true });
  fs.writeFileSync(arquivoEstado(base), JSON.stringify(estado, null, 1));
}

/** Link do painel para o resumo: só depois de uma publicação com a trava confirmada. */
export const urlPublicada = (base = PASTA_ANALYTICS) => (lerEstado(base).trava === 'protegido' && lerEstado(base).hash ? URL_PAINEL : null);

/** 'protegido' | 'inexistente' | 'aberto' | 'erro' (com o detalhe). GET sem cookie, sem seguir redirecionamento. */
export async function verificarTrava({ url = URL_PAINEL, fetchImpl = fetch } = {}) {
  try {
    const res = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { 'user-agent': 'achadinhos-painel-trava' }, signal: AbortSignal.timeout(15_000) });
    const destino = res.headers?.get?.('location') || '';
    if (res.status >= 300 && res.status < 400) {
      let host = '';
      try {
        host = new URL(destino, url).hostname.toLowerCase();
      } catch {}
      return host.endsWith('.cloudflareaccess.com') ? { trava: 'protegido' } : { trava: 'erro', detalhe: `redireciona para ${host || 'outro lugar'}` };
    }
    if (res.status === 404) return { trava: 'inexistente' };
    if (res.status === 200) return { trava: 'aberto' };
    return { trava: 'erro', detalhe: `HTTP ${res.status}` };
  } catch (e) {
    // Projeto do Pages que ainda não existe nem tem DNS (conferido em 14/10/2026: ENOTFOUND, não 404).
    if (e?.cause?.code === 'ENOTFOUND' && /\.pages\.dev$/i.test(new URL(url).hostname)) return { trava: 'inexistente' };
    return { trava: 'erro', detalhe: String(e.message || e).split('\n')[0].slice(0, 120) };
  }
}

/** Esconde o token em qualquer texto que vá para o log ou para o dono. */
export const mascarar = (texto, segredos = []) => segredos.filter((s) => s && s.length >= 6).reduce((t, s) => t.split(s).join('***'), String(texto || ''));

/** Caminho do wrangler instalado (dependência opcional) ou null. */
export function acharWrangler() {
  try {
    const pkg = createRequire(import.meta.url).resolve('wrangler/package.json');
    const bin = path.join(path.dirname(pkg), 'bin', 'wrangler.js');
    return fs.existsSync(bin) ? bin : null;
  } catch {
    return null;
  }
}

/** Roda o wrangler com o token só no ambiente do processo filho; devolve { ok, saida } com a saída mascarada. */
export function rodarWrangler(args, { env = process.env, tempo = TEMPO_MAXIMO } = {}) {
  const bin = acharWrangler();
  if (!bin) return Promise.resolve({ ok: false, saida: 'wrangler não instalado (precisa do Node 22+ e de "npm install")' });
  const segredos = [env.CLOUDFLARE_API_TOKEN];
  return new Promise((resolve) => {
    let saida = '';
    const p = spawn(process.execPath, [bin, ...args], {
      env: { ...process.env, CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
      windowsHide: true,
    });
    const juntar = (d) => (saida = (saida + d).slice(-4000));
    p.stdout.on('data', juntar);
    p.stderr.on('data', juntar);
    const relogio = setTimeout(() => {
      p.kill();
      juntar('\n(tempo esgotado: 3 min)');
    }, tempo);
    p.on('error', (e) => juntar(`\n${e.message}`));
    p.on('close', (codigo) => {
      clearTimeout(relogio);
      resolve({ ok: codigo === 0, saida: mascarar(saida, segredos) });
    });
  });
}

/** Página sem dados nenhum, para a 1ª publicação (antes de o dono ligar o Access). */
export function gravarPaginaConfigurando(base = PASTA_ANALYTICS) {
  const pasta = path.join(base, 'site-configurando');
  fs.mkdirSync(pasta, { recursive: true });
  fs.writeFileSync(
    path.join(pasta, 'index.html'),
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Painel</title>' +
      '<style>body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#f6f6f4;color:#0b0b0b;display:grid;place-items:center;min-height:100vh;padding:16px}@media (prefers-color-scheme:dark){body{background:#111110;color:#f0efec}}</style>' +
      '</head><body><p>Configurando…</p></body></html>\n'
  );
  fs.writeFileSync(path.join(pasta, '_headers'), '/*\n  X-Robots-Tag: noindex, nofollow\n  Cache-Control: no-store\n');
  fs.writeFileSync(path.join(pasta, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  return pasta;
}

/**
 * Publica a pasta data/analytics/site (já gerada, com o `hash` dela). Devolve { publicado, motivo }.
 * `executar` e `fetchImpl` são trocáveis nos testes.
 */
export async function publicarPainel({ hash, base = PASTA_ANALYTICS, env = process.env, fetchImpl = fetch, executar = rodarWrangler, avisos = null, agora = new Date(), projeto = PROJETO } = {}) {
  if (projeto === PROIBIDO) return { publicado: false, motivo: 'projeto proibido (site público)' };
  if (!env.CLOUDFLARE_API_TOKEN?.trim() || !env.CLOUDFLARE_ACCOUNT_ID?.trim()) return { publicado: false, motivo: 'sem CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID: painel só no PC' };
  const estado = lerEstado(base);
  const segredos = [env.CLOUDFLARE_API_TOKEN];
  const deploy = (pasta) => executar(['pages', 'deploy', pasta, '--project-name', projeto, '--branch', 'main', '--commit-dirty=true'], { env });
  const ultimaLinha = (r) => mascarar(r.saida.split('\n').filter(Boolean).at(-1) || 'erro', segredos);
  const dia = diaLocal(agora, settings.tz);
  /** Aviso ao dono: no máximo 1 por dia por assunto (a menos que `agora` seja urgente). */
  const avisarDono = async (assunto, texto, { urgente = false } = {}) => {
    const chave = `aviso_${assunto}`;
    if (!urgente && estado[chave] === dia) return;
    estado[chave] = dia;
    await avisos?.avisar(`painel-${assunto}`, mascarar(texto, segredos), { sempre: true }).catch(() => {});
  };

  let { trava, detalhe } = await verificarTrava({ url: `https://${projeto}.pages.dev`, fetchImpl });
  // Projeto já criado e o nome "sumiu" do DNS: é a internet/DNS do PC, não o projeto. Nunca recriar nem publicar
  // o "configurando…" por cima do painel real.
  if (trava === 'inexistente' && estado.criado) ({ trava, detalhe } = { trava: 'erro', detalhe: 'o painel não respondeu (internet ou DNS do PC?)' });

  if (trava === 'aberto' || trava === 'erro') {
    const motivo = trava === 'aberto' ? 'o painel está ABERTO (sem o Cloudflare Access)' : `não consegui conferir a proteção do painel (${detalhe})`;
    log(`📊 Painel NÃO publicado: ${motivo}.`);
    await avisarDono(
      trava,
      trava === 'aberto'
        ? `*Painel sem proteção* 🔓\nO painel (${URL_PAINEL}) ainda não está protegido pelo Cloudflare Access, então não publiquei os números. Siga o passo a passo do README (seção 3.15) para liberar só o seu e-mail.`
        : `*Não publiquei o painel* ⚠️\n${motivo}. Ele continua no PC: data/analytics/relatorio.html.`
    );
    gravarEstado(base, { ...estado, trava });
    return { publicado: false, motivo };
  }

  if (trava === 'inexistente') {
    // 1ª vez: cria o projeto e publica só a página "configurando…". Se o projeto já existia, só anota.
    const c = await executar(['pages', 'project', 'create', projeto, '--production-branch', 'main'], { env });
    const jaExistia = !c.ok && /already exists|já existe|8000002/i.test(c.saida);
    if (!c.ok && !jaExistia) {
      log(`📊 Painel: não consegui criar o projeto ${projeto} (${ultimaLinha(c)}).`);
      gravarEstado(base, { ...estado, trava });
      return { publicado: false, motivo: 'falha ao criar o projeto' };
    }
    estado.criado = true;
    if (jaExistia) {
      gravarEstado(base, { ...estado, trava });
      log(`📊 Painel: o projeto ${projeto} já existia; não publiquei nada por cima.`);
      return { publicado: false, motivo: 'projeto já existia' };
    }
    const r = await deploy(gravarPaginaConfigurando(base));
    gravarEstado(base, { ...estado, trava, configurandoEm: agora.toISOString() });
    log(`📊 Painel: projeto ${projeto} criado${r.ok ? ' com a página "configurando…" (sem dados)' : `, mas a página não subiu (${ultimaLinha(r)})`}. Falta ligar o Cloudflare Access (README 3.15).`);
    return { publicado: false, motivo: 'projeto novo: só a página "configurando…"' };
  }

  // protegido. Antes: a prévia de uma publicação anterior estava aberta? Só volta a publicar quando ela fechar.
  estado.criado = true;
  if (estado.previaAberta) {
    const p = await verificarTrava({ url: estado.previaAberta, fetchImpl });
    if (p.trava !== 'protegido' && p.trava !== 'inexistente') {
      await avisarDono('previa', textoPrevia(estado.previaAberta));
      gravarEstado(base, { ...estado, trava });
      return { publicado: false, motivo: 'prévia do painel aberta' };
    }
    delete estado.previaAberta;
  }
  if (estado.hash === hash) {
    gravarEstado(base, { ...estado, trava });
    return { publicado: false, motivo: 'nada mudou desde a última publicação' };
  }
  const r = await deploy(pastaSite(base));
  if (!r.ok) {
    log(`📊 Painel: a publicação falhou (${ultimaLinha(r)}).`);
    gravarEstado(base, { ...estado, trava });
    return { publicado: false, motivo: 'falha no wrangler' };
  }
  Object.assign(estado, { trava, hash, publicadoEm: agora.toISOString() });
  // Cada publicação ganha uma URL de prévia com os MESMOS dados: ela também tem de estar atrás do Access.
  const previa = urlDePrevia(r.saida, projeto);
  if (previa) {
    const p = await verificarTrava({ url: previa, fetchImpl });
    if (p.trava !== 'protegido') {
      estado.previaAberta = previa;
      gravarEstado(base, estado);
      log(`📊 Painel publicado, mas a PRÉVIA está aberta (${p.trava}): parei as publicações até ela ficar protegida.`);
      await avisarDono('previa', textoPrevia(previa), { urgente: true });
      return { publicado: true, motivo: 'prévia aberta' };
    }
  }
  gravarEstado(base, estado);
  log(`📊 Painel publicado: ${URL_PAINEL}`);
  return { publicado: true, motivo: 'ok' };
}

/** URL de prévia que o wrangler imprime no fim ("https://<hash>.<projeto>.pages.dev"), sem a de produção. */
export function urlDePrevia(saida, projeto = PROJETO) {
  const re = new RegExp(`https://[a-z0-9-]+\.${projeto.replace(/[.-]/g, '\$&')}\.pages\.dev`, 'gi');
  return (String(saida || '').match(re) || []).at(-1) || null;
}

const textoPrevia = (url) =>
  `*A prévia do painel está aberta* 🔓\n${url.replace(/^https:\/\//, '')} abre sem login. No Cloudflare Access, inclua também o domínio *.${PROJETO}.pages.dev (README 3.15, passo 3). Parei de publicar os números até ela ficar protegida.`;
