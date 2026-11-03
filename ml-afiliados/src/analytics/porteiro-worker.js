/**
 * Porteiro do painel (vai como _worker.js em cada publicação do projeto achadinhos-vic-painel, e roda no
 * Cloudflare, não no bot). Só abre com a senha PAINEL_SENHA (segredo do projeto no Cloudflare); qualquer nome de
 * usuário serve. Sem o segredo configurado, ninguém entra (fecha em vez de abrir). Vale também para as prévias.
 * Também responde /api/cliques (os cliques dos posts, lidos na hora pela aba Produtos).
 */
const NEGADO = () =>
  new Response('Painel privado.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Painel da Vic", charset="UTF-8"', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' },
  });

function iguais(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function senhaDoPedido(request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Basic ')) return null;
  try {
    const texto = new TextDecoder().decode(Uint8Array.from(atob(auth.slice(6)), (c) => c.charCodeAt(0)));
    return texto.slice(texto.indexOf(':') + 1);
  } catch {
    return null;
  }
}

/**
 * Cliques dos links dos posts (banco D1 "achadinhos-cliques", o mesmo que o site público grava; ligado pelo
 * cloudflare/painel/wrangler.toml). Só depois da senha. `desde` = AAAA-MM-DD.
 */
async function cliques(env, url) {
  if (!env.CLIQUES) return Response.json({ erro: 'sem banco' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  const desde = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('desde') || '') ? url.searchParams.get('desde') : '2000-01-01';
  const { results } = await env.CLIQUES.prepare('SELECT dia, caminho, n FROM cliques WHERE dia >= ?1 ORDER BY dia').bind(desde).all();
  return Response.json({ linhas: results.map((r) => [r.dia, r.caminho, r.n]) }, { headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' } });
}

export default {
  async fetch(request, env) {
    if (!env.PAINEL_SENHA || !iguais(senhaDoPedido(request), env.PAINEL_SENHA)) return NEGADO();
    const url = new URL(request.url);
    if (url.pathname === '/api/cliques') return cliques(env, url);
    const res = await env.ASSETS.fetch(request);
    const saida = new Response(res.body, res);
    saida.headers.set('Cache-Control', 'no-store');
    saida.headers.set('X-Robots-Tag', 'noindex, nofollow');
    saida.headers.set('Referrer-Policy', 'no-referrer');
    return saida;
  },
};
