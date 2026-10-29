/**
 * Grupos de WhatsApp como fonte (config/fontes.json > "gruposWhatsApp"; pedido do dono, 29/10/2026, sobre o grupo de
 * beleza da "Apromo da Luh": "esse grupo tem muita coisa boa feminina"). O chip do bot — o mesmo do espelho no
 * WhatsApp — entra pelo link de convite e só LÊ as mensagens; as ofertas passam pelo mesmo espelho dos canais do
 * Telegram (src/espelho.js), com as opções do bloco (só Amazon + ML achado pelo nome, regras do grupo de destino).
 * Os grupos em que o chip entrou ficam em data/whatsapp-fontes.json (código do convite -> JID): não pede de novo.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.js';
import { fonteDoGrupoTelegram } from './telegram-canais.js';
import { log, normalizar } from './util.js';

/** "https://chat.whatsapp.com/ABC123?x" -> "ABC123". */
export const codigoDoConvite = (convite) =>
  String(convite || '')
    .trim()
    .replace(/^https?:\/\/chat\.whatsapp\.com\/(invite\/)?/i, '')
    .replace(/[/?#].*$/, '');

/**
 * Liga os grupos do bloco como fontes. Cada item é { "titulo": parte do nome do grupo, "convite": link }: se o chip
 * ainda não estiver no grupo, entra pelo convite (e avisa o dono). Devolve as fontes prontas para o Espelho.
 * `entrar: false` = só procura os grupos em que o chip já está (a conferência de 30 em 30 min), sem log nem aviso.
 */
export async function ligarGruposWhatsApp(whats, c, { nichos = {}, lojasParceiras = false, arquivo = path.join(DATA_DIR, 'whatsapp-fontes.json'), avisar = async () => {}, entrar = true } = {}) {
  if (!c || c.ativo === false || !(c.grupos || []).length) return [];
  let entrou = {};
  try {
    entrou = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch {}
  const meus = await whats.listGroups();
  const fontes = [];
  for (const item of c.grupos.map((x) => (typeof x === 'string' ? { titulo: x } : x)).filter((x) => x?.titulo)) {
    const codigo = codigoDoConvite(item.convite);
    let grupo = meus.find((g) => codigo && g.jid === entrou[codigo]) || meus.find((g) => normalizar(g.nome).includes(normalizar(item.titulo)));
    if (!grupo && codigo && entrar) {
      try {
        // Sem o JID na resposta, o grupo aparece na lista logo depois de entrar.
        const jid = (await whats.entrarNoGrupo(codigo)) || (await whats.listGroups()).find((g) => normalizar(g.nome).includes(normalizar(item.titulo)))?.jid;
        if (!jid) throw new Error('o WhatsApp não devolveu o grupo');
        entrou[codigo] = jid;
        fs.writeFileSync(arquivo, JSON.stringify(entrou, null, 2) + '\n');
        grupo = { jid, nome: item.titulo };
        await avisar(`Entrei no grupo do WhatsApp "${item.titulo}" com o chip do bot (só leio, não mando nada lá). As ofertas da Amazon e do Mercado Livre de lá entram nos seus grupos com as suas regras.`);
      } catch (e) {
        const motivo = String(e.message || e).split('\n')[0];
        log(`⚠️  Não consegui entrar no grupo do WhatsApp "${item.titulo}": ${motivo}`);
        await avisar(`Não consegui entrar no grupo do WhatsApp "${item.titulo}" com o chip do bot. Abra o convite no celular do chip e toque em "Entrar no grupo": em até 30 min o bot acha o grupo pelo nome e começa a copiar.`, { falhou: true });
        continue;
      }
    }
    if (!grupo) {
      if (!entrar) continue;
      log(`⚠️  O chip do bot não está no grupo do WhatsApp "${item.titulo}" e não há convite em config/fontes.json.`);
      continue;
    }
    const f = fonteDoGrupoTelegram(c, { jid: grupo.jid, titulo: item.titulo }, { nichos, lojasParceiras });
    if (f) fontes.push({ ...f, nome: grupo.nome, nomeWhats: grupo.nome });
  }
  return fontes;
}
