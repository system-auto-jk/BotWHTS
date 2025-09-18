import sqlite3

# Conectar (ou criar) o banco de dados local
conn = sqlite3.connect("bot.db")
cursor = conn.cursor()

# Criar a tabela blocked_numbers
cursor.execute("""
CREATE TABLE IF NOT EXISTS blocked_numbers (
    phone_number TEXT PRIMARY KEY,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
);
""")

# Confirmar e fechar
conn.commit()
conn.close()

print("Tabela criada com sucesso!")
