const sqlite3 = require('sqlite3').verbose();
let db = null;

function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database('bot.db', (err) => {
            if (err) {
                console.error('❌ Erro ao conectar ao banco de dados:', err.message);
                reject(err);
            } else {
                console.log('✅ Conectado ao banco de dados SQLite');
                db.serialize(() => {
                    db.run(`
                        CREATE TABLE IF NOT EXISTS usuarios_atendidos (
                            chat_id TEXT PRIMARY KEY,
                            ultima_mensagem INTEGER,
                            ultima_acao TEXT
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS usuarios_saudados (
                            chat_id TEXT PRIMARY KEY
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS cadastro_em_andamento (
                            chat_id TEXT PRIMARY KEY,
                            etapa TEXT,
                            nome TEXT,
                            numero TEXT,
                            restaurante TEXT,
                            chat_id_original TEXT
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS cadastros (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            nome TEXT,
                            numero TEXT,
                            restaurante TEXT,
                            chat_id_original TEXT,
                            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS usuarios_intervencao (
                            chat_id TEXT PRIMARY KEY
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS acoes_admin_pendentes (
                            chat_id TEXT PRIMARY KEY,
                            acao TEXT,
                            parametro TEXT
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS mensagens_log (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            chat_id TEXT,
                            mensagem TEXT,
                            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS verification_codes (
                            chat_id TEXT PRIMARY KEY,
                            code TEXT NOT NULL,
                            timestamp INTEGER NOT NULL
                        )
                    `);
                    db.run(`
                        CREATE TABLE IF NOT EXISTS blocked_numbers (
                            phone_number TEXT PRIMARY KEY,
                            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
                        )`, () => {
                            console.log('✅ Tabela blocked_numbers criada ou já existe');
                        }
                    );
                    resolve();
                });
            }
        });
    });
}

function getDb() {
    return db;
}

const logMessage = (chatId, message) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO mensagens_log (chat_id, mensagem) VALUES (?, ?)",
            [chatId, message],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao logar mensagem:', err.message);
                    reject(err);
                } else {
                    resolve();
                }
            }
        );
    });
};

const isUserInIntervencao = (chatId) => {
    return new Promise((resolve) => {
        db.get("SELECT * FROM usuarios_intervencao WHERE chat_id = ?", [chatId], (err, row) => {
            resolve(!!row);
        });
    });
};

const isUserAtendido = (chatId) => {
    return new Promise((resolve) => {
        db.get("SELECT * FROM usuarios_atendidos WHERE chat_id = ?", [chatId], (err, row) => {
            resolve(!!row);
        });
    });
};

const addUserAtendido = async (chatId, config, acao = 'menu_principal') => {
    const db = getDb();
    return new Promise((resolve, reject) => {
        const agora = Date.now();
        db.run(
            "INSERT OR REPLACE INTO usuarios_atendidos (chat_id, ultima_mensagem, ultima_acao) VALUES (?, ?, ?)",
            [chatId, agora, acao],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao adicionar usuário atendido:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Usuário ${chatId} adicionado aos atendidos com ação ${acao}`);
                    resolve();
                }
            }
        );
    });
};

const isUserSaudado = (chatId) => {
    return new Promise((resolve) => {
        db.get("SELECT * FROM usuarios_saudados WHERE chat_id = ?", [chatId], (err, row) => {
            resolve(!!row);
        });
    });
};

const addUserSaudado = (chatId) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT OR REPLACE INTO usuarios_saudados (chat_id) VALUES (?)",
            [chatId],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao adicionar usuário saudado:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Usuário ${chatId} adicionado aos saudados`);
                    resolve();
                }
            }
        );
    });
};

const getCadastroEstado = (chatId) => {
    return new Promise((resolve) => {
        db.get("SELECT * FROM cadastro_em_andamento WHERE chat_id = ?", [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao obter estado de cadastro:', err.message);
                resolve({ etapa: null });
            } else {
                resolve(row || { etapa: null });
            }
        });
    });
};

const atualizarCadastroEstado = (chatId, etapa, dados) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT OR REPLACE INTO cadastro_em_andamento (chat_id, etapa, nome, numero, restaurante, chat_id_original) VALUES (?, ?, ?, ?, ?, ?)",
            [chatId, etapa, dados.nome, dados.numero, dados.restaurante, dados.chat_id_original],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao atualizar estado de cadastro:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Estado de cadastro atualizado para ${chatId}: ${etapa}`);
                    resolve();
                }
            }
        );
    });
};

const finalizarCadastro = (chatId) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM cadastro_em_andamento WHERE chat_id = ?", [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao finalizar cadastro:', err.message);
                reject(err);
            } else {
                console.log(`✅ Cadastro finalizado para ${chatId}`);
                resolve();
            }
        });
    });
};

const salvarCadastroPermanente = (dados) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT INTO cadastros (nome, numero, restaurante, chat_id_original) VALUES (?, ?, ?, ?)",
            [dados.nome, dados.numero, dados.restaurante, dados.chat_id_original],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao salvar cadastro permanente:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Cadastro permanente salvo para ${dados.numero}`);
                    resolve();
                }
            }
        );
    });
};

const validarNumero = (numero) => {
    const numeroLimpo = numero.replace(/\D/g, '');
    if (numeroLimpo.length >= 10 && numeroLimpo.length <= 15) {
        return numeroLimpo + '@c.us';
    }
    return null;
};

const armazenarAcaoPendente = (chatId, acao, parametro = null) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT OR REPLACE INTO acoes_admin_pendentes (chat_id, acao, parametro) VALUES (?, ?, ?)",
            [chatId, acao, parametro],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao armazenar ação pendente:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Ação pendente armazenada para ${chatId}: ${acao}`);
                    resolve();
                }
            }
        );
    });
};

const verificarAcaoPendente = (chatId) => {
    return new Promise((resolve) => {
        db.get("SELECT acao, parametro FROM acoes_admin_pendentes WHERE chat_id = ?", [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar ação pendente:', err.message);
                resolve(null);
            } else {
                resolve(row || null);
            }
        });
    });
};

const limparAcaoPendente = (chatId) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM acoes_admin_pendentes WHERE chat_id = ?", [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao limpar ação pendente:', err.message);
                reject(err);
            } else {
                console.log(`✅ Ação pendente limpa para ${chatId}`);
                resolve();
            }
        });
    });
};

const exportarCadastros = async (chatId, client) => {
    db.all("SELECT * FROM cadastros", [], (err, rows) => {
        if (err) {
            console.error('❌ Erro ao exportar cadastros:', err.message);
            client.sendMessage(chatId, "⚠️ Erro ao exportar cadastros. Tente novamente mais tarde.");
            return;
        }
        if (rows.length === 0) {
            client.sendMessage(chatId, "📋 Nenhum cadastro para exportar.");
            return;
        }
        let csvContent = "id,nome,numero,restaurante,chat_id_original,timestamp\n";
        rows.forEach(row => {
            csvContent += `${row.id},"${row.nome}","${row.numero}","${row.restaurante}","${row.chat_id_original}","${row.timestamp}"\n`;
        });
        const media = new MessageMedia('text/csv', Buffer.from(csvContent).toString('base64'), 'cadastros.csv');
        client.sendMessage(chatId, media, { caption: '📊 Aqui está o arquivo CSV com os cadastros exportados.' });
    });
};

const deletarCadastro = (id) => {
    return new Promise((resolve, reject) => {
        db.run("DELETE FROM cadastros WHERE id = ?", [id], (err) => {
            if (err) {
                console.error('❌ Erro ao deletar cadastro:', err.message);
                reject(err);
            } else {
                console.log(`✅ Cadastro ID ${id} deletado`);
                resolve();
            }
        });
    });
};

const addIntervencao = (chatId) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT OR REPLACE INTO usuarios_intervencao (chat_id) VALUES (?)",
            [chatId],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao adicionar intervenção:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Intervenção adicionada para ${chatId}`);
                    resolve();
                }
            }
        );
    });
};

const removeIntervencao = (chatId) => {
    return new Promise((resolve, reject) => {
        db.run(
            "DELETE FROM usuarios_intervencao WHERE chat_id = ?",
            [chatId],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao remover intervenção:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Intervenção removida para ${chatId}`);
                    resolve();
                }
            }
        );
    });
};

const listarAtendimentosAtivos = async (client, chatId, config) => {
    const db = getDb();

    return new Promise((resolve, reject) => {
        db.all("SELECT chat_id, ultima_mensagem, ultima_acao FROM usuarios_atendidos", [], async (err, atendidosRows) => {
            if (err) {
                console.error('❌ Erro ao consultar atendimentos ativos:', err.message);
                await client.sendMessage(chatId, "⚠️ Erro ao consultar atendimentos ativos. Tente novamente mais tarde.");
                return reject(err);
            }

            db.all("SELECT chat_id FROM usuarios_intervencao", [], async (err, intervencaoRows) => {
                if (err) {
                    console.error('❌ Erro ao consultar usuários em intervenção:', err.message);
                    await client.sendMessage(chatId, "⚠️ Erro ao consultar usuários em intervenção. Tente novamente mais tarde.");
                    return reject(err);
                }

                db.all("SELECT chat_id, etapa FROM cadastro_em_andamento", [], async (err, cadastroRows) => {
                    if (err) {
                        console.error('❌ Erro ao consultar cadastros em andamento:', err.message);
                        await client.sendMessage(chatId, "⚠️ Erro ao consultar cadastros em andamento. Tente novamente mais tarde.");
                        return reject(err);
                    }

                    if (atendidosRows.length === 0 && intervencaoRows.length === 0 && cadastroRows.length === 0) {
                        await client.sendMessage(chatId, "📋 *Lista de Atendimentos Ativos*\n\nNenhum atendimento ativo no momento.");
                        return resolve();
                    }

                    let resposta = "📋 *Lista de Atendimentos Ativos*\n\n";
                    const intervencaoSet = new Set(intervencaoRows.map(row => row.chat_id));
                    const cadastroMap = new Map(cadastroRows.map(row => [row.chat_id, row.etapa]));

                    for (const row of atendidosRows) {
                        let userName = 'Desconhecido';
                        try {
                            const contact = await client.getContactById(row.chat_id);
                            userName = contact.pushname || contact.name || 'Desconhecido';
                        } catch (err) {
                            console.error(`❌ Erro ao obter contato para ${row.chat_id}:`, err.message);
                        }

                        const ultimaMensagem = new Date(row.ultima_mensagem).toLocaleString('pt-BR');
                        let status = '';

                        if (intervencaoSet.has(row.chat_id)) {
                            status = 'Bot desativado (em intervenção)';
                        } else if (cadastroMap.has(row.chat_id)) {
                            const etapa = cadastroMap.get(row.chat_id);
                            const etapasDescritivas = {
                                'nome': 'Cadastro: Informando nome',
                                'confirmar_nome': 'Cadastro: Confirmando nome',
                                'numero': 'Cadastro: Informando número',
                                'restaurante': 'Cadastro: Informando nome da pizzaria',
                                'confirmar_restaurante': 'Cadastro: Confirmando nome da pizzaria',
                                'checkin': 'Cadastro: Confirmando dados finais'
                            };
                            status = etapasDescritivas[etapa] || `Cadastro: Etapa ${etapa}`;
                        } else {
                            const acao = row.ultima_acao;
                            const acoesDescritivas = {
                                '1': 'Opção 1: Fazer um pedido',
                                '2': 'Opção 2: Acompanhar pedido',
                                '3': 'Opção 3: Confirmar pagamento',
                                '4': 'Opção 4: Ver cardápio',
                                '5': 'Opção 5: Falar com um atendente',
                                'novo_pedido': 'Novo pedido do site',
                                'menu_principal': 'No menu principal'
                            };
                            status = acoesDescritivas[acao] || 'No menu principal';
                        }

                        resposta += `👤 Nome: ${userName}\n` +
                                   `📱 Número: wa.me/${row.chat_id.slice(0, -5)}\n` +
                                   `📍 Status: ${status}\n` +
                                   `⏰ Última mensagem: ${ultimaMensagem}\n\n`;
                    }

                    for (const row of intervencaoRows) {
                        if (!atendidosRows.find(a => a.chat_id === row.chat_id)) {
                            let userName = 'Desconhecido';
                            try {
                                const contact = await client.getContactById(row.chat_id);
                                userName = contact.pushname || contact.name || 'Desconhecido';
                            } catch (err) {
                                console.error(`❌ Erro ao obter contato para ${row.chat_id}:`, err.message);
                            }
                            resposta += `👤 Nome: ${userName}\n` +
                                       `📱 Número: wa.me/${row.chat_id.slice(0, -5)}\n` +
                                       `📍 Status: Bot desativado (em intervenção)\n` +
                                       `⏰ Última mensagem: Não disponível\n\n`;
                        }
                    }

                    for (const row of cadastroRows) {
                        if (!atendidosRows.find(a => a.chat_id === row.chat_id)) {
                            let userName = 'Desconhecido';
                            try {
                                const contact = await client.getContactById(row.chat_id);
                                userName = contact.pushname || contact.name || 'Desconhecido';
                            } catch (err) {
                                console.error(`❌ Erro ao obter contato para ${row.chat_id}:`, err.message);
                            }
                            const etapasDescritivas = {
                                'nome': 'Cadastro: Informando nome',
                                'confirmar_nome': 'Cadastro: Confirmando nome',
                                'numero': 'Cadastro: Informando número',
                                'restaurante': 'Cadastro: Informando nome da pizzaria',
                                'confirmar_restaurante': 'Cadastro: Confirmando nome da pizzaria',
                                'checkin': 'Cadastro: Confirmando dados finais'
                            };
                            const status = etapasDescritivas[row.etapa] || `Cadastro: Etapa ${row.etapa}`;
                            resposta += `👤 Nome: ${userName}\n` +
                                       `📱 Número: wa.me/${row.chat_id.slice(0, -5)}\n` +
                                       `📍 Status: ${status}\n` +
                                       `⏰ Última mensagem: Não disponível\n\n`;
                        }
                    }

                    await client.sendMessage(chatId, resposta);
                    resolve();
                });
            });
        });
    });
};

const addBlockedNumber = (phoneNumber) => {
    return new Promise((resolve, reject) => {
        db.run(
            "INSERT OR IGNORE INTO blocked_numbers (phone_number) VALUES (?)",
            [phoneNumber],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao adicionar número bloqueado:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Número ${phoneNumber} adicionado à lista de bloqueados`);
                    resolve();
                }
            }
        );
    });
};

const listBlockedNumbers = () => {
    return new Promise((resolve, reject) => {
        db.all("SELECT phone_number, timestamp FROM blocked_numbers ORDER BY timestamp DESC", [], (err, rows) => {
            if (err) {
                console.error('❌ Erro ao listar números bloqueados:', err.message);
                reject(err);
            } else {
                console.log(`✅ ${rows.length} números bloqueados listados:`, rows.map(row => row.phone_number));
                resolve(rows);
            }
        });
    });
};

const removeBlockedNumber = (phoneNumber) => {
    return new Promise((resolve, reject) => {
        // Verificar se o número existe na lista
        db.get("SELECT phone_number FROM blocked_numbers WHERE phone_number = ?", [phoneNumber], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar número bloqueado:', err.message);
                reject(err);
                return;
            }
            if (!row) {
                console.log(`⚠️ Número ${phoneNumber} não encontrado na lista de bloqueados`);
                resolve({ success: false, message: 'Número não encontrado na lista de bloqueados.' });
                return;
            }

            // Tentar remover o número
            db.run("DELETE FROM blocked_numbers WHERE phone_number = ?", [phoneNumber], function(err) {
                if (err) {
                    console.error('❌ Erro ao remover número bloqueado:', err.message);
                    reject(err);
                } else {
                    console.log(`✅ Número ${phoneNumber} removido da lista de bloqueados. Linhas afetadas: ${this.changes}`);
                    resolve({ success: true, message: `Número ${phoneNumber} removido com sucesso.` });
                }
            });
        });
    });
};

// Adicione esta função no Database.js
const isBlockedNumber = (chatId) => {
    return new Promise((resolve) => {
        db.get("SELECT * FROM blocked_numbers WHERE phone_number = ?", [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar bloqueio:', err.message);
                resolve(false); // Fallback para não bloquear em caso de erro
            } else {
                const isBlocked = !!row;
                console.log(`🔍 Verificação de bloqueio para ${chatId}: ${isBlocked ? 'BLOQUEADO' : 'Permitido'}`);
                resolve(isBlocked);
            }
        });
    });
};

module.exports = {
    initDatabase,
    getDb,
    logMessage,
    isUserInIntervencao,
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
    addBlockedNumber,
    listBlockedNumbers,
    removeBlockedNumber,
    isBlockedNumber
};