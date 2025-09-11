const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

let io = null; // Declarar io fora da função para exportação

// Configurar o Socket.IO
function initializeSocketIO() {
    if (!io) {
        io = new Server(server, {
            cors: {
                origin: process.env.NODE_ENV === 'production' ? 'https://your-domain.com' : '*', // Restringir origem em produção
                methods: ['GET', 'POST'],
                credentials: true // Habilitar credenciais se necessário
            }
        });
        console.log('✅ Socket.IO inicializado com sucesso');

        // Adicionar evento de conexão para depuração
        io.on('connection', (socket) => {
            console.log('🔗 Novo cliente conectado:', socket.id);
            socket.on('disconnect', () => {
                console.log('🔌 Cliente desconectado:', socket.id);
            });
        });
    }
    return io;
}

// Função para iniciar o servidor
function startServer(client, config, getIsClientReady, db) {
    // Middleware para servir arquivos estáticos
    app.use(express.static(path.join(__dirname, 'public')));
    app.use(express.json());

    // Inicializar Socket.IO
    initializeSocketIO();

    // Rota para servir o index.html
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'index.html'));
    });

    // Rota para verificar o status do bot
    app.get('/api/status', (req, res) => {
        console.log('📡 Requisição para /api/status recebida');
        res.json({ isReady: getIsClientReady() });
    });

    // Rota para solicitar código de verificação
    app.post('/api/request-code', async (req, res) => {
        const { adminNumber } = req.body;
        console.log('📩 Requisição para /api/request-code:', adminNumber);

        if (!adminNumber || !adminNumber.match(/^\d{12,13}$/)) {
            console.log('❌ Número de administrador inválido:', adminNumber);
            return res.status(400).json({ success: false, message: 'Número de administrador inválido.' });
        }

        const verificationCode = Math.floor(100000 + Math.random() * 900000).toString();
        const chatId = `${adminNumber}@c.us`;

        try {
            const isRegistered = await client.isRegisteredUser(chatId);
            if (!isRegistered) {
                console.log('❌ Número não registrado no WhatsApp:', chatId);
                return res.status(400).json({ success: false, message: 'Número não registrado no WhatsApp.' });
            }

            // Inserir o código de verificação no banco de dados
            db.run(
                'INSERT OR REPLACE INTO verification_codes (chat_id, code, timestamp) VALUES (?, ?, ?)',
                [chatId, verificationCode, Date.now()],
                (err) => {
                    if (err) {
                        console.error('❌ Erro ao salvar código de verificação:', err.message);
                        return res.status(500).json({ success: false, message: 'Erro ao salvar código de verificação.' });
                    }
                    console.log('✅ Código de verificação salvo:', { chatId, verificationCode });

                    // Enviar o código via WhatsApp
                    client.sendMessage(chatId, `🔐 Seu código de verificação é: *${verificationCode}*`)
                        .then(() => {
                            console.log('📤 Código de verificação enviado para:', chatId);
                            res.json({ success: true });
                        })
                        .catch((err) => {
                            console.error('❌ Erro ao enviar mensagem de verificação:', err.message);
                            res.status(500).json({ success: false, message: 'Erro ao enviar código de verificação.' });
                        });
                }
            );
        } catch (err) {
            console.error('❌ Erro ao processar solicitação de código:', err.message);
            return res.status(500).json({ success: false, message: 'Erro ao processar solicitação.' });
        }
    });

    // Rota para verificar o código
    app.post('/api/verify-code', (req, res) => {
        const { adminNumber, code } = req.body;
        console.log('🔍 Requisição para /api/verify-code:', { adminNumber, code });
        if (!adminNumber || !code.match(/^\d{6}$/)) {
            console.log('❌ Dados inválidos para verificação:', { adminNumber, code });
            return res.status(400).json({ success: false, message: 'Dados inválidos.' });
        }

        const chatId = `${adminNumber}@c.us`;
        db.get('SELECT code, timestamp FROM verification_codes WHERE chat_id = ?', [chatId], async (err, row) => {
            if (err) {
                console.error('❌ Erro ao consultar código de verificação:', err.message);
                return res.status(500).json({ success: false, message: 'Erro ao verificar código.' });
            }
            if (!row) {
                console.log('❌ Nenhum código encontrado para:', chatId);
                return res.status(400).json({ success: false, message: 'Código não encontrado.' });
            }

            const isCodeValid = row.code === code && (Date.now() - row.timestamp) < 5 * 60 * 1000;
            if (!isCodeValid) {
                console.log('❌ Código inválido ou expirado:', { chatId, code });
                return res.status(400).json({ success: false, message: 'Código inválido ou expirado.' });
            }

            if (chatId !== config.adminNumero) {
                console.log('❌ Usuário não é administrador:', chatId);
                return res.status(403).json({ success: false, message: 'Acesso negado. Apenas administradores podem fazer login.' });
            }

            db.run('DELETE FROM verification_codes WHERE chat_id = ?', [chatId], (err) => {
                if (err) {
                    console.error('❌ Erro ao deletar código de verificação:', err.message);
                }
                console.log('✅ Código de verificação deletado:', chatId);
            });

            try {
                await client.sendMessage(chatId, '✅ Login bem-sucedido no painel administrativo!');
                console.log('✅ Login autorizado para:', chatId);
                res.json({ success: true });
            } catch (err) {
                console.error('❌ Erro ao enviar mensagem de confirmação:', err.message);
                res.status(500).json({ success: false, message: 'Erro ao confirmar login.' });
            }
        });
    });

    // Rota para ações administrativas
    app.post('/api/admin-action', async (req, res) => {
        const { action } = req.body;
        console.log('⚙️ Requisição para /api/admin-action:', action);
        try {
            switch (action) {
                case 'reset_atendimentos':
                    db.run('DELETE FROM usuarios_atendidos');
                    db.run('DELETE FROM usuarios_intervencao');
                    console.log('✅ Atendimentos resetados');
                    return res.json({ success: true, message: 'Atendimentos resetados com sucesso.' });
                case 'reset_saudados':
                    db.run('DELETE FROM usuarios_saudados');
                    console.log('✅ Saudados resetados');
                    return res.json({ success: true, message: 'Saudados resetados com sucesso.' });
                case 'reset_cadastros':
                    db.run('DELETE FROM cadastros');
                    db.run('DELETE FROM cadastro_em_andamento');
                    console.log('✅ Cadastros resetados');
                    return res.json({ success: true, message: 'Cadastros resetados com sucesso.' });
                case 'reset_banco':
                    db.run('DELETE FROM usuarios_atendidos');
                    db.run('DELETE FROM usuarios_saudados');
                    db.run('DELETE FROM cadastro_em_andamento');
                    db.run('DELETE FROM cadastros');
                    db.run('DELETE FROM usuarios_intervencao');
                    console.log('✅ Banco de dados resetado');
                    return res.json({ success: true, message: 'Banco de dados resetado com sucesso.' });
                default:
                    console.log('❌ Ação inválida:', action);
                    return res.status(400).json({ success: false, message: 'Ação inválida.' });
            }
        } catch (err) {
            console.error('❌ Erro ao executar ação administrativa:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao executar ação.' });
        }
    });

    // Rota para listar cadastros
    app.get('/api/list-cadastros', (req, res) => {
        console.log('📋 Requisição para /api/list-cadastros');
        db.all('SELECT id, nome, numero, restaurante, chat_id_original, timestamp FROM cadastros ORDER BY timestamp DESC', [], (err, rows) => {
            if (err) {
                console.error('❌ Erro ao listar cadastros:', err.message);
                return res.status(500).json({ success: false, message: 'Erro ao listar cadastros.' });
            }
            console.log('✅ Cadastros listados:', rows.length);
            res.json({ success: true, cadastros: rows });
        });
    });

    // Rota para exportar cadastros
    app.get('/api/export-cadastros', (req, res) => {
        console.log('📤 Requisição para /api/export-cadastros');
        db.all('SELECT id, nome, numero, restaurante, chat_id_original, timestamp FROM cadastros ORDER BY timestamp DESC', [], (err, rows) => {
            if (err) {
                console.error('❌ Erro ao exportar cadastros:', err.message);
                return res.status(500).json({ success: false, message: 'Erro ao exportar cadastros.' });
            }
            let csvContent = 'ID,Nome,Número,Restaurante,Contato,Data\n';
            rows.forEach(row => {
                const data = new Date(row.timestamp).toLocaleString('pt-BR');
                csvContent += `${row.id},${row.nome},${row.numero.slice(0, -5)},${row.restaurante},${row.chat_id_original.slice(0, -5)},${data}\n`;
            });
            console.log('✅ Cadastros exportados como CSV');
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=cadastros_exportados.csv');
            res.send(csvContent);
        });
    });

    // Rota para deletar cadastro
    app.post('/api/delete-cadastro', (req, res) => {
        const { id } = req.body;
        console.log('🗑️ Requisição para /api/delete-cadastro:', id);
        if (!id || isNaN(id)) {
            console.log('❌ ID inválido:', id);
            return res.status(400).json({ success: false, message: 'ID inválido.' });
        }
        db.run('DELETE FROM cadastros WHERE id = ?', [id], function(err) {
            if (err) {
                console.error('❌ Erro ao deletar cadastro:', err.message);
                return res.status(500).json({ success: false, message: 'Erro ao deletar cadastro.' });
            }
            if (this.changes === 0) {
                console.log('❌ Cadastro não encontrado:', id);
                return res.status(404).json({ success: false, message: 'Cadastro não encontrado.' });
            }
            console.log('✅ Cadastro deletado:', id);
            res.json({ success: true, message: `Cadastro ID ${id} deletado com sucesso.` });
        });
    });

    // Rota para intervir em atendimento
    app.post('/api/intervene/:chatId', async (req, res) => {
        const chatId = req.params.chatId;
        console.log('🔧 Requisição para /api/intervene:', chatId);
        if (!chatId.match(/^\d{12,13}@c\.us$/)) {
            console.log('❌ Chat ID inválido:', chatId);
            return res.status(400).json({ success: false, message: 'Chat ID inválido.' });
        }
        try {
            db.run('INSERT OR REPLACE INTO usuarios_intervencao (chat_id) VALUES (?)', [chatId], (err) => {
                if (err) {
                    console.error('❌ Erro ao intervir:', err.message);
                    return res.status(500).json({ success: false, message: 'Erro ao intervir.' });
                }
                console.log('✅ Intervenção realizada:', chatId);
            });
            db.run('DELETE FROM usuarios_atendidos WHERE chat_id = ?', [chatId]);
            await client.sendMessage(chatId, '👨‍💼 Um administrador assumiu seu atendimento. Por favor, continue a conversa.');
            res.json({ success: true, message: `Bot pausado para ${chatId}.` });
        } catch (err) {
            console.error('❌ Erro ao intervir:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao intervir.' });
        }
    });

    // Rota para reativar bot
    app.post('/api/reactivate/:chatId', async (req, res) => {
        const chatId = req.params.chatId;
        console.log('🔄 Requisição para /api/reactivate:', chatId);
        if (!chatId.match(/^\d{12,13}@c\.us$/)) {
            console.log('❌ Chat ID inválido:', chatId);
            return res.status(400).json({ success: false, message: 'Chat ID inválido.' });
        }
        try {
            db.run('DELETE FROM usuarios_intervencao WHERE chat_id = ?', [chatId], (err) => {
                if (err) {
                    console.error('❌ Erro ao reativar:', err.message);
                    return res.status(500).json({ success: false, message: 'Erro ao reativar.' });
                }
                console.log('✅ Bot reativado:', chatId);
            });
            db.run('DELETE FROM usuarios_atendidos WHERE chat_id = ?', [chatId]);
            await client.sendMessage(chatId, `🔄 Atendimento finalizado.\n\n${config.menuPrincipal}`);
            res.json({ success: true, message: `Bot reativado para ${chatId}.` });
        } catch (err) {
            console.error('❌ Erro ao reativar:', err.message);
            res.status(500).json({ success: false, message: 'Erro ao reativar.' });
        }
    });

    // Rota para resetar saudação
    app.post('/api/reset-saudacao/:chatId', (req, res) => {
        const chatId = req.params.chatId;
        console.log('🔄 Requisição para /api/reset-saudacao:', chatId);
        if (!chatId.match(/^\d{12,13}@c\.us$/)) {
            console.log('❌ Chat ID inválido:', chatId);
            return res.status(400).json({ success: false, message: 'Chat ID inválido.' });
        }
        db.run('DELETE FROM usuarios_saudados WHERE chat_id = ?', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao resetar saudação:', err.message);
                return res.status(500).json({ success: false, message: 'Erro ao resetar saudação.' });
            }
            console.log('✅ Saudação resetada:', chatId);
            res.json({ success: true, message: `Saudação resetada para ${chatId}.` });
        });
    });

    // Rota para listar atendimentos ativos
    app.get('/api/list-ongoing-attendances', (req, res) => {
        console.log('📋 Requisição para /api/list-ongoing-attendances');
        db.all('SELECT chat_id, tipo, ultima_mensagem FROM usuarios_atendidos', [], (err, rows) => {
            if (err) {
                console.error('❌ Erro ao listar atendimentos:', err.message);
                return res.status(500).json({ success: false, message: 'Erro ao listar atendimentos.' });
            }
            console.log('✅ Atendimentos listados:', rows.length);
            res.json({ success: true, attendances: rows });
        });
    });

    // Iniciar o servidor na porta 3000
    const PORT = process.env.PORT || 3000;
    server.listen(PORT, () => {
        console.log(`🚀 Servidor rodando na porta ${PORT}`);
    });
}

// Exportar startServer e io
module.exports = {
    startServer,
    io: initializeSocketIO() // Inicializar e exportar io
};