# Servidor Linux: conectar por SSH e levar o bot para lá

Guia passo a passo para tirar o bot do PC de casa e deixar ele rodando no seu servidor Linux.
Os comandos com **PC** vão no PowerShell do Windows; os com **servidor** vão dentro do SSH.

> ⚠️ **Nunca os dois ligados.** Bot no PC de casa e no servidor ao mesmo tempo = cada oferta sai duas vezes.
> O passo 4 desliga o de casa sozinho.

O que o servidor precisa: Ubuntu 22.04/24.04 ou Debian 12 (64 bits), 2 GB de memória ou mais, ~10 GB de disco.
Se for outro sistema, me avise antes.

---

## 1. Descobrir o endereço do servidor

- **Servidor em casa:** na tela do próprio servidor, rode `hostname -I`. O primeiro número (ex.: `192.168.0.50`) é o endereço.
- **Servidor alugado (VPS):** o endereço (IP) e o usuário vêm no e-mail ou no painel da empresa.

Anote: **endereço** (ex.: `192.168.0.50`) e **usuário** (ex.: `alan`).

## 2. Primeira conexão (com senha)

**PC** (PowerShell):

```powershell
ssh alan@192.168.0.50
```

Troque `alan` e `192.168.0.50` pelos seus. Na primeira vez ele pergunta *"Are you sure you want to continue connecting?"*: digite `yes`. Depois, a senha do usuário (não aparece nada enquanto digita, é normal).

Entrou quando aparecer algo como `alan@servidor:~$`. Para sair: `exit`.

## 3. Entrar sem senha e com um nome curto (uma vez só)

Assim você (e o Claude, aqui do PC) entram com `ssh achadinhos`, sem digitar senha.

**PC** — cria a chave (aperte Enter em todas as perguntas, sem senha; se perguntar *"Overwrite (y/n)?"*, responda `n`: você já tem uma e ela serve):

```powershell
ssh-keygen -t ed25519
```

**PC** — manda a chave para o servidor (pede a senha uma última vez):

```powershell
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh alan@192.168.0.50 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**PC** — cria o apelido `achadinhos` (troque o endereço e o usuário):

```powershell
Add-Content -Path $env:USERPROFILE\.ssh\config -Value "`nHost achadinhos`n    HostName 192.168.0.50`n    User alan"
```

Teste: `ssh achadinhos` deve entrar direto, sem senha.

> Usa o VS Code? Instale a extensão **Remote - SSH**, aperte `F1` → *Remote-SSH: Connect to Host* → `achadinhos`.

## 4. Instalar e levar o bot

**Servidor** — instala Node, Chrome, o bot em `/opt/achadinhos` e o serviço que liga sozinho (uns 5 min):

```bash
sudo bash -c "curl -fsSL https://raw.githubusercontent.com/Pnda0/Achadinhos-vic/main/ml-afiliados/linux/instalar.sh | bash"
```

**PC** — desliga o bot de casa, tira ele do início automático do Windows e junta os segredos num arquivo na pasta Downloads:

```powershell
cd D:\Github\Achadinhos-vic\ml-afiliados
npm run migrar
```

Ele mostra o nome do arquivo, algo como `achadinhos-migracao-2026-10-28.tar.gz`.

**PC** — manda o arquivo para o servidor (troque a data pela do seu arquivo):

```powershell
scp $env:USERPROFILE\Downloads\achadinhos-migracao-2026-10-28.tar.gz achadinhos:/tmp/
```

**Servidor** — põe tudo no lugar e liga o bot:

```bash
sudo bash /opt/achadinhos/ml-afiliados/linux/receber.sh /tmp/achadinhos-migracao-2026-10-28.tar.gz
```

Em ~1 minuto chega no seu Telegram o **código do WhatsApp**: no celular do chip do bot → WhatsApp → *Aparelhos conectados* → *Conectar com número de telefone* → digite o código.

**Servidor** — deixa o Claude cuidar do bot daqui do PC (reiniciar, ver o log) sem pedir senha:

```bash
sudo bash /opt/achadinhos/ml-afiliados/linux/liberar-claude.sh
```

**Apague o arquivo da mudança nos dois lados** (tem senhas):

```bash
rm /tmp/achadinhos-migracao-*.tar.gz
```

```powershell
del $env:USERPROFILE\Downloads\achadinhos-migracao-*.tar.gz
```

Pronto. Me avise que eu confiro o log por aqui.

## 5. Dia a dia

Todos no **servidor** (depois do `ssh achadinhos`):

| Para quê | Comando |
|---|---|
| Ver o que o bot está fazendo (sair: `Ctrl+C`) | `journalctl -u ml-afiliados -f` |
| Só o log do bot | `tail -f /opt/achadinhos/ml-afiliados/data/bot.log` |
| Reiniciar (já puxa o código novo do GitHub) | `sudo systemctl restart ml-afiliados` |
| Parar / ligar | `sudo systemctl stop ml-afiliados` / `sudo systemctl start ml-afiliados` |
| Está ligado? | `systemctl status ml-afiliados` |
| Números de hoje | `cd /opt/achadinhos/ml-afiliados && sudo -u bot npm run analytics -- hoje` |

O bot liga sozinho quando o servidor liga e religa sozinho se cair.

**Sessão do Mercado Livre vencida** (o bot avisa no Telegram): copie o `cookie` pelo F12 no seu navegador como sempre e me mande; eu ponho no servidor. Ou, no servidor: `sudo nano /opt/achadinhos/ml-afiliados/data/cookies.txt`, cole, `Ctrl+O`, Enter, `Ctrl+X` e reinicie.

## 6. Voltar para o PC de casa

1. **Servidor:** `sudo systemctl stop ml-afiliados && sudo systemctl disable ml-afiliados`
2. **PC:** `Win+R` → `shell:startup` → no atalho do `3-iniciar.bat`, tire o `.desligado` do nome.
3. **PC:** abra o `3-iniciar.bat`.

## Deu problema?

| Mensagem | O que fazer |
|---|---|
| `ssh` não é reconhecido | Windows: Configurações → Sistema → Recursos opcionais → adicionar **Cliente OpenSSH** |
| `Connection timed out` | Endereço errado, servidor desligado ou fora da rede. Confira o `hostname -I` |
| `Connection refused` | Falta o SSH no servidor. Na tela dele: `sudo apt install -y openssh-server && sudo systemctl enable --now ssh` |
| `Permission denied` | Usuário ou senha errados (passo 2) |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` | O servidor foi reinstalado. **PC:** `ssh-keygen -R 192.168.0.50` e conecte de novo |
| Firewall ligado (`ufw`) | **Servidor:** `sudo ufw allow OpenSSH` |
