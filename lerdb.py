import sqlite3
import sys

def migrate_usuarios_atendidos():
    try:
        # Conectar ao banco de dados
        db = sqlite3.connect('./usuarios.db')
        cursor = db.cursor()
        
        # Adicionar a nova coluna ultima_mensagem
        cursor.execute("ALTER TABLE usuarios_atendidos ADD COLUMN ultima_mensagem INTEGER")
        print("✅ Coluna 'ultima_mensagem' adicionada com sucesso")
        
        # Copiar dados de timestamp para ultima_mensagem
        cursor.execute("UPDATE usuarios_atendidos SET ultima_mensagem = timestamp")
        print("✅ Dados copiados de 'timestamp' para 'ultima_mensagem'")
        
        # Remover a coluna antiga timestamp
        # SQLite não suporta DROP COLUMN diretamente, então criamos uma nova tabela
        cursor.execute("""
            CREATE TABLE usuarios_atendidos_temp (
                chat_id TEXT UNIQUE,
                tipo TEXT,
                ultima_mensagem INTEGER
            )
        """)
        cursor.execute("""
            INSERT INTO usuarios_atendidos_temp (chat_id, tipo, ultima_mensagem)
            SELECT chat_id, tipo, ultima_mensagem FROM usuarios_atendidos
        """)

        
        # Confirmar as alterações
        db.commit()
        print("✅ Migração concluída com sucesso")
        
    except sqlite3.Error as err:
        print(f"❌ Erro durante a migração: {err}")
        sys.exit(1)
    finally:
        db.close()
        print("✅ Conexão com o banco de dados fechada")

if __name__ == "__main__":
    migrate_usuarios_atendidos()