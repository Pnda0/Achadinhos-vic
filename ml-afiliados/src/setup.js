#!/usr/bin/env node
/**
 * Assistente de configuração — `npm run configurar` (ou 2-configurar.bat).
 * Faz, em ordem: navegador → login do ML → etiqueta → coleta → links → WhatsApp → grupo → envio de teste.
 * Pode rodar quantas vezes quiser: ele pula o que já está pronto.
 */
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadGrupos, settings } from './config.js';
import { findBrowserPath } from './browser.js';
import { MLAffiliate, loadCookies } from './ml/affiliate.js';
import { loginMLNavegadorComum } from './ml/login.js';
import { travarInstancia } from './instancia.js';
import { coletar, gerarLinks, enviarProximo } from './pipeline.js';
import { estiloDoProduto, montarLegenda, tituloPronto } from './caption.js';
import { createSender } from './senders.js';
import { Store } from './store.js';
import { encontrarGrupo, jidConfigurado, setEnvVar, setGrupoCampos, setGrupoJid } from './configfile.js';
import { instalarLogEmArquivo, registrarErro } from './logfile.js';

instalarLogEmArquivo('configurar');

const rl = readline.createInterface({ input: stdin, output: stdout });
const titulo = (n, t) => console.log(`\n━━━ Passo ${n} — ${t} ${'━'.repeat(Math.max(3, 44 - t.length))}`);
const perguntar = async (q) => (await rl.question(`${q} `)).trim();
const simNao = async (q, padrao = true) => {
  const r = (await perguntar(`${q} ${padrao ? '[S/n]' : '[s/N]'}`)).toLowerCase();
  return r === '' ? padrao : r.startsWith('s') || r.startsWith('y');
};

async function passoML() {
  titulo(2, 'Login do Mercado Livre');
  let tags = null;
  let logado = false;
  if (loadCookies()) {
    try {
      await new MLAffiliate({ tag: settings.affiliateTag || 'x' }).refresh();
      logado = true;
      console.log('✅ Sessão do ML válida (cookies de data/cookies.txt).');
    } catch (e) {
      console.log('⚠️  Encontrei cookies salvos (data/cookies.txt), mas o Mercado Livre não aceitou:');
      console.log(`    ${e.message}`);
      if (!(await simNao('Tentar o login pela janela do bot?', false))) {
        throw new Error('Login do ML pendente. Copie a mensagem acima e mande para o Claude.');
      }
    }
  }
  if (!logado) {
    console.log('Vou abrir uma janela do navegador. Faça login na sua conta de AFILIADO do Mercado Livre.');
    console.log('(Sua senha é digitada direto no site do ML — o bot não a vê nem guarda.)');
    console.log('Use e-mail + senha/código. O botão "Continuar com o Google" não funciona nessa janela.');
    await perguntar('Aperte ENTER para abrir a janela...');
    ({ tags } = await loginMLNavegadorComum());
  }

  // Etiqueta
  if (tags?.length && !tags.includes(settings.affiliateTag)) {
    let escolhida = tags[0];
    if (tags.length > 1) {
      tags.forEach((t, i) => console.log(`  ${i + 1}) ${t}`));
      const n = parseInt(await perguntar('Qual etiqueta usar? (número)'), 10);
      escolhida = tags[n - 1] || tags[0];
    }
    if (settings.affiliateTag) console.log(`⚠️  A etiqueta "${settings.affiliateTag}" do .env não existe nessa conta.`);
    setEnvVar('ML_AFFILIATE_TAG', escolhida);
    settings.affiliateTag = escolhida;
    console.log(`✅ Etiqueta gravada no .env: ${escolhida}`);
  } else if (!settings.affiliateTag) {
    const t = await perguntar('Qual é a sua etiqueta de afiliado? (Central de Afiliados > Administrar etiquetas)');
    if (!t) throw new Error('Sem etiqueta não dá para gerar links.');
    setEnvVar('ML_AFFILIATE_TAG', t);
    settings.affiliateTag = t;
  } else {
    console.log(`✅ Etiqueta: ${settings.affiliateTag}`);
  }
}

async function passoOfertas(store, grupos) {
  titulo(3, 'Buscar ofertas e gerar links');
  const prontos = () => store.list((p) => p.status === 'PRONTO').length;
  if (prontos()) {
    console.log(`✅ Já existem ${prontos()} oferta(s) prontas na fila — pulando a coleta.`);
  } else {
    console.log('Isso leva de 1 a 3 minutos (o bot espera entre as chamadas para não parecer robô).');
    await coletar(store);
    await gerarLinks(store, new MLAffiliate({ tag: settings.affiliateTag }));
  }
  if (!prontos()) throw new Error('Nenhuma oferta ficou pronta. Veja as mensagens acima (filtros muito apertados? ML fora do ar?).');

  const g = grupos.find((x) => x.ativo) || grupos[0];
  const p = store.proximo(g.nome) || store.list((x) => x.status === 'PRONTO')[0];
  console.log('\nExemplo de mensagem que vai para o grupo:\n' + '─'.repeat(46));
  console.log(montarLegenda(p, { titulo: tituloPronto(p, estiloDoProduto(p, g).titulos), mensagemAdicional: g.mensagemAdicional }));
  console.log('─'.repeat(46));
}

async function passoWhatsApp(store) {
  titulo(4, 'WhatsApp');
  console.log('Recomendo: use um número separado do seu pessoal e crie um grupo de TESTE só com você.');
  if (!(await simNao('Conectar o WhatsApp agora?'))) {
    console.log('Ok. Quando quiser, rode o assistente de novo.');
    return;
  }
  settings.sender = 'wwebjs';
  const sender = createSender('wwebjs');
  try {
    await sender.init();
    setEnvVar('SENDER', 'wwebjs');
    const lista = (await sender.listGroups()).sort((a, b) => a.nome.localeCompare(b.nome));
    if (!lista.length) throw new Error('Esse WhatsApp não participa de nenhum grupo. Crie um grupo e rode de novo.');
    console.log('\nSeus grupos:');
    lista.forEach((g, i) => console.log(`  ${String(i + 1).padStart(3)}) ${g.nome}`));

    for (const g of loadGrupos().filter((x) => x.ativo || x.emEspera)) {
      const atual = jidConfigurado(g) ? ` (atual: ${lista.find((x) => x.jid === g.jid)?.nome || g.jid})` : '';
      console.log(`\nQual grupo do WhatsApp recebe as ofertas "${g.nome}"?${atual}`);
      for (let tentativa = 0; tentativa < 5; tentativa++) {
        const r = await perguntar('Digite o NÚMERO da lista ou o NOME do grupo (ENTER para não mudar):');
        if (!r) break;
        const { grupo, varios } = encontrarGrupo(lista, r);
        if (grupo) {
          setGrupoJid(g.nome, grupo.jid);
          console.log(`✅ "${g.nome}" → ${grupo.nome}`);
          if (!g.mensagemAdicional) {
            const convite = await perguntar('Link de convite do grupo para pôr no fim de cada oferta (ENTER para não pôr):');
            if (/^https:\/\/chat\.whatsapp\.com\/\S+$/.test(convite)) {
              setGrupoCampos(g.nome, { mensagemAdicional: `🔗 Convide um amigo para o grupo: ${convite}` });
              console.log('✅ Convite gravado.');
            } else if (convite) {
              console.log('Isso não parece um link https://chat.whatsapp.com/... — deixei sem convite.');
            }
          }
          break;
        }
        if (varios) {
          console.log('Achei mais de um com esse nome — digite o número:');
          varios.forEach((x) => console.log(`  ${String(lista.indexOf(x) + 1).padStart(3)}) ${x.nome}`));
        } else {
          console.log('Não achei esse grupo na lista. Tente de novo.');
        }
      }
    }

    titulo(5, 'Envio de teste');
    for (const g of loadGrupos().filter((x) => x.ativo && jidConfigurado(x))) {
      const nomeZap = lista.find((x) => x.jid === g.jid)?.nome || g.jid;
      if (await simNao(`Enviar 1 oferta AGORA para o grupo "${nomeZap}"?`, false)) {
        const p = await enviarProximo(sender, g, store);
        console.log(p?.status === 'ENVIADO' ? '✅ Enviado! Confira no WhatsApp.' : '⚠️  Não foi enviado — veja a mensagem acima (detalhes em data/bot.log).');
      }
    }
  } finally {
    await sender.close().catch(() => {});
  }
}

async function main() {
  console.log('\n🛒 ml-afiliados — assistente de configuração\n');
  // O assistente busca ofertas e grava a fila: não pode rodar com o bot ligado (um apagaria o que o outro gravou).
  if (!(await travarInstancia()).ok) throw new Error('O bot está rodando (janela do 3-iniciar.bat). Feche a janela dele antes de rodar o assistente.');

  titulo(1, 'Navegador');
  const nav = findBrowserPath();
  if (!nav) throw new Error('Não encontrei Chrome nem Edge. Instale o Chrome ou preencha CHROME_PATH no .env.');
  console.log(`✅ Vou usar: ${nav}`);

  await passoML();
  const store = new Store();
  await passoOfertas(store, loadGrupos());
  await passoWhatsApp(store);

  console.log('\n🎉 Pronto. Para deixar o bot rodando sozinho: dê dois cliques em "3-iniciar.bat" (ou rode: npm start).\n');
}

main()
  .catch((e) => {
    registrarErro('configurar', e);
    console.error(`\n❌ ${e.message}\n(os detalhes ficaram gravados em data/bot.log)\n`);
    process.exitCode = 1;
  })
  .finally(() => rl.close());
