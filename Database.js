const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const { MessageMedia } = require('whatsapp-web.js');

let db = null;

function initDatabase() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database('./usuarios.db', (err) => {
            if (err) {
                console.error('❌ Erro ao conectar ao banco de dados:', err.message);
                reject(err);
                return;
            }
            console.log('✅ Banco de dados conectado com sucesso');
        });

        db.serialize(() => {
            console.log('🔄 Iniciando criação de tabelas...');

            // Cria a tabela usuarios_atendidos com a estrutura atualizada
            db.run(`
                CREATE TABLE IF NOT EXISTS usuarios_atendidos (
                    chat_id TEXT UNIQUE,
                    tipo TEXT,
                    ultima_mensagem INTEGER
                )
            `, (err) => {
                if (err) {
                    console.error('❌ Erro ao criar tabela usuarios_atendidos:', err.message);
                    reject(err);
                    return;
                }
                console.log('✅ Tabela usuarios_atendidos criada ou já existe');
            });

            // Função para executar a migração de forma assíncrona
            const migrateTable = () => {
                return new Promise((resolveMigrate, rejectMigrate) => {
                    // Verificar se a coluna timestamp existe e ultima_mensagem não existe
                    db.all("PRAGMA table_info(usuarios_atendidos)", (err, rows) => {
                        if (err) {
                            console.error('❌ Erro ao verificar estrutura da tabela:', err.message);
                            rejectMigrate(err);
                            return;
                        }

                        const hasTimestamp = rows.some(row => row.name === 'timestamp');
                        const hasUltimaMensagem = rows.some(row => row.name === 'ultima_mensagem');

                        if (hasUltimaMensagem || !hasTimestamp) {
                            console.log("✅ Migração não necessária: 'ultima_mensagem' já existe ou 'timestamp' não existe");
                            resolveMigrate();
                            return;
                        }

                        console.log('🔄 Iniciando migração da coluna timestamp para ultima_mensagem...');

                        // Adicionar a nova coluna ultima_mensagem
                        db.run("ALTER TABLE usuarios_atendidos ADD COLUMN ultima_mensagem INTEGER", (err) => {
                            if (err) {
                                console.error('❌ Erro ao adicionar coluna ultima_mensagem:', err.message);
                                rejectMigrate(err);
                                return;
                            }
                            console.log("✅ Coluna 'ultima_mensagem' adicionada com sucesso");

                            // Copiar dados de timestamp para ultima_mensagem
                            db.run("UPDATE usuarios_atendidos SET ultima_mensagem = timestamp", (err) => {
                                if (err) {
                                    console.error('❌ Erro ao copiar dados para ultima_mensagem:', err.message);
                                    rejectMigrate(err);
                                    return;
                                }
                                console.log("✅ Dados copiados de 'timestamp' para 'ultima_mensagem'");

                                // Criar tabela temporária
                                db.run(`
                                    CREATE TABLE usuarios_atendidos_temp (
                                        chat_id TEXT UNIQUE,
                                        tipo TEXT,
                                        ultima_mensagem INTEGER
                                    )
                                `, (err) => {
                                    if (err) {
                                        console.error('❌ Erro ao criar tabela temporária:', err.message);
                                        rejectMigrate(err);
                                        return;
                                    }

                                    // Copiar dados para a tabela temporária
                                    db.run(`
                                        INSERT INTO usuarios_atendidos_temp (chat_id, tipo, ultima_mensagem)
                                        SELECT chat_id, tipo, ultima_mensagem FROM usuarios_atendidos
                                    `, (err) => {
                                        if (err) {
                                            console.error('❌ Erro ao copiar dados para tabela temporária:', err.message);
                                            rejectMigrate(err);
                                            return;
                                        }

                                        // Remover a tabela original
                                        db.run("DROP TABLE usuarios_atendidos", (err) => {
                                            if (err) {
                                                console.error('❌ Erro ao remover tabela original:', err.message);
                                                rejectMigrate(err);
                                                return;
                                            }

                                            // Renomear a tabela temporária
                                            db.run("ALTER TABLE usuarios_atendidos_temp RENAME TO usuarios_atendidos", (err) => {
                                                if (err) {
                                                    console.error('❌ Erro ao renomear tabela:', err.message);
                                                    rejectMigrate(err);
                                                    return;
                                                }
                                                console.log("✅ Migração concluída com sucesso");
                                                resolveMigrate();
                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            };

            // Executar a migração antes de criar as outras tabelas
            migrateTable().then(() => {
                // Criação das demais tabelas
                db.run(`
                    CREATE TABLE IF NOT EXISTS usuarios_saudados (
                        chat_id TEXT UNIQUE
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela usuarios_saudados:', err.message);
                    else console.log('✅ Tabela usuarios_saudados criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS cadastro_em_andamento (
                        chat_id TEXT UNIQUE,
                        etapa TEXT,
                        nome TEXT,
                        numero TEXT,
                        restaurante TEXT,
                        chat_id_original TEXT
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela cadastro_em_andamento:', err.message);
                    else console.log('✅ Tabela cadastro_em_andamento criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS cadastros (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        nome TEXT,
                        numero TEXT,
                        restaurante TEXT,
                        chat_id_original TEXT,
                        timestamp INTEGER
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela cadastros:', err.message);
                    else console.log('✅ Tabela cadastros criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS acoes_pendentes (
                        chat_id TEXT UNIQUE,
                        acao TEXT,
                        parametro TEXT
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela acoes_pendentes:', err.message);
                    else console.log('✅ Tabela acoes_pendentes criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS usuarios_chatbot (
                        chat_id TEXT UNIQUE,
                        timestamp INTEGER
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela usuarios_chatbot:', err.message);
                    else console.log('✅ Tabela usuarios_chatbot criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS usuarios_intervencao (
                        chat_id TEXT UNIQUE
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela usuarios_intervencao:', err.message);
                    else console.log('✅ Tabela usuarios_intervencao criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS verification_codes (
                        chat_id TEXT PRIMARY KEY,
                        code TEXT,
                        timestamp INTEGER
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela verification_codes:', err.message);
                    else console.log('✅ Tabela verification_codes criada ou já existe');
                });

                db.run(`
                    CREATE TABLE IF NOT EXISTS message_log (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        chat_id TEXT,
                        message TEXT,
                        timestamp INTEGER
                    )
                `, (err) => {
                    if (err) console.error('❌ Erro ao criar tabela message_log:', err.message);
                    else console.log('✅ Tabela message_log criada ou já existe');
                });

                console.log('✅ Tabelas criadas ou já existem');
                resolve(db);
            }).catch((err) => {
                console.error('❌ Erro durante a migração:', err.message);
                reject(err);
            });
        });
    });
}

function getDb() {
    if (!db) {
        throw new Error('Database not initialized. Call initDatabase first.');
    }
    return db;
}

// Função para logar mensagens no banco de dados
function logMessage(chatId, message) {
    const db = getDb();
    db.run(
        'INSERT INTO message_log (chat_id, message, timestamp) VALUES (?, ?, ?)',
        [chatId, message, Date.now()],
        (err) => {
            if (err) {
                console.error('❌ Erro ao registrar mensagem:', err.message);
            } else {
                console.log('✅ Mensagem registrada:', { chatId, message });
            }
        }
    );
}

// Função para verificar se o usuário está em intervenção do admin (bot pausado)
function isUserInIntervencao(chatId) {
    return new Promise((resolve, reject) => {
        getDb().get('SELECT 1 FROM usuarios_intervencao WHERE chat_id = ?', [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar intervenção:', err.message);
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });
}

// Função para adicionar usuário à intervenção (parar bot)
function addIntervencao(chatId) {
    return new Promise((resolve, reject) => {
        getDb().run('INSERT OR IGNORE INTO usuarios_intervencao (chat_id) VALUES (?)', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao adicionar intervenção:', err.message);
                reject(err);
            } else {
                console.log('✅ Intervenção adicionada:', chatId);
                resolve();
            }
        });
    });
}

// Função para remover usuário da intervenção (reativar bot)
function removeIntervencao(chatId) {
    return new Promise((resolve, reject) => {
        getDb().run('DELETE FROM usuarios_intervencao WHERE chat_id = ?', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao remover intervenção:', err.message);
                reject(err);
            } else {
                console.log('✅ Intervenção removida:', chatId);
                resolve();
            }
        });
    });
}

// Função para listar atendimentos ativos (atendidos + chatbot + intervenção)
async function listarAtendimentosAtivos(client, adminChatId, config) {
    return new Promise((resolve) => {
        const timeout = config.timeoutAtendimento;
        const now = Date.now();

        // Buscar todos os grupos
        getDb().all('SELECT chat_id, tipo, ultima_mensagem FROM usuarios_atendidos WHERE ultima_mensagem > ?', [now - timeout], async (err, atendidos) => {
            if (err) {
                console.error('❌ Erro ao listar atendimentos:', err.message);
                await client.sendMessage(adminChatId, '⚠️ Erro ao listar atendimentos.');
                return resolve();
            }
            getDb().all('SELECT chat_id, timestamp FROM usuarios_chatbot WHERE timestamp > ?', [now - timeout], async (err, chatbots) => {
                if (err) {
                    console.error('❌ Erro ao listar chatbots:', err.message);
                    await client.sendMessage(adminChatId, '⚠️ Erro ao listar chatbots.');
                    return resolve();
                }
                getDb().all('SELECT chat_id FROM usuarios_intervencao', [], async (err, intervencoes) => {
                    if (err) {
                        console.error('❌ Erro ao listar intervenções:', err.message);
                        await client.sendMessage(adminChatId, '⚠️ Erro ao listar intervenções.');
                        return resolve();
                    }
                    getDb().all('SELECT chat_id FROM cadastro_em_andamento', [], async (err, cadastros) => {
                        if (err) {
                            console.error('❌ Erro ao listar cadastros em andamento:', err.message);
                            await client.sendMessage(adminChatId, '⚠️ Erro ao listar cadastros em andamento.');
                            return resolve();
                        }
                        getDb().all('SELECT chat_id FROM usuarios_saudados', [], async (err, saudados) => {
                            if (err) {
                                console.error('❌ Erro ao listar saudados:', err.message);
                                await client.sendMessage(adminChatId, '⚠️ Erro ao listar saudados.');
                                return resolve();
                            }

                            // Montar listas
                            const idsAtendidos = atendidos.map(x => x.chat_id);
                            const idsChatbot = chatbots.map(x => x.chat_id);
                            const idsIntervencao = intervencoes.map(x => x.chat_id);
                            const idsCadastro = cadastros.map(x => x.chat_id);

                            // Usuários no menu: saudados que não estão em nenhum dos outros grupos
                            const idsMenu = saudados
                                .map(x => x.chat_id)
                                .filter(id => !idsAtendidos.includes(id) && !idsChatbot.includes(id) && !idsIntervencao.includes(id) && !idsCadastro.includes(id));

                            let resposta = '📋 *Status dos Usuários*\n\n';
                            let total = 0;

                            // Atendimento manual
                            if (idsAtendidos.length > 0) {
                                resposta += '👨‍💼 *Em Atendimento Manual:*\n';
                                for (const row of atendidos) {
                                    try {
                                        const contact = await client.getContactById(row.chat_id);
                                        const name = contact.pushname || row.chat_id.slice(0, -5);
                                        const tipo = row.tipo || 'atendimento';
                                        resposta += `• ${name} (${row.chat_id}) [${tipo}]\n`;
                                    } catch {
                                        resposta += `• Desconhecido (${row.chat_id}) [${row.tipo || 'atendimento'}]\n`;
                                    }
                                    total++;
                                }
                                resposta += '\n';
                            }

                            // ChatBot
                            if (idsChatbot.length > 0) {
                                resposta += '🤖 *Em ChatBot:*\n';
                                for (const id of idsChatbot) {
                                    try {
                                        const contact = await client.getContactById(id);
                                        const name = contact.pushname || id.slice(0, -5);
                                        resposta += `• ${name} (${id})\n`;
                                    } catch {
                                        resposta += `• Desconhecido (${id})\n`;
                                    }
                                    total++;
                                }
                                resposta += '\n';
                            }

                            // Intervenção
                            if (idsIntervencao.length > 0) {
                                resposta += '🛑 *Em Intervenção (Bot Pausado):*\n';
                                for (const id of idsIntervencao) {
                                    try {
                                        const contact = await client.getContactById(id);
                                        const name = contact.pushname || id.slice(0, -5);
                                        resposta += `• ${name} (${id})\n`;
                                    } catch {
                                        resposta += `• Desconhecido (${id})\n`;
                                    }
                                    total++;
                                }
                                resposta += '\n';
                            }

                            // Cadastro em andamento
                            if (idsCadastro.length > 0) {
                                resposta += '📝 *Em Cadastro (preenchendo dados):*\n';
                                for (const id of idsCadastro) {
                                    try {
                                        const contact = await client.getContactById(id);
                                        const name = contact.pushname || id.slice(0, -5);
                                        resposta += `• ${name} (${id})\n`;
                                    } catch {
                                        resposta += `• Desconhecido (${id})\n`;
                                    }
                                    total++;
                                }
                                resposta += '\n';
                            }

                            // No menu principal
                            if (idsMenu.length > 0) {
                                resposta += '🏠 *No Menu Principal:*\n';
                                for (const id of idsMenu) {
                                    try {
                                        const contact = await client.getContactById(id);
                                        const name = contact.pushname || id.slice(0, -5);
                                        resposta += `• ${name} (${id})\n`;
                                    } catch {
                                        resposta += `• Desconhecido (${id})\n`;
                                    }
                                    total++;
                                }
                                resposta += '\n';
                            }

                            if (total === 0) {
                                resposta += 'Nenhum usuário ativo no momento.';
                            }

                            await client.sendMessage(adminChatId, resposta);
                            resolve();
                        });
                    });
                });
            });
        });
    });
}

// Função para verificar se o usuário está em modo chatbot
function isUserInChatbotMode(chatId, config) {
    return new Promise((resolve, reject) => {
        getDb().get('SELECT timestamp FROM usuarios_chatbot WHERE chat_id = ?', [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar modo chatbot:', err.message);
                reject(err);
            } else if (!row || !row.timestamp) {
                resolve(false);
            } else {
                const now = Date.now();
                if (now - row.timestamp > config.timeoutAtendimento) {
                    getDb().run('DELETE FROM usuarios_chatbot WHERE chat_id = ?', [chatId], (err) => {
                        if (err) console.error('❌ Erro ao remover modo chatbot expirado:', err.message);
                    });
                    resolve(false);
                } else {
                    resolve(true);
                }
            }
        });
    });
}

// Função para adicionar um usuário ao modo chatbot
function addUserToChatbotMode(chatId) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        getDb().run('INSERT OR REPLACE INTO usuarios_chatbot (chat_id, timestamp) VALUES (?, ?)', [chatId, timestamp], (err) => {
            if (err) {
                console.error('❌ Erro ao adicionar usuário ao modo chatbot:', err.message);
                reject(err);
            } else {
                console.log('✅ Usuário adicionado ao modo chatbot:', chatId);
                resolve();
            }
        });
    });
}

// Função para remover um usuário do modo chatbot
function removeUserFromChatbotMode(chatId) {
    return new Promise((resolve, reject) => {
        getDb().run('DELETE FROM usuarios_chatbot WHERE chat_id = ?', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao remover usuário do modo chatbot:', err.message);
                reject(err);
            } else {
                console.log('✅ Usuário removido do modo chatbot:', chatId);
                resolve();
            }
        });
    });
}

// Função para verificar se o usuário foi atendido
function isUserAtendido(chatId, config) {
    return new Promise((resolve, reject) => {
        getDb().get('SELECT ultima_mensagem FROM usuarios_atendidos WHERE chat_id = ?', [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar atendimento:', err.message);
                reject(err);
            } else if (!row || !row.ultima_mensagem) {
                resolve(false);
            } else {
                const now = Date.now();
                if (now - row.ultima_mensagem > config.timeoutAtendimento) {
                    getDb().run('DELETE FROM usuarios_atendidos WHERE chat_id = ?', [chatId], (err) => {
                        if (err) console.error('❌ Erro ao remover atendimento expirado:', err.message);
                    });
                    resolve(false);
                } else {
                    resolve(true);
                }
            }
        });
    });
}

// Função para adicionar um usuário na lista de atendidos
function addUserAtendido(chatId, config) {
    return new Promise((resolve, reject) => {
        const timestamp = Date.now();
        getDb().run('INSERT OR REPLACE INTO usuarios_atendidos (chat_id, tipo, ultima_mensagem) VALUES (?, ?, ?)', [chatId, 'atendimento', timestamp], (err) => {
            if (err) {
                console.error('❌ Erro ao adicionar usuário atendido:', err.message);
                reject(err);
            } else {
                console.log('✅ Usuário atendido adicionado:', chatId);
                resolve();
            }
        });
    });
}

// Função para verificar se o usuário foi saudado
function isUserSaudado(chatId) {
    return new Promise((resolve, reject) => {
        getDb().get('SELECT 1 FROM usuarios_saudados WHERE chat_id = ?', [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar saudação:', err.message);
                reject(err);
            } else {
                resolve(!!row);
            }
        });
    });
}

// Função para adicionar um usuário na lista de saudados
function addUserSaudado(chatId) {
    return new Promise((resolve, reject) => {
        getDb().run('INSERT OR IGNORE INTO usuarios_saudados (chat_id) VALUES (?)', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao adicionar usuário saudado:', err.message);
                reject(err);
            } else {
                console.log('✅ Usuário saudado adicionado:', chatId);
                resolve();
            }
        });
    });
}

// Função para verificar o estado do cadastro
function getCadastroEstado(chatId) {
    return new Promise((resolve, reject) => {
        getDb().get('SELECT etapa, nome, numero, restaurante, chat_id_original FROM cadastro_em_andamento WHERE chat_id = ?', [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar estado do cadastro:', err.message);
                reject(err);
            } else {
                if (row && !row.chat_id_original) {
                    row.chat_id_original = chatId;
                }
                resolve(row || { etapa: null, chat_id_original: chatId });
            }
        });
    });
}

// Função para atualizar o estado do cadastro
function atualizarCadastroEstado(chatId, etapa, dados = {}) {
    return new Promise((resolve, reject) => {
        const { nome, numero, restaurante, chat_id_original } = dados;
        getDb().run(
            'INSERT OR REPLACE INTO cadastro_em_andamento (chat_id, etapa, nome, numero, restaurante, chat_id_original) VALUES (?, ?, ?, ?, ?, ?)',
            [chatId, etapa, nome || null, numero || null, restaurante || null, chat_id_original || chatId],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao atualizar estado do cadastro:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Estado de cadastro atualizado:', { chatId, etapa });
                    resolve();
                }
            }
        );
    });
}

// Função para finalizar o cadastro
function finalizarCadastro(chatId) {
    return new Promise((resolve, reject) => {
        getDb().run('DELETE FROM cadastro_em_andamento WHERE chat_id = ?', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao finalizar cadastro:', err.message);
                reject(err);
            } else {
                console.log('✅ Cadastro finalizado:', chatId);
                resolve();
            }
        });
    });
}

// Função para salvar o cadastro permanentemente
function salvarCadastroPermanente(dados) {
    return new Promise((resolve, reject) => {
        const { nome, numero, restaurante, chat_id_original } = dados;
        const timestamp = Date.now();
        getDb().run(
            'INSERT INTO cadastros (nome, numero, restaurante, chat_id_original, timestamp) VALUES (?, ?, ?, ?, ?)',
            [nome, numero, restaurante, chat_id_original, timestamp],
            (err) => {
                if (err) {
                    console.error('❌ Erro ao salvar cadastro permanente:', err.message);
                    reject(err);
                } else {
                    console.log('✅ Cadastro salvo com sucesso na tabela cadastros:', dados);
                    resolve();
                }
            }
        );
    });
}

// Função para validar número de WhatsApp
function validarNumero(numero) {
    numero = numero.replace(/\D/g, '');
    if (numero.startsWith('55')) {
        numero = numero.slice(2);
    }
    if (numero.length >= 10 && numero.length <= 11) {
        return '55' + numero + '@c.us';
    }
    return null;
}

// Função para deletar um cadastro específico por ID
function deletarCadastro(id) {
    return new Promise((resolve, reject) => {
        getDb().run('DELETE FROM cadastros WHERE id = ?', [id], (err) => {
            if (err) {
                console.error('❌ Erro ao deletar cadastro:', err.message);
                reject(err);
            } else {
                console.log('✅ Cadastro deletado:', id);
                resolve();
            }
        });
    });
}

// Função para exportar cadastros para CSV e enviar via WhatsApp
function exportarCadastros(chatId, client) {
    return new Promise((resolve, reject) => {
        getDb().all('SELECT * FROM cadastros ORDER BY timestamp DESC', [], (err, rows) => {
            if (err) {
                console.error('❌ Erro ao exportar cadastros:', err.message);
                reject(err);
                return;
            }
            if (rows.length === 0) {
                client.sendMessage(chatId, '📋 Nenhum cadastro encontrado para exportar.');
                resolve();
                return;
            }

            let csvContent = 'id,nome,numero,restaurante,chat_id_original,timestamp\n';
            rows.forEach(row => {
                csvContent += `${row.id},"${row.nome.replace(/"/g, '""')}","${row.numero.replace(/"/g, '""')}","${row.restaurante.replace(/"/g, '""')}","${row.chat_id_original}",${row.timestamp}\n`;
            });

            const filePath = './cadastros_exportados.csv';
            fs.writeFileSync(filePath, csvContent);

            const media = MessageMedia.fromFilePath(filePath);
            client.sendMessage(chatId, media, { caption: '📊 Aqui está o export de cadastros em CSV.' })
                .then(() => {
                    fs.unlinkSync(filePath);
                    console.log('✅ Cadastros exportados para:', chatId);
                    resolve();
                })
                .catch(err => {
                    console.error('❌ Erro ao enviar CSV:', err.message);
                    reject(err);
                });
        });
    });
}

// Função para armazenar ação administrativa pendente
function armazenarAcaoPendente(chatId, acao, parametro = null) {
    return new Promise((resolve, reject) => {
        getDb().run('INSERT OR REPLACE INTO acoes_pendentes (chat_id, acao, parametro) VALUES (?, ?, ?)', [chatId, acao, parametro], (err) => {
            if (err) {
                console.error('❌ Erro ao armazenar ação pendente:', err.message);
                reject(err);
            } else {
                console.log('✅ Ação pendente armazenada:', { chatId, acao, parametro });
                resolve();
            }
        });
    });
}

// Função para verificar ação administrativa pendente
function verificarAcaoPendente(chatId) {
    return new Promise((resolve, reject) => {
        getDb().get('SELECT acao, parametro FROM acoes_pendentes WHERE chat_id = ?', [chatId], (err, row) => {
            if (err) {
                console.error('❌ Erro ao verificar ação pendente:', err.message);
                reject(err);
            } else {
                resolve(row || null);
            }
        });
    });
}

// Função para limpar ação administrativa pendente
function limparAcaoPendente(chatId) {
    return new Promise((resolve, reject) => {
        getDb().run('DELETE FROM acoes_pendentes WHERE chat_id = ?', [chatId], (err) => {
            if (err) {
                console.error('❌ Erro ao limpar ação pendente:', err.message);
                reject(err);
            } else {
                console.log('✅ Ação pendente limpa:', chatId);
                resolve();
            }
        });
    });
}

module.exports = {
    initDatabase,
    getDb,
    logMessage,
    isUserInIntervencao,
    addIntervencao,
    removeIntervencao,
    listarAtendimentosAtivos,
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
    deletarCadastro,
    exportarCadastros,
    armazenarAcaoPendente,
    verificarAcaoPendente,
    limparAcaoPendente
};