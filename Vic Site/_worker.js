/**
 * Site público + links dos posts (roda no Cloudflare, não no bot).
 *
 *  /p/<canal><grupo><loja><código>  conta o clique no banco D1 (binding CLIQUES, ligado pelo wrangler.toml da raiz)
 *    e manda para a loja na hora. loja: m = meli.la, s = s.shopee.com.br, a = tidd.ly — só esses três destinos (não é
 *    redirecionador aberto). Quem gera os links é o bot: ml-afiliados/src/rastreio.js. Robôs de prévia de link não
 *    contam. Quem lê os cliques é o painel privado (o _worker.js dele, atrás da senha, no mesmo banco).
 *  o resto: os arquivos do site.
 */
const LOJAS = { m: 'https://meli.la/', s: 'https://s.shopee.com.br/', a: 'https://tidd.ly/' };
const CAMINHO = /^\/p\/([tw])([a-z])([msa])([A-Za-z0-9_-]{3,40})$/;
// Prévia de link do Telegram/WhatsApp e robôs de busca (o "bot/" pega Googlebot/2.1, bingbot/2.0...).
const ROBO = /bot\/|TelegramBot|Googlebot|bingbot|crawl|spider|slurp|preview|facebookexternalhit|^WhatsApp\/|Slack|Discord|curl|wget|python|go-http|headless/i;

const diaDeBrasilia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

async function contar(env, caminho) {
  await env.CLIQUES.prepare('INSERT INTO cliques (dia, caminho, n) VALUES (?1, ?2, 1) ON CONFLICT(dia, caminho) DO UPDATE SET n = n + 1')
    .bind(diaDeBrasilia(), caminho)
    .run();
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const m = url.pathname.match(CAMINHO);
    if (!m) return env.ASSETS.fetch(request);
    const [, , , loja, codigo] = m;
    const robo = ROBO.test(request.headers.get('user-agent') || '');
    if (request.method === 'GET' && !robo && env.CLIQUES) ctx.waitUntil(contar(env, url.pathname.slice(3)).catch(() => {}));
    return new Response(null, { status: 302, headers: { Location: LOJAS[loja] + codigo, 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
  },
};
