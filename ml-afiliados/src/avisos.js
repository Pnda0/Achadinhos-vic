/**
 * Alertas e resumo diário no WhatsApp do dono do bot.
 *
 * Destino (AVISOS_DESTINO no .env):
 *   - nome de um grupo do WhatsApp (recomendado: crie "Avisos do bot" só com você e o número do bot), ou
 *   - número com DDI+DDD, só dígitos (ex.: 5579999998888).
 * Sem destino, os avisos ficam só no log (data/bot.log).
 *
 * Cada tipo de alerta é enviado no máximo 1 vez a cada `intervaloHoras` para não virar spam.
 */
import { settings } from './config.js';
import { diaLocal, formatBRL, log } from './util.js';

const HORA = 3_600_000;
const primeiraLinha = (e) => String(e?.message || e).split('\n')[0].slice(0, 200);

/** Texto do resumo do dia (função pura, testável). */
export function montarResumo(store, { dia = diaLocal(new Date(), settings.tz), grupos = [] } = {}) {
  const ativos = grupos.filter((g) => g.ativo).map((g) => g.nome);
  const doDia = (iso) => iso && diaLocal(new Date(iso), settings.tz) === dia;
  const enviados = store.list((p) => p.status === 'ENVIADO' && doDia(p.enviadoEm));
  const erros = store.list((p) => p.status === 'ERRO' && (!ativos.length || ativos.includes(p.grupo)));
  const naFila = store.list((p) => p.status === 'PRONTO' && (!ativos.length || ativos.includes(p.grupo)));
  const st = store.statsDoDia(dia);
  const [a, m, d] = dia.split('-');

  const linhas = [`📊 *Resumo do dia ${d}/${m}/${a}*`, ''];
  linhas.push(`📤 Ofertas postadas: *${enviados.length}*`);
  const porCat = {};
  for (const p of enviados) porCat[p.categoria || p.origem || 'outras'] = (porCat[p.categoria || p.origem || 'outras'] || 0) + 1;
  for (const [c, n] of Object.entries(porCat).sort((x, y) => y[1] - x[1])) linhas.push(`   • ${c}: ${n}`);
  const semImagem = enviados.filter((p) => p.semImagem).length;
  if (semImagem) linhas.push(`🖼️ Foram sem imagem: ${semImagem}`);
  if (erros.length) linhas.push(`❌ Falharam no envio: ${erros.length}`);
  if (enviados.length) {
    const melhor = [...enviados].sort((x, y) => (y.descontoPct || 0) - (x.descontoPct || 0))[0];
    linhas.push(`🏆 Maior desconto: ${melhor.nome.slice(0, 50)} — ${formatBRL(melhor.precoAtual)}${melhor.descontoPct ? ` (${melhor.descontoPct}% OFF)` : ''}`);
  }

  linhas.push('');
  if (st) {
    linhas.push(`🔎 Buscas no ML: ${st.coletas} — ${st.encontrados} produtos vistos, ${st.novos} aprovados`);
    const cats = Object.entries(st.categorias || {}).sort((x, y) => y[1].aceitos - x[1].aceitos);
    for (const [c, x] of cats) linhas.push(`   • ${c}: ${x.aceitos} de ${x.encontrados}`);
    const rec = Object.entries(st.recusas || {}).sort((x, y) => y[1] - x[1]);
    if (rec.length) linhas.push(`🚫 Recusados: ${rec.map(([k, v]) => `${k} ${v}`).join(', ')}`);
  } else {
    linhas.push('🔎 Nenhuma busca no ML registrada hoje.');
  }
  linhas.push(`📦 Sobraram na fila: ${naFila.length}${naFila.length ? ' (a fila é limpa à meia-noite)' : ''}`);
  return linhas.join('\n');
}

export class Avisos {
  constructor({ sender, store, destino = settings.avisos.destino, intervaloHoras = 3, agora = () => Date.now() } = {}) {
    this.sender = sender;
    this.store = store;
    this.destino = destino;
    this.intervalo = intervaloHoras * HORA;
    this.agora = agora;
    this.jid = null;
    this.ultimo = {};
  }

  /** Descobre o JID do destino. Chamar depois do WhatsApp conectar. */
  async iniciar() {
    if (!this.destino) {
      log('🔔 Avisos só no log (preencha AVISOS_DESTINO no .env para receber no WhatsApp).');
      return null;
    }
    try {
      if (this.sender.tipo === 'telegram' && /^(-?\d+|@\w+)$/.test(this.destino.trim())) {
        this.jid = this.destino.trim(); // chat id ou @canal do Telegram
      } else if (/^\+?\d{10,15}$/.test(this.destino.replace(/[\s()-]/g, ''))) {
        const num = this.destino.replace(/\D/g, '');
        this.jid = (await this.sender.jidDoNumero?.(num)) || `${num}@c.us`;
      } else if (this.destino.endsWith('@g.us') || this.destino.endsWith('@c.us')) {
        this.jid = this.destino;
      } else {
        const alvo = this.destino.trim().toLowerCase();
        const grupos = await this.sender.listGroups();
        const g = grupos.find((x) => String(x.nome).trim().toLowerCase() === alvo);
        if (!g) {
          log(`⚠️  Avisos: não achei o grupo "${this.destino}" neste WhatsApp. Os avisos ficam só no log.`);
          return null;
        }
        this.jid = g.jid;
      }
      log(`🔔 Avisos e resumo diário vão para: ${this.destino}`);
      return this.jid;
    } catch (e) {
      log(`⚠️  Avisos: não consegui preparar o destino (${primeiraLinha(e)}). Ficam só no log.`);
      return null;
    }
  }

  /** Envia um aviso. Mesmo `tipo` só sai 1 vez por intervalo (a menos que `sempre`). */
  async avisar(tipo, texto, { sempre = false } = {}) {
    const t = this.agora();
    if (!sempre && tipo in this.ultimo && t - this.ultimo[tipo] < this.intervalo) return false;
    this.ultimo[tipo] = t;
    log(`🔔 ${texto.replace(/\n+/g, ' | ')}`);
    if (!this.jid) return false;
    try {
      await this.sender.sendText(this.jid, `🤖 ${texto}`);
      return true;
    } catch (e) {
      log(`  (não consegui mandar o aviso no WhatsApp: ${primeiraLinha(e)})`);
      return false;
    }
  }

  ligado({ grupos = [] } = {}) {
    const ativos = grupos.filter((g) => g.ativo).map((g) => g.nome).join(', ') || 'nenhum';
    return this.avisar(
      'ligado',
      `*Bot ligado* ✅\nGrupos ativos: ${ativos}\nBuscas: ${settings.cron.coleta} | Envios: ${settings.cron.envio}`,
      { sempre: true }
    );
  }

  /** Erro numa tarefa agendada (coleta, envio, limpeza). */
  erroTarefa(nome, e) {
    const msg = primeiraLinha(e);
    if (/Sessão do Mercado Livre expirada|HTTP 401|login/i.test(msg)) {
      return this.avisar(
        'sessao-ml',
        '*Sessão do Mercado Livre expirou* ⚠️\nSem ela o bot não gera links de afiliado.\nCopie os cookies de novo (F12 no site do ML, como da primeira vez), salve em data/cookies.txt e reinicie o bot.\nNa nuvem (Render): cole os cookies novos em ML_COOKIES (aba Environment) e salve — o bot reinicia sozinho.'
      );
    }
    return this.avisar(`erro-${nome}`, `*Erro na ${nome}* ❌\n${msg}`);
  }

  coletaVazia() {
    return this.avisar(
      'coleta-vazia',
      '*A busca no Mercado Livre não trouxe nenhum produto* ⚠️\nPode ser bloqueio temporário ou o ML mudou a página. Vou tentar de novo na próxima busca.'
    );
  }

  filaVazia(grupo) {
    return this.avisar(`fila-${grupo}`, `*Acabaram as ofertas do grupo ${grupo}* 📭\nO bot fica sem postar até a próxima busca (${settings.cron.coleta}).`);
  }

  falhaEnvio(grupo, p) {
    return this.avisar(`envio-${grupo}`, `*Falha ao postar no grupo ${grupo}* ❌\n${String(p.erro || '').split('\n')[0].slice(0, 200)}\nVou tentar as próximas ofertas normalmente.`);
  }

  espelhoPausado(motivo, minutos) {
    return this.avisar('espelho', `*Espelho pausado por ${minutos} min* ⏸️\n${motivo}`);
  }

  resumoDiario(grupos) {
    return this.avisar('resumo', montarResumo(this.store, { grupos }), { sempre: true });
  }
}
