const pool = require('./dbConnection');

async function testConnection() {
  let connection;
  try {
    // Tenta obter uma conexão do pool
    connection = await pool.getConnection();
    console.log('✅ Conexão ao banco de dados estabelecida com sucesso!');

    // Executa uma query simples para testar a conexão
    const [rows] = await connection.query('SELECT 1 AS test');
    console.log('✅ Query de teste executada com sucesso:', rows);

  } catch (err) {
    console.error('❌ Erro ao conectar ao banco de dados:', err.message);
  } finally {
    if (connection) connection.release(); // Libera a conexão de volta ao pool
    process.exit(0); // Encerra o script
  }
}

// Executa o teste
testConnection();