// dbConnection.js
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: '193.203.175.140', // Preencha com o host da Hostinger (ex.: 'mysql.hostinger.com' ou IP)
  user: 'u393822572_minhaloja', // Preencha com o usuário do banco de dados
  password: '@Jeeckswat123', // Preencha com a senha do banco de dados
  database: 'u393822572_minhaloja', // Preencha com o nome do banco de dados (ex.: 'u393822572_minhaloja' ou outro)
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

module.exports = pool;