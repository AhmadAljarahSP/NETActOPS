import os
import sqlite3
import logging

logger = logging.getLogger("semantic_memory")

DB_PATH = os.getenv("DB_PATH", "copilot_history.db")

def init_db():
    """Ensures semantic_memory table exists."""
    try:
        # DB_PATH points to the SQLite db location
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS semantic_memory (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                category TEXT,
                fact_key TEXT,
                fact_value TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)
        conn.commit()
        conn.close()
    except Exception as e:
        logger.error("Failed to initialize semantic_memory: %s", e)

def add_fact(category: str, key: str, value: str):
    """Adds a learned fact to the semantic database."""
    init_db()
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM semantic_memory WHERE category=? AND fact_key=?", (category, key))
        row = cursor.fetchone()
        if row:
            cursor.execute("UPDATE semantic_memory SET fact_value=? WHERE id=?", (value, row[0]))
        else:
            cursor.execute("INSERT INTO semantic_memory (category, fact_key, fact_value) VALUES (?, ?, ?)", (category, key, value))
        conn.commit()
        conn.close()
        logger.info("Semantic memory recorded: %s -> %s = %s", category, key, value)
    except Exception as e:
        logger.error("Failed to add semantic fact: %s", e)

def search_facts(query: str) -> str:
    """Finds semantic facts relevant to the search query.
    Only returns facts whose category (device hostname) appears explicitly in the query.
    This prevents healthcheck data for device X from polluting unrelated general queries."""
    init_db()
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute("SELECT category, fact_key, fact_value FROM semantic_memory")
        rows = cursor.fetchall()
        conn.close()

        relevant = []
        query_lower = query.lower()
        for cat, k, v in rows:
            # Only surface this fact if the device name (category) is explicitly
            # mentioned in the query. Never match on generic fact-key words like
            # "status", "last", "healthcheck" — those appear in almost every query.
            if cat.lower() in query_lower:
                relevant.append(f"- **{cat}** [{k}]: {v}")

        if relevant:
            return "=== PERSISTENT SEMANTIC MEMORY ===\n" + "\n".join(relevant) + "\n\n"
        return ""
    except Exception as e:
        logger.error("Failed to search semantic memory: %s", e)
        return ""
