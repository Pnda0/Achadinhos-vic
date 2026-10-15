/**
 * Porteiro do painel (vai como _worker.js em cada publicação do projeto achadinhos-vic-painel, e roda no
 * Cloudflare, não no bot). Só abre com a senha PAINEL_SENHA (segredo do projeto no Cloudflare); qualquer nome de
 * usuário serve. Sem o segredo configurado, ninguém entra (fecha em vez de abrir). Vale também para as prévias.
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

export default {
  async fetch(request, env) {
    if (!env.PAINEL_SENHA || !iguais(senhaDoPedido(request), env.PAINEL_SENHA)) return NEGADO();
    const res = await env.ASSETS.fetch(request);
    const saida = new Response(res.body, res);
    saida.headers.set('Cache-Control', 'no-store');
    saida.headers.set('X-Robots-Tag', 'noindex, nofollow');
    saida.headers.set('Referrer-Policy', 'no-referrer');
    return saida;
  },
};
