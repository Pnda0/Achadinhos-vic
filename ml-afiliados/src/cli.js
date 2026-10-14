#!/usr/bin/env node
/**
 * Comandos manuais (para testar cada etapa separada):
 *   npm run login-ml           -> abre o navegador para você logar no ML e guarda a sessão
 *   npm run coletar            -> busca ofertas das categorias ativas
 *   npm run links              -> gera os links de afiliado pendentes
 *   npm run enviar [-- Geral]  -> envia 1 oferta para cada grupo ativo (ou só o grupo informado)
 *   npm run status             -> mostra a fila por grupo
 *   npm run resumo [-- 2026-10-08] -> mostra o resumo do dia (o mesmo que vai no WhatsApp às 22h)
 *   npm run grupos             -> conecta no WhatsApp e lista os grupos com o JID
 *   npm run testar-afiliado    -> testa cookies + tag gerando 1 link
 *   npm run limpar             -> esvazia a fila (mantém o histórico de enviados)
 *   npm run fontes -- "Grupo A" "Grupo B"  -> define os grupos-fonte do espelho (sem nomes: mostra os atuais)
 *   npm run testar-espelho -- <link>       -> mostra como ficaria a oferta a partir de um link de outro grupo
 *   npm run testar-amazon [-- "air fryer"] -> testa as credenciais da Amazon e mostra 5 ofertas
 *   npm run telegram                       -> (SENDER=telegram) mostra os chats que o bot já viu, com o chat id
 *   npm run awin                           -> testa o token da Awin e mostra as lojas aprovadas, pendentes e os cupons
 *   npm run awin -- link <url>             -> gera o seu link de afiliado da Awin para uma página de loja parceira
 */
import { coletar, gerarLinks, enviarParaTodos, enviarProximo, limpar } from './pipeline.js';
import { createSender } from './senders.js';
import { loadGrupos } from './config.js';
import { MLAffiliate } from './ml/affiliate.js';
import { loginML, loginMLNavegadorComum } from './ml/login.js';
import { setEnvVar } from './configfile.js';
import { resolverOferta } from './ml/resolver.js';
import { montarLegenda, tituloPronto } from './caption.js';
import { setFontes } from './configfile.js';
import { loadFontes } from './config.js';
import { Store } from './store.js';
import { montarResumo } from './avisos.js';
import { AmazonAPI, loadBuscasAmazon } from './amazon.js';
import { Awin, buscarCuponsAwin, loadAwin, resolverLinkLoja } from './awin.js';
import { log } from './util.js';
import { instalarLogEmArquivo, registrarErro } from './logfile.js';
import { travarInstancia } from './instancia.js';

instalarLogEmArquivo(`cli ${process.argv.slice(2).join(' ')}`);

const [cmd, arg, ...resto] = process.argv.slice(2);

// Comandos que gravam na fila (data/db.json) não podem rodar junto com o bot: um apagaria o que o outro gravou.
const GRAVAM_NA_FILA = new Set(['coletar', 'links', 'enviar', 'limpar']);

async function main() {
  if (GRAVAM_NA_FILA.has(cmd) && !(await travarInstancia()).ok) {
    throw new Error('O bot está rodando (janela do 3-iniciar.bat). Use o bot ou feche a janela dele antes de rodar este comando.');
  }
  switch (cmd) {
    case 'login-ml': {
      // Navegador comum (o ML bloqueia login em janela de automação); "-- automacao" usa o jeito antigo.
      const { tags } = arg === 'automacao' ? await loginML() : await loginMLNavegadorComum();
      if (!process.env.ML_AFFILIATE_TAG?.trim() && tags.length) {
        setEnvVar('ML_AFFILIATE_TAG', tags[0]);
        log(`🏷️  Etiqueta "${tags[0]}" gravada em ML_AFFILIATE_TAG no .env${tags.length > 1 ? ` (a conta tem ${tags.length}: ${tags.join(', ')} — troque lá se quiser outra)` : ''}.`);
      }
      break;
    }
    case 'coletar':
      await coletar();
      break;
    case 'links':
      await gerarLinks();
      break;
    case 'enviar': {
      const sender = createSender();
      await sender.init();
      try {
        if (arg) {
          const g = loadGrupos().find((x) => x.nome.toLowerCase() === arg.toLowerCase());
          if (!g) throw new Error(`Grupo "${arg}" não está em config/grupos.json`);
          await enviarProximo(sender, g);
        } else {
          await enviarParaTodos(sender);
        }
      } finally {
        await sender.close();
      }
      break;
    }
    case 'status': {
      const s = new Store();
      console.table(s.resumo());
      const prox = s.list((p) => p.status === 'PRONTO').slice(0, 5);
      for (const p of prox) console.log(`  • [${p.grupo}] ${p.descontoPct}% — ${p.nome.slice(0, 60)} — ${p.linkAfiliado}`);
      break;
    }
    case 'telegram': {
      const { TelegramSender } = await import('./telegram.js');
      const tg = new TelegramSender();
      await tg.init();
      const chats = await tg.listGroups();
      if (!chats.length) log('Nenhum chat ainda. Adicione o bot ao canal/grupo, mande uma mensagem lá (e /start no privado do bot) e rode de novo.');
      for (const c of chats) console.log(`  ${c.tipo.padEnd(10)} ${c.jid.padEnd(16)} ${c.nome}`);
      break;
    }
    case 'testar-amazon': {
      const api = new AmazonAPI();
      if (!api.configurada()) throw new Error('Preencha AMAZON_CREDENTIAL_ID, AMAZON_CREDENTIAL_SECRET e AMAZON_PARTNER_TAG no .env');
      await api.obterToken();
      log('✅ Credenciais da Amazon aceitas.');
      const termo = [arg, ...resto].filter(Boolean).join(' ') || 'fone bluetooth';
      const cfg = loadBuscasAmazon();
      const itens = await api.buscar({ keywords: termo, searchIndex: 'All', itemCount: 10 }, { grupo: 'Geral', minSavingPercent: cfg.minSavingPercent || 20 });
      log(`🔎 "${termo}": ${itens.length} oferta(s) com desconto.`);
      for (const p of itens.slice(0, 5)) {
        console.log('\n' + montarLegenda(p, { titulo: tituloPronto(p) }) + `\n🖼️  ${p.imagem}`);
      }
      break;
    }
    case 'awin': {
      const api = new Awin();
      if (!api.cfg.token) throw new Error('Preencha AWIN_API_TOKEN no .env (crie o token em https://ui.awin.com/awin-api).');
      log(`✅ Token da Awin aceito. Seu id de afiliado (publisher): ${await api.publisher()}`);
      if (arg === 'link') {
        const url = resto[0];
        if (!url) throw new Error('Informe o link: npm run awin -- link https://www.loja.com.br/produto');
        const achado = await resolverLinkLoja(url, await api.anunciantes());
        if (!achado?.url) throw new Error('Esse link não é de uma loja em que a sua conta da Awin foi aprovada.');
        console.log(`\n${achado.anunciante.nome}: ${await api.gerarLink(achado.anunciante, achado.url)}\n`);
        break;
      }
      const cfg = loadAwin();
      const doArquivo = new Map(cfg.anunciantes.map((a) => [Number(a.id), a]));
      const aprovadas = await api.programas('joined');
      const pendentes = await api.programas('pending').catch(() => []);
      console.log(`\nLojas APROVADAS (${aprovadas.length}) — o bot já usa:`);
      for (const p of aprovadas) console.log(`  ✅ ${p.nome} [${p.id}] → ${doArquivo.get(p.id)?.grupos?.join(', ') || `só no ${cfg.grupoGeral} (para pôr num grupo de nicho, acrescente em config/awin.json)`}`);
      console.log(`\nPedidos EM ANÁLISE (${pendentes.length}):`);
      for (const p of pendentes) console.log(`  ⏳ ${p.nome} [${p.id}]`);
      const vistas = new Set([...aprovadas, ...pendentes].map((p) => p.id));
      const faltam = cfg.anunciantes.filter((a) => !vistas.has(Number(a.id)));
      console.log(`\nRecomendadas em que você AINDA NÃO pediu para entrar (${faltam.length}):`);
      for (const a of faltam) console.log(`  ➕ ${a.nome} (${a.grupos.join(', ')}) — https://ui.awin.com/merchant-profile/${a.id}${a.pf === 'nao' ? '  [só com CNPJ]' : ''}`);
      const r = await buscarCuponsAwin({ api, grupos: loadGrupos() });
      console.log(`\nCupons e promoções: ${r.motivo || `${r.produtos.length} prontos para os grupos (de ${Object.values(r.categorias)[0]?.encontrados ?? 0} ativos na Awin).`}`);
      for (const p of (r.produtos || []).slice(0, 3)) console.log(`\n[${p.grupo}]\n${montarLegenda(p)}`);
      break;
    }
    case 'resumo':
      console.log(montarResumo(new Store(), { dia: arg || undefined, grupos: loadGrupos() }));
      break;
    case 'grupos': {
      const sender = createSender();
      await sender.init();
      const grupos = await sender.listGroups();
      console.table(grupos);
      log('Copie o JID do grupo para config/grupos.json');
      await sender.close();
      break;
    }
    case 'testar-afiliado': {
      const aff = new MLAffiliate();
      const r = await aff.refresh();
      log(`Link Builder respondeu HTTP ${r.status}; CSRF ${r.csrf ? 'encontrado' : 'NÃO encontrado'}`);
      const url = arg || 'https://www.mercadolivre.com.br/controle-playstation-dualshock-4-berry-blue-ps4/p/MLB15085750';
      const links = await aff.createLinks([url]);
      log(links.size ? `✅ Funcionou! ${url} -> ${[...links.values()][0]}` : '⚠️  O ML respondeu, mas sem link. Confira a tag.');
      break;
    }
    case 'limpar':
      limpar();
      break;
    case 'fontes': {
      const nomes = [arg, ...resto].filter(Boolean);
      if (nomes.length) setFontes(nomes);
      const { fontes, ativo } = loadFontes();
      console.log(`Espelho ${ativo ? 'ligado' : 'desligado'}. Grupos-fonte:`);
      console.log(fontes.length ? fontes.map((f) => `  • ${f.nome} → ${f.destino || 'Geral'}`).join('\n') : '  (nenhum)');
      if (nomes.length) console.log('Reinicie o bot para valer.');
      break;
    }
    case 'testar-espelho': {
      if (!arg) throw new Error('Informe o link: npm run testar-espelho -- https://meli.la/XXXX');
      const produto = await resolverOferta(arg);
      log(`Produto: ${produto.nome} (${produto.id}) — ${produto.url}`);
      const aff = new MLAffiliate();
      await aff.refresh();
      const link = [...(await aff.createLinks([produto.url])).values()][0];
      console.log('\n' + montarLegenda({ ...produto, linkAfiliado: link }, { titulo: tituloPronto(produto) }) + `\n\n🖼️  ${produto.imagem}\n`);
      break;
    }
    default:
      console.log('Comandos: fontes [nomes] | testar-espelho <link> | testar-amazon [termo] | awin [link <url>] | telegram | login-ml | coletar | links | enviar [grupo] | status | resumo [AAAA-MM-DD] | grupos | testar-afiliado [url] | limpar');
      process.exitCode = 1;
  }
}

main().catch((e) => {
  registrarErro('cli', e);
  log('❌', e.message);
  process.exitCode = 1;
});
