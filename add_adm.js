// addAdmin.js
const pool = require('./dbConnection');

async function addAdmin(email, password) {
  let connection;
  try {
    connection = await pool.getConnection();
    const [result] = await connection.query(
      'INSERT INTO admins (email, password) VALUES (?, ?)',
      [email, password]
    );
    console.log(`✅ Administrador adicionado com sucesso! ID: ${result.insertId}, Email: ${email}`);
  } catch (err) {
    console.error('❌ Erro ao adicionar administrador:', err.message);
  } finally {
    if (connection) connection.release();
    process.exit(0);
  }
}

// Exemplo de uso
(async () => {
  const email = 'systemautojk@gmail.com'; // Substitua pelo email desejado
  const password = '123teste'; // Substitua pela senha desejada
  await addAdmin(email, password);
})();