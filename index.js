const prompt = require('prompt-sync')({ sigint: true });
const pool = require('./dbConnection'); // Importa a conexão com o banco de dados
const { getBotStatus, setBotStatus, io } = require('./Server');

require('dotenv').config();
console.log('✅ [dotenv@17.2.2] Injetando env (1) de .env -- tip: ⚙️ enable debug logging com { debug: true }');

const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const chatHistories = {};
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { initDatabase, getDb } = require('./Database');
const { startServer } = require('./Server');
const fs = require('fs');
const path = require('path');
const systemPrompt = fs.readFileSync(path.join(__dirname, 'systemPrompt.txt'), 'utf8');

// Sobrescrever o método logout para ignorar erros de exclusão
class CustomLocalAuth extends LocalAuth {
  async logout() {
    try {
      await super.logout();
    } catch (e) {
      console.warn('⚠️ Não foi possível excluir a sessão:', e.message);
    }
  }
}

// Configurações centralizadas
const config = {
  adminNumero: "557182547726@c.us",
  numeroPrincipal: "557182547726",
  contatoAtendente: "557182547726",
  notificacaoSecundaria: "557192577023",
  menuPrincipal: `🍕 *Bem-vindo à Pizzaria Sabor Italiano!* 😊\n` +
                 `1️⃣ - Fazer um pedido\n` +
                 `2️⃣ - Acompanhar pedido\n` +
                 `3️⃣ - Confirmar pagamento\n` +
                 `4️⃣ - Ver cardápio\n` +
                 `5️⃣ - Falar com um atendente\n` +
                 `💬 Digite o número da opção desejada (ex.: 1, 2, 3, 4, 5) ou *menu* para voltar.`,
  menuAdmin: `📋 *Menu Administrativo* 🔐\n` +
             `1️⃣ - Resetar atendimentos\n` +
             `2️⃣ - Resetar saudados\n` +
             `3️⃣ - Resetar cadastros\n` +
             `4️⃣ - Resetar banco inteiro\n` +
             `5️⃣ - Listar cadastros\n` +
             `6️⃣ - Exportar cadastros (CSV)\n` +
             `7️⃣ - Deletar cadastro específico\n` +
             `8️⃣ - Listar atendimentos em andamento\n` +
             `9️⃣ - Intervir em atendimento (parar bot)\n` +
             `🔟 - Reativar bot para usuário\n` +
             `1️⃣1️⃣ - Resetar saudação para usuário\n` +
             `1️⃣2️⃣ - Parar bot geral\n` +
             `1️⃣3️⃣ - Reativar bot geral\n` +
             `💬 Digite o número da opção desejada ou *cancelar* para voltar.`,
  respostas: {
    "1": `🍕 *Fazer um pedido:* 🛒\nClique no link para fazer seu pedido diretamente no nosso site: https://minhaloja.systemautojk.com.br/\n\n🔙 Digite *voltar* para o menu principal.`,
    "2": `📦 *Acompanhar pedido:* 🚚\nPor favor, informe o número do seu pedido para verificarmos o status. Um atendente irá ajudá-lo em breve.\n\nDigite *Finalizar atendimento* quando quiser voltar ao menu principal.`,
    "3": `💳 *Confirmar pagamento:* ✅\nPor favor, envie o ID da transação ou comprovante de pagamento para verificarmos. Um atendente irá ajudá-lo em breve.\n\nDigite *Finalizar atendimento* quando quiser voltar ao menu principal.`,
    "4": `📋 *Ver cardápio:* 🍕\nConfira nosso cardápio digital em: https://minhaloja.systemautojk.com.br/\nOu peça aqui e receba a lista de nossas pizzas! 😋\n\n🔙 Digite *voltar* para o menu principal.`,
    "5": `👨‍💼 *Falar com um atendente:* ⏳\nAguarde um momento, estamos encaminhando sua solicitação para um de nossos atendentes.\nPor favor, escreva como podemos ajudar para agilizarmos o atendimento.\n\nDigite *Finalizar atendimento* quando quiser voltar ao menu principal.`
  },
  timeoutAtendimento: 60 * 60 * 1000,
  geminiApiKey: process.env.GEMINI_API_KEY
};

const client = new Client({
  authStrategy: new CustomLocalAuth({
    dataPath: './.wwebjs_auth_custom'
  }),
  puppeteer: {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-logging',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ],
    executablePath: process.env.CHROMIUM_PATH || undefined
  }
});

const genAI = new GoogleGenerativeAI(config.geminiApiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let isClientReady = false;
let currentQRCode = null;

async function initializeBot() {
  try {
    await initDatabase();
    console.log('✅ Banco de dados inicializado com sucesso');
    const db = getDb();

    // Inicializar estado do bot
    const initialStatus = await getBotStatus(db);
    console.log(`✅ Estado inicial do bot: ${initialStatus}`);

    // Listener para atualizações de estado do bot via Socket.IO
    io.on('connection', async (socket) => {
      console.log('✅ Cliente conectado ao WebSocket:', socket.id);
      // Fetch the bot status when a client connects
      const currentBotStatus = await getBotStatus(db);
      socket.emit('botStatus', { isReady: isClientReady });
      socket.emit('botGlobalStatus', currentBotStatus); // Emit the current bot status
      if (!isClientReady && currentQRCode) {
        socket.emit('qrCode', currentQRCode);
        console.log('📡 Enviando QR code existente para novo cliente:', currentQRCode);
      }
      socket.on('botGlobalStatus', async (status) => {
        console.log(`🔄 Estado do bot atualizado via Socket.IO: ${status}`);
      });
      socket.on('requestQR', () => {
        console.log('🔄 Requisição de novo QR code recebida');
        if (!isClientReady) {
          currentQRCode = null;
          client.destroy().then(() => client.initialize());
        } else {
          socket.emit('botStatus', { isReady: true });
          console.log('ℹ️ Bot já está conectado, novo QR code não necessário');
        }
      });
      socket.on('disconnect', () => {
        console.log('🔌 Cliente desconectado do WebSocket:', socket.id);
      });
    });

    function atualizarUltimaMensagem(chatId) {
      const agora = Date.now();
      db.run(
        "UPDATE usuarios_atendidos SET ultima_mensagem = ? WHERE chat_id = ?",
        [agora, chatId],
        (err) => {
          if (err) {
            console.error('❌ Erro ao atualizar ultima_mensagem:', err.message);
          } else {
            console.log(`✅ ultima_mensagem atualizada para ${chatId}`);
          }
        }
      );
    }

    function resetarAtendimentosInativos() {
      const agora = Date.now();
      db.all("SELECT chat_id, ultima_mensagem FROM usuarios_atendidos", [], (err, rows) => {
        if (err) {
          console.error('❌ Erro ao consultar atendimentos inativos:', err.message);
          return;
        }
        rows.forEach(row => {
          if (agora - row.ultima_mensagem >= config.timeoutAtendimento) {
            db.run("DELETE FROM usuarios_atendidos WHERE chat_id = ?", [row.chat_id]);
            db.run("DELETE FROM usuarios_intervencao WHERE chat_id = ?", [row.chat_id], async (err) => {
              if (err) {
                console.error('❌ Erro ao resetar atendimento inativo:', err.message);
              } else {
                console.log(`✅ Atendimento inativo resetado para ${row.chat_id}`);
                try {
                  await client.sendMessage(row.chat_id, `🔄 Seu atendimento foi finalizado por inatividade. \n\n${config.menuPrincipal}`);
                } catch (err) {
                  console.error(`❌ Erro ao notificar usuário ${row.chat_id}:`, err.message);
                }
              }
            });
          }
        });
      });
    }

    setInterval(resetarAtendimentosInativos, 5 * 60 * 1000);

    client.on('qr', qr => {
      console.log('📲 QR Code gerado:', qr);
      console.log('Estado do cliente:', { isClientReady, clientInfo: client.info || 'N/A' });
      qrcode.generate(qr, { small: true });
      currentQRCode = qr;
      io.emit('qrCode', qr);
      console.log('📡 QR Code emitido via Socket.IO:', qr);
      setTimeout(() => {
        if (!isClientReady && currentQRCode === qr) {
          console.log('⚠️ QR code expirado, reiniciando...');
          currentQRCode = null;
          io.emit('qrCode', null);
          client.destroy().then(() => client.initialize());
        }
      }, 60000);
    });

    client.on('ready', () => {
      console.log('✅ Bot conectado e pronto para uso!');
      console.log('ℹ️ Informações do cliente:', JSON.stringify(client.info));
      isClientReady = true;
      currentQRCode = null;
      io.emit('qrCode', null);
      io.emit('botStatus', { isReady: true });
    });

    client.on('authenticated', () => {
      console.log('🔐 Autenticado com sucesso!');
      io.emit('qrCode', null);
    });

    client.on('auth_failure', msg => {
      console.error('❌ Falha na autenticação:', msg);
      isClientReady = false;
      io.emit('botStatus', { isReady: false });
    });

    client.on('disconnected', reason => {
      isClientReady = false;
      io.emit('botStatus', { isReady: false });
      currentQRCode = null;
      client.destroy().then(() => {
        client.initialize();
      }).catch(err => {
        console.error('⚠️ Erro ao destruir sessão:', err.message);
        client.initialize();
      });
    });

    client.on('message', async message => {
      const chatId = message.from;
      const mensagem = message.body.trim().toLowerCase().replace(/[^a-z0-9ç]/g, '');
      const mensagemOriginal = message.body.trim();

      let userName = 'Desconhecido';
      try {
        const contact = await client.getContactById(chatId);
        userName = contact.pushname || contact.name || 'Desconhecido';
      } catch (err) {
        console.error(`❌ Erro ao obter contato para ${chatId}:`, err.message);
      }

      console.log(`📩 Mensagem recebida de ${userName} (${chatId}): ${mensagemOriginal} (ID: ${message.id._serialized})`);

      const {
        logMessage,
        isUserInIntervencao,
        isUserInChatbotMode,
        addUserToChatbotMode,
        removeUserFromChatbotMode,
        isUserAtendido,
        addUserAtendido,
        isUserSaudado,
        addUserSaudado,
        getCadastroEstado,
        atualizarCadastroEstado,
        finalizarCadastro,
        salvarCadastroPermanente,
        validarNumero,
        armazenarAcaoPendente,
        verificarAcaoPendente,
        limparAcaoPendente,
        exportarCadastros,
        deletarCadastro,
        addIntervencao,
        removeIntervencao,
        listarAtendimentosAtivos,
        isBlockedNumber
      } = require('./Database');

      if (await isBlockedNumber(chatId)) {
        console.log(`🚫 Mensagem ignorada: ${chatId} está bloqueado.`);
        return;
      }

      // Verificar estado do bot no banco de dados
      const botStatus = await getBotStatus(db);
      console.log(`🔍 Estado do bot no banco: ${botStatus}`);
      if (botStatus === 'stopped' && chatId !== config.adminNumero) {
        console.log(`❌ Bot parado, ignorando mensagem de ${chatId}`);
        await client.sendMessage(chatId, "🍕 *Pizzaria Sabor Italiano* 🍕\n\nEstamos temporariamente fechados. Voltaremos em breve! 😊");
        return;
      }

      try {
        await logMessage(chatId, message.body);

        // Lock mechanism to prevent multiple greetings
        if (!chatHistories[chatId]) {
          chatHistories[chatId] = { isProcessing: false };
        }
        if (chatHistories[chatId].isProcessing) {
          console.log(`🔒 Mensagem de ${chatId} ignorada: processamento em andamento`);
          return;
        }
        chatHistories[chatId].isProcessing = true;

        try {
          if (await isUserInIntervencao(chatId)) {
            if (mensagem === "finalizaratendimento" || mensagem === "menu" || mensagem === "cancelar") {
              await removeIntervencao(chatId);
              db.run("DELETE FROM usuarios_atendidos WHERE chat_id = ?", [chatId], (err) => {
                if (err) console.error('❌ Erro ao finalizar atendimento:', err.message);
              });
              await client.sendMessage(chatId, `✅ Atendimento finalizado. \n\n${config.menuPrincipal}`);
              return;
            }
            console.log(`🤐 Bot pausado para ${chatId} - Mensagem ignorada pelo bot`);
            return;
          }

          if (await isUserAtendido(chatId)) {
            await atualizarUltimaMensagem(chatId);
          }

          if (mensagemOriginal.toLowerCase().startsWith('olá, novo pedido:')) {
            await addIntervencao(chatId);
            await addUserAtendido(chatId, config, 'novo_pedido');
            await client.sendMessage(chatId, `📩 *Novo pedido recebido!* Um atendente irá verificar seu pedido em breve. Por favor, aguarde.\n\nDigite *Finalizar atendimento* quando quiser voltar ao menu principal.`);
            const contact = await client.getContactById(chatId);
            const userName = contact.pushname || "cliente";
            const notificationMessage = `📩 *Novo pedido do site recebido:*\n\nNome: ${userName}\nNúmero: wa.me/${chatId.slice(0, -5)}\nDetalhes do pedido:\n${mensagemOriginal}`;
            try {
              await client.sendMessage(config.adminNumero, notificationMessage);
              await client.sendMessage(config.adminNumero, `ℹ️ Use *reativar ${chatId}* para reativar o bot para este usuário.`);
            } catch (err) {
              console.error('❌ Erro ao enviar notificação de novo pedido:', err.message);
            }
            return;
          }

          if (chatId === config.adminNumero && mensagemOriginal.toLowerCase().startsWith('reativar')) {
            const chatIdMatch = mensagemOriginal.match(/reativar\s+(.+)/);
            if (chatIdMatch) {
              const targetChatId = chatIdMatch[1].trim();
              if (targetChatId.endsWith('@c.us')) {
                await removeIntervencao(targetChatId);
                db.run("DELETE FROM usuarios_atendidos WHERE chat_id = ?", [targetChatId]);
                await client.sendMessage(chatId, `✅ Bot reativado para ${targetChatId}.`);
                await client.sendMessage(targetChatId, `🔄 Atendimento finalizado. \n\n${config.menuPrincipal}`);
              } else {
                await client.sendMessage(chatId, "❌ Chat ID inválido. Deve terminar com @c.us (ex.: 5511999999999@c.us)");
              }
            } else {
              await client.sendMessage(chatId, "❌ Formato inválido. Digite: reativar <chatId> (ex.: reativar 5511999999999@c.us)");
            }
            return;
          }

          // Check if user has been greeted
          const isSaudado = await isUserSaudado(chatId);
          console.log(`🔍 Verificando saudação para ${chatId}: isSaudado = ${isSaudado}`);
          if (!isSaudado) {
            console.log(`📩 Enviando saudação inicial para ${chatId}`);
            const contact = await client.getContactById(chatId);
            const userName = contact.pushname || "cliente";
            await addUserSaudado(chatId);
            await client.sendMessage(
              chatId,
              `👋 Olá, ${userName}! Bem-vindo(a) à Pizzaria Sabor Italiano! 🍕 Como posso ajudar você hoje? 😊\n\n${config.menuPrincipal}`
            );
            const notificationMessage = `📩 Novo cliente recebido:\n\nNome: ${userName}\nNúmero: wa.me/${chatId.slice(0, -5)}`;
            try {
              await client.sendMessage(config.numeroPrincipal + "@c.us", notificationMessage);
              await client.sendMessage(config.notificacaoSecundaria + "@c.us", notificationMessage);
            } catch (err) {
              console.error('❌ Erro ao enviar notificação:', err.message);
            }
            console.log(`✅ Saudação enviada para ${chatId} e marcada no banco`);
            return;
          }

          const acaoPendente = await verificarAcaoPendente(chatId);
          if ((chatId === config.adminNumero || chatId === config.notificacaoSecundaria + "@c.us") && (acaoPendente || mensagem === "mudarmenu")) {
            if (mensagem === "mudarmenu") {
              await armazenarAcaoPendente(chatId, 'menu_admin');
              await client.sendMessage(chatId, config.menuAdmin);
              return;
            }

            if (acaoPendente && acaoPendente.acao === 'menu_admin') {
              const opcao = mensagem;
              if (mensagem === "cancelar" || mensagem === "menu") {
                await limparAcaoPendente(chatId);
                await client.sendMessage(chatId, `🔄 Voltando ao menu principal...\n\n${config.menuPrincipal}`);
                return;
              }

              if (opcao === "1") {
                await armazenarAcaoPendente(chatId, 'reset_atendimentos');
                await client.sendMessage(chatId, "⚠️ Confirmar reset de atendimentos? Isso apagará todos os registros de atendimentos. Digite *sim* para confirmar ou *cancelar* para voltar.");
                return;
              } else if (opcao === "2") {
                await armazenarAcaoPendente(chatId, 'reset_saudados');
                await client.sendMessage(chatId, "⚠️ Confirmar reset de saudados? Isso apagará todos os registros de saudação. Digite *sim* para confirmar ou *cancelar* para voltar.");
                return;
              } else if (opcao === "3") {
                await armazenarAcaoPendente(chatId, 'reset_cadastros');
                await client.sendMessage(chatId, "⚠️ Confirmar reset de cadastros? Isso apagará todos os cadastros e cadastros em andamento. Digite *sim* para confirmar ou *cancelar* para voltar.");
                return;
              } else if (opcao === "4") {
                await armazenarAcaoPendente(chatId, 'reset_banco');
                await client.sendMessage(chatId, "⚠️ Confirmar reset do banco inteiro? Isso apagará todos os dados (atendimentos, saudados, cadastros). Digite *sim* para confirmar ou *cancelar* para voltar.");
                return;
              } else if (opcao === "5") {
                db.all("SELECT id, nome, numero, restaurante, chat_id_original, timestamp FROM cadastros ORDER BY timestamp DESC", [], (err, rows) => {
                  if (err) {
                    console.error('❌ Erro ao listar cadastros:', err.message);
                    client.sendMessage(chatId, "⚠️ Erro ao consultar cadastros. Tente novamente mais tarde.");
                    return;
                  }
                  if (rows.length === 0) {
                    client.sendMessage(chatId, "📋 *Lista de Cadastros*\n\nNenhum cadastro encontrado.");
                    return;
                  }
                  let resposta = "📋 *Lista de Cadastros*\n\n";
                  rows.forEach((row, index) => {
                    const data = new Date(row.timestamp).toLocaleString('pt-BR');
                    resposta += `${index + 1}. Nome: ${row.nome}\n` +
                               `   Número: wa.me/${row.numero.slice(0, -5)}\n` +
                               `   Restaurante: ${row.restaurante}\n` +
                               `   Contato: wa.me/${row.chat_id_original.slice(0, -5)}\n` +
                               `   Data: ${data}\n\n`;
                  });
                  client.sendMessage(chatId, resposta);
                });
                return;
              } else if (opcao === "6") {
                await exportarCadastros(chatId, client);
                return;
              } else if (opcao === "7") {
                await client.sendMessage(chatId, "📝 Digite o ID do cadastro a ser deletado (ex.: deletarcadastro 1).");
                await armazenarAcaoPendente(chatId, 'aguardar_id_cadastro');
                return;
              } else if (opcao === "8") {
                await listarAtendimentosAtivos(client, chatId, config);
                return;
              } else if (opcao === "9") {
                await client.sendMessage(chatId, "📝 Digite o chat ID do usuário para intervir (parar bot) (ex.: intervir 5511999999999@c.us).");
                await armazenarAcaoPendente(chatId, 'aguardar_intervencao');
                return;
              } else if (opcao === "10") {
                await client.sendMessage(chatId, "📝 Digite o chat ID do usuário para reativar o bot (ex.: reativar 5511999999999@c.us).");
                await armazenarAcaoPendente(chatId, 'aguardar_reativacao');
                return;
              } else if (opcao === "11") {
                await client.sendMessage(chatId, "📝 Digite o chat ID do usuário para resetar saudação (ex.: resetsaudacao 5511999999999@c.us).");
                await armazenarAcaoPendente(chatId, 'aguardar_resetsaudacao');
                return;
              } else if (opcao === "12") {
                await armazenarAcaoPendente(chatId, 'parar_bot_geral');
                await client.sendMessage(chatId, "⚠️ Confirmar parada do bot para todos os usuários? Isso fará com que o bot responda apenas com uma mensagem de 'fechado'. Digite *sim* para confirmar ou *cancelar* para voltar.");
                return;
              } else if (opcao === "13") {
                await armazenarAcaoPendente(chatId, 'reativar_bot_geral');
                await client.sendMessage(chatId, "⚠️ Confirmar reativação do bot para todos os usuários? Digite *sim* para confirmar ou *cancelar* para voltar.");
                return;
              } else {
                await client.sendMessage(chatId, `❌ Opção inválida. Digite um número de 1 a 13 ou *cancelar* para voltar.`);
                return;
              }
            }

            const confirmacoes = ['sim', 's', 'yes', 'ok'];
            if (mensagem === "cancelar") {
              await limparAcaoPendente(chatId);
              await client.sendMessage(chatId, `❌ Ação cancelada. \n\n${config.menuAdmin}`);
              return;
            }

            if (acaoPendente && acaoPendente.acao === 'aguardar_id_cadastro') {
              const idMatch = mensagemOriginal.match(/deletarcadastro\s+(\d+)/);
              if (idMatch) {
                const id = parseInt(idMatch[1]);
                await armazenarAcaoPendente(chatId, 'deletar_cadastro', id);
                await client.sendMessage(chatId, `⚠️ Confirmar exclusão do cadastro ID ${id}? Digite *sim* para confirmar ou *cancelar* para voltar.`);
              } else {
                await client.sendMessage(chatId, "❌ ID inválido. Digite: deletarcadastro <id> (ex.: deletarcadastro 1)");
              }
              return;
            }

            if (acaoPendente && acaoPendente.acao === 'aguardar_intervencao') {
              const chatIdMatch = mensagemOriginal.match(/intervir\s+(.+)/);
              if (chatIdMatch) {
                const targetChatId = chatIdMatch[1].trim();
                if (targetChatId.endsWith('@c.us')) {
                  await addIntervencao(targetChatId);
                  db.run("DELETE FROM usuarios_atendidos WHERE chat_id = ?", [targetChatId]);
                  await client.sendMessage(chatId, `✅ Bot pausado para ${targetChatId}. Agora você pode conversar diretamente. Use *reativar* para reativar.`);
                } else {
                  await client.sendMessage(chatId, "❌ Chat ID inválido. Deve terminar com @c.us (ex.: 5511999999999@c.us)");
                }
              } else {
                await client.sendMessage(chatId, "❌ Formato inválido. Digite: intervir <chatId> (ex.: intervir 5511999999999@c.us)");
              }
              await limparAcaoPendente(chatId);
              await client.sendMessage(chatId, config.menuAdmin);
              return;
            }

            if (acaoPendente && acaoPendente.acao === 'aguardar_reativacao') {
              const chatIdMatch = mensagemOriginal.match(/reativar\s+(.+)/);
              if (chatIdMatch) {
                const targetChatId = chatIdMatch[1].trim();
                if (targetChatId.endsWith('@c.us')) {
                  await removeIntervencao(targetChatId);
                  db.run("DELETE FROM usuarios_atendidos WHERE chat_id = ?", [targetChatId]);
                  await client.sendMessage(chatId, `✅ Bot reativado para ${targetChatId}.`);
                  await client.sendMessage(targetChatId, `🔄 Atendimento finalizado. \n\n${config.menuPrincipal}`);
                } else {
                  await client.sendMessage(chatId, "❌ Chat ID inválido. Deve terminar com @c.us (ex.: 5511999999999@c.us)");
                }
              } else {
                await client.sendMessage(chatId, "❌ Formato inválido. Digite: reativar <chatId> (ex.: reativar 5511999999999@c.us)");
              }
              await limparAcaoPendente(chatId);
              await client.sendMessage(chatId, config.menuAdmin);
              return;
            }

            if (acaoPendente && acaoPendente.acao === 'aguardar_resetsaudacao') {
              const chatIdMatch = mensagemOriginal.match(/resetsaudacao\s+(.+)/);
              if (chatIdMatch) {
                const targetChatId = chatIdMatch[1].trim();
                if (targetChatId.endsWith('@c.us')) {
                  db.run("DELETE FROM usuarios_saudados WHERE chat_id = ?", [targetChatId], (err) => {
                    if (err) {
                      console.error('❌ Erro ao resetar saudação:', err.message);
                      client.sendMessage(chatId, `❌ Erro ao resetar saudação para ${targetChatId}.`);
                    } else {
                      client.sendMessage(chatId, `✅ Saudação resetada para ${targetChatId}.`);
                    }
                  });
                } else {
                  await client.sendMessage(chatId, "❌ Chat ID inválido. Deve terminar com @c.us (ex.: 5511999999999@c.us)");
                }
              } else {
                await client.sendMessage(chatId, "❌ Formato inválido. Digite: resetsaudacao <chatId@c.us>");
              }
              await limparAcaoPendente(chatId);
              await client.sendMessage(chatId, config.menuAdmin);
              return;
            }

            if (acaoPendente && confirmacoes.includes(mensagem)) {
              switch (acaoPendente.acao) {
                case 'reset_atendimentos':
                  db.run("DELETE FROM usuarios_atendidos");
                  db.run("DELETE FROM usuarios_intervencao");
                  await client.sendMessage(chatId, "🔄 Atendimentos resetados com sucesso.");
                  break;
                case 'reset_saudados':
                  db.run("DELETE FROM usuarios_saudados");
                  await client.sendMessage(chatId, "🔄 Saudados resetados com sucesso.");
                  break;
                case 'reset_cadastros':
                  db.run("DELETE FROM cadastros");
                  db.run("DELETE FROM cadastro_em_andamento");
                  await client.sendMessage(chatId, "🔄 Cadastros e cadastros em andamento resetados com sucesso.");
                  break;
                case 'reset_banco':
                  db.run("DELETE FROM usuarios_atendidos");
                  db.run("DELETE FROM usuarios_saudados");
                  db.run("DELETE FROM cadastro_em_andamento");
                  db.run("DELETE FROM cadastros");
                  db.run("DELETE FROM usuarios_intervencao");
                  await client.sendMessage(chatId, "🔄 Banco de dados inteiro resetado com sucesso.");
                  break;
                case 'deletar_cadastro':
                  const id = parseInt(acaoPendente.parametro);
                  if (isNaN(id)) {
                    await client.sendMessage(chatId, "❌ ID inválido.");
                  } else {
                    await deletarCadastro(id);
                    await client.sendMessage(chatId, `✅ Cadastro ID ${id} deletado com sucesso.`);
                  }
                  break;
                case 'parar_bot_geral':
                  await setBotStatus(db, 'stopped');
                  console.log('🛑 Bot parado globalmente via admin');
                  await client.sendMessage(chatId, "🛑 Bot parado globalmente com sucesso. Agora apenas o administrador pode interagir.");
                  break;
                case 'reativar_bot_geral':
                  await setBotStatus(db, 'active');
                  console.log('✅ Bot reativado globalmente via admin');
                  await client.sendMessage(chatId, "✅ Bot reativado globalmente com sucesso.");
                  break;
                default:
                  await client.sendMessage(chatId, "❌ Ação inválida.");
              }
              await limparAcaoPendente(chatId);
              await client.sendMessage(chatId, config.menuAdmin);
              return;
            } else if (acaoPendente) {
              await client.sendMessage(chatId, `❌ Por favor, digite *sim* para confirmar ou *cancelar* para voltar ao menu admin.`);
              return;
            }
          } else if (mensagem.startsWith("reset") || mensagem === "listarcadastros" || mensagem === "exportarcadastros" || mensagem.startsWith("deletarcadastro") || mensagem === "mudarmenu" || mensagem === "listaratendimentos" || mensagem.startsWith("intervir") || mensagem.startsWith("resetsaudacao")) {
            await client.sendMessage(chatId, "⛔ Comando restrito! Você não tem permissão para usar comandos admin.");
            return;
          }

          const cadastro = await getCadastroEstado(chatId);
          if (cadastro.etapa) {
            if (mensagem === "menu" || mensagem === "cancelar") {
              await finalizarCadastro(chatId);
              await client.sendMessage(chatId, `🔄 Voltando ao menu principal...\n\n${config.menuPrincipal}`);
              return;
            }

            if (mensagem === "recomecar" || mensagem === "recomeçar") {
              await atualizarCadastroEstado(chatId, 'nome', { chat_id_original: chatId });
              await client.sendMessage(chatId, "🔄 Cadastro reiniciado. Por favor, informe seu nome completo.");
              return;
            }

            if (cadastro.etapa === 'nome') {
              if (mensagemOriginal.length < 2) {
                await client.sendMessage(chatId, "❌ Por favor, informe um nome válido (mínimo 2 caracteres). \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.");
                return;
              }
              await atualizarCadastroEstado(chatId, 'confirmar_nome', { nome: mensagemOriginal, chat_id_original: chatId });
              await client.sendMessage(chatId, `✅ Nome informado: *${mensagemOriginal}*\nEstá correto? Digite *sim* para continuar, envie outro nome ou *menu* para voltar ao menu principal.`);
              return;
            } else if (cadastro.etapa === 'confirmar_nome') {
              const confirmacoes = ['sim', 's', 'yes', 'ok'];
              if (confirmacoes.includes(mensagem)) {
                await atualizarCadastroEstado(chatId, 'numero', { nome: cadastro.nome, chat_id_original: chatId });
                await client.sendMessage(chatId, `📱 Qual número você deseja usar para o cadastro? Digite *sim* para usar o número atual (${chatId.slice(0, -5)}) ou informe outro número (ex.: 11999999999). \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.`);
              } else {
                if (mensagemOriginal.length < 2) {
                  await client.sendMessage(chatId, "❌ Por favor, informe um nome válido (mínimo 2 caracteres). \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.");
                  return;
                }
                await atualizarCadastroEstado(chatId, 'confirmar_nome', { nome: mensagemOriginal, chat_id_original: chatId });
                await client.sendMessage(chatId, `✅ Nome atualizado: *${mensagemOriginal}*\nEstá correto? Digite *sim* para continuar, envie outro nome ou *menu* para voltar ao menu principal.`);
              }
              return;
            } else if (cadastro.etapa === 'numero') {
              const confirmacoes = ['sim', 's', 'yes', 'ok'];
              let numero;
              if (confirmacoes.includes(mensagem)) {
                numero = chatId;
              } else {
                numero = validarNumero(mensagemOriginal);
                if (!numero) {
                  await client.sendMessage(chatId, "❌ Número inválido. Informe um número no formato 11999999999 ou digite *sim* para usar o número atual. \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.");
                  return;
                }
                const isRegistered = await client.isRegisteredUser(numero);
                if (!isRegistered) {
                  await client.sendMessage(chatId, "❌ O número informado não está registrado no WhatsApp. Informe outro número ou digite *sim* para usar o número atual.");
                  return;
                }
              }
              await atualizarCadastroEstado(chatId, 'restaurante', { nome: cadastro.nome, numero, chat_id_original: chatId });
              await client.sendMessage(chatId, "🍽️ Qual é o nome da sua pizzaria? \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.");
              return;
            } else if (cadastro.etapa === 'restaurante') {
              if (mensagemOriginal.length < 3) {
                await client.sendMessage(chatId, "❌ Por favor, informe um nome válido para a pizzaria (mínimo 3 caracteres). \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.");
                return;
              }
              await atualizarCadastroEstado(chatId, 'confirmar_restaurante', { nome: cadastro.nome, numero: cadastro.numero, restaurante: mensagemOriginal, chat_id_original: chatId });
              await client.sendMessage(chatId, `✅ Pizzaria informada: *${mensagemOriginal}*\nEstá correto? Digite *sim* para continuar, envie outro nome ou *menu* para voltar ao menu principal.`);
              return;
            } else if (cadastro.etapa === 'confirmar_restaurante') {
              const confirmacoes = ['sim', 's', 'yes', 'ok'];
              if (confirmacoes.includes(mensagem)) {
                const dadosCadastro = {
                  nome: cadastro.nome,
                  numero: cadastro.numero,
                  restaurante: cadastro.restaurante,
                  chat_id_original: cadastro.chat_id_original
                };
                await client.sendMessage(chatId,
                  `📋 *Resumo do Cadastro*\n\n` +
                  `Nome: ${dadosCadastro.nome}\n` +
                  `Número Cadastrado: wa.me/${dadosCadastro.numero.slice(0, -5)}\n` +
                  `Pizzaria: ${dadosCadastro.restaurante}\n\n` +
                  `✅ Tudo correto? Digite *sim* para finalizar, *recomeçar* para reiniciar o cadastro ou *menu* para voltar ao menu principal.`
                );
                await atualizarCadastroEstado(chatId, 'checkin', dadosCadastro);
              } else {
                if (mensagemOriginal.length < 3) {
                  await client.sendMessage(chatId, "❌ Por favor, informe um nome válido para a pizzaria (mínimo 3 caracteres). \n\nDigite *menu* ou *cancelar* para voltar ao menu principal.");
                  return;
                }
                await atualizarCadastroEstado(chatId, 'confirmar_restaurante', { nome: cadastro.nome, numero: cadastro.numero, restaurante: mensagemOriginal, chat_id_original: chatId });
                await client.sendMessage(chatId, `✅ Pizzaria atualizada: *${mensagemOriginal}*\nEstá correto? Digite *sim* para continuar, envie outro nome ou *menu* para voltar ao menu principal.`);
              }
              return;
            } else if (cadastro.etapa === 'checkin') {
              const confirmacoes = ['sim', 's', 'yes', 'ok'];
              if (confirmacoes.includes(mensagem)) {
                const dadosCadastro = {
                  nome: cadastro.nome,
                  numero: cadastro.numero,
                  restaurante: cadastro.restaurante,
                  chat_id_original: cadastro.chat_id_original
                };
                await salvarCadastroPermanente(dadosCadastro);
                const mensagemAdmin = `📋 *Novo Cadastro para Pizzaria*\n\n` +
                                     `Nome: ${dadosCadastro.nome}\n` +
                                     `Número Cadastrado: wa.me/${dadosCadastro.numero.slice(0, -5)}\n` +
                                     `Pizzaria: ${dadosCadastro.restaurante}\n` +
                                     `Número do Contato: wa.me/${dadosCadastro.chat_id_original.slice(0, -5)}`;
                try {
                  await client.sendMessage(config.adminNumero, mensagemAdmin);
                } catch (err) {
                  console.error('❌ Erro ao enviar notificação de cadastro ao administrador:', err.message);
                }
                await finalizarCadastro(chatId);
                await client.sendMessage(chatId, `✅ Cadastro concluído com sucesso! Em breve, entraremos em contato para configurar sua pizzaria.\n\n${config.menuPrincipal}`);
              } else if (mensagem === 'recomecar' || mensagem === 'recomeçar') {
                await atualizarCadastroEstado(chatId, 'nome', { chat_id_original: chatId });
                await client.sendMessage(chatId, "🔄 Cadastro reiniciado. Por favor, informe seu nome completo.");
              } else {
                await client.sendMessage(chatId, `❌ Por favor, digite *sim* para confirmar o cadastro, *recomeçar* para reiniciar ou *menu* para voltar ao menu principal.`);
              }
              return;
            }
          }

          if (mensagem === "menu" || mensagem === "voltar") {
            await addUserAtendido(chatId, config, 'menu_principal');
            await client.sendMessage(chatId, `🔄 Voltando ao menu principal...\n\n${config.menuPrincipal}`);
            return;
          }

          if (mensagem === "1" || mensagem === "um") {
            await addUserAtendido(chatId, config, '1');
            await client.sendMessage(chatId, config.respostas["1"]);
            return;
          }

          if (mensagem === "2" || mensagem === "dois") {
            await addIntervencao(chatId);
            await addUserAtendido(chatId, config, '2');
            await client.sendMessage(chatId, config.respostas["2"]);
            const contact = await client.getContactById(chatId);
            const userName = contact.pushname || "cliente";
            const notificationMessage = `📩 Novo pedido de acompanhamento:\n\nNome: ${userName}\nNúmero: wa.me/${chatId.slice(0, -5)}`;
            try {
              await client.sendMessage(config.adminNumero, notificationMessage);
              await client.sendMessage(config.adminNumero, `ℹ️ Use *reativar ${chatId}* para reativar o bot para este usuário.`);
            } catch (err) {
              console.error('❌ Erro ao enviar notificação de acompanhamento:', err.message);
            }
            return;
          }

          if (mensagem === "3" || mensagem === "tres" || mensagem === "três") {
            await addIntervencao(chatId);
            await addUserAtendido(chatId, config, '3');
            await client.sendMessage(chatId, config.respostas["3"]);
            const contact = await client.getContactById(chatId);
            const userName = contact.pushname || "cliente";
            const notificationMessage = `📩 Novo pedido de confirmação de pagamento:\n\nNome: ${userName}\nNúmero: wa.me/${chatId.slice(0, -5)}`;
            try {
              await client.sendMessage(config.adminNumero, notificationMessage);
              await client.sendMessage(config.adminNumero, `ℹ️ Use *reativar ${chatId}* para reativar o bot para este usuário.`);
            } catch (err) {
              console.error('❌ Erro ao enviar notificação de confirmação de pagamento:', err.message);
            }
            return;
          }

          if (mensagem === "4" || mensagem === "quatro") {
            await addUserAtendido(chatId, config, '4');
            await client.sendMessage(chatId, config.respostas["4"]);
            return;
          }

          if (mensagem === "5" || mensagem === "cinco") {
            await addIntervencao(chatId);
            await addUserAtendido(chatId, config, '5');
            await client.sendMessage(chatId, config.respostas["5"]);
            const contact = await client.getContactById(chatId);
            const userName = contact.pushname || "cliente";
            const notificationMessage = `📩 Novo pedido de atendimento:\n\nNome: ${userName}\nNúmero: wa.me/${chatId.slice(0, -5)}`;
            try {
              await client.sendMessage(config.adminNumero, notificationMessage);
              await client.sendMessage(config.adminNumero, `ℹ️ Use *reativar ${chatId}* para reativar o bot para este usuário.`);
            } catch (err) {
              console.error('❌ Erro ao enviar notificação de pedido de atendimento:', err.message);
            }
            return;
          }

          let opcao = mensagem;
          if (mensagem === "um") opcao = "1";
          else if (mensagem === "dois") opcao = "2";
          else if (mensagem === "tres" || mensagem === "três") opcao = "3";
          else if (mensagem === "quatro") opcao = "4";
          else if (mensagem === "cinco") opcao = "5";

          if (config.respostas[opcao]) {
            await client.sendMessage(chatId, config.respostas[opcao]);
          } else {
            await client.sendMessage(chatId, 
              `❌ *Opção inválida.*\n` +
              `Digite *1*, *2*, *3*, *4* ou *5* para escolher uma opção.\n` +
              `Ou digite *menu* para voltar ao menu principal.`
            );
          }
        } finally {
          // Release the lock
          chatHistories[chatId].isProcessing = false;
          console.log(`🔓 Lock liberado para ${chatId}`);
        }
      } catch (err) {
        console.error(`❌ Erro ao processar mensagem de ${chatId}:`, err.stack);
        await client.sendMessage(chatId, "⚠️ Ocorreu um erro interno. Tente novamente mais tarde.");
        chatHistories[chatId].isProcessing = false; // Ensure lock is released on error
      }
    });

    function getIsClientReady() {
      return isClientReady;
    }

    // Inicializar o cliente WhatsApp
    client.initialize().then(() => {
      console.log('🚀 Cliente WhatsApp inicializado');
    }).catch(err => {
      console.error('❌ Erro ao inicializar cliente WhatsApp:', err.stack);
    });

    // Iniciar o servidor Express
    startServer(client, config, getIsClientReady, db);
  } catch (err) {
    console.error('❌ Erro ao inicializar o bot:', err.stack);
    process.exit(1);
  }
}

// Iniciar o bot
initializeBot();