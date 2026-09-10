"""Database module for the Multi-Agent Software Sandbox Blackboard.

Provides asynchronous SQLite access using aiosqlite, schema creation for
event_log, and FTS5 full-text search indexing with automatic sync triggers.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Union

import aiosqlite

logger = logging.getLogger("sandbox.database")

DB_NAME = "sandbox.db"
DB_PATH = str(Path(__file__).parent / DB_NAME)

SCHEMA_SQL = """
-- Core Blackboard event timeline
CREATE TABLE IF NOT EXISTS event_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    agent_role TEXT NOT NULL,
    status TEXT NOT NULL,
    data TEXT NOT NULL
);

-- Virtual table using SQLite FTS5 extension linked to event_log for fast text searching on data
CREATE VIRTUAL TABLE IF NOT EXISTS event_log_fts USING fts5(
    data,
    content='event_log',
    content_rowid='id'
);

-- Triggers to synchronize event_log with event_log_fts
CREATE TRIGGER IF NOT EXISTS trg_event_log_ai AFTER INSERT ON event_log BEGIN
    INSERT INTO event_log_fts(rowid, data) VALUES (new.id, new.data);
END;

CREATE TRIGGER IF NOT EXISTS trg_event_log_ad AFTER DELETE ON event_log BEGIN
    INSERT INTO event_log_fts(event_log_fts, rowid, data) VALUES('delete', old.id, old.data);
END;

CREATE TRIGGER IF NOT EXISTS trg_event_log_au AFTER UPDATE ON event_log BEGIN
    INSERT INTO event_log_fts(event_log_fts, rowid, data) VALUES('delete', old.id, old.data);
    INSERT INTO event_log_fts(rowid, data) VALUES (new.id, new.data);
END;
"""


def _parse_row(row: aiosqlite.Row) -> Dict[str, Any]:
    """Parse a database row into a dictionary with deserialized JSON data."""
    raw_data = row["data"]
    try:
        parsed_data = json.loads(raw_data)
    except (json.JSONDecodeError, TypeError):
        parsed_data = raw_data

    role = row["agent_role"]
    return {
        "id": row["id"],
        "timestamp": str(row["timestamp"]),
        "role": role,
        "agent_role": role,
        "status": row["status"],
        "data": parsed_data,
    }


async def init_db(db_path: str = DB_PATH) -> None:
    """Initialize SQLite database with required tables and FTS5 search index."""
    logger.info("Initializing SQLite Blackboard at %s", db_path)
    async with aiosqlite.connect(db_path) as db:
        await db.executescript(SCHEMA_SQL)
        await db.commit()
    logger.info("Blackboard database initialized successfully.")


async def insert_event(
    agent_role: str,
    status: str,
    data: Union[Dict[str, Any], List[Any], str],
    db_path: str = DB_PATH,
) -> int:
    """Insert a new event into the event_log blackboard and return its row ID."""
    serialized_data = json.dumps(data) if not isinstance(data, str) else data

    async with aiosqlite.connect(db_path) as db:
        cursor = await db.execute(
            """
            INSERT INTO event_log (agent_role, status, data)
            VALUES (?, ?, ?)
            """,
            (agent_role, status, serialized_data),
        )
        await db.commit()
        event_id = cursor.lastrowid
        if event_id is None:
            raise RuntimeError("Failed to retrieve lastrowid for inserted event")
        return event_id


async def get_event(event_id: int, db_path: str = DB_PATH) -> Optional[Dict[str, Any]]:
    """Retrieve an event by ID from the blackboard."""
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, timestamp, agent_role, status, data FROM event_log WHERE id = ?",
            (event_id,),
        ) as cursor:
            row = await cursor.fetchone()
            if not row:
                return None
            return _parse_row(row)


async def search_events(
    query: str,
    limit: int = 50,
    db_path: str = DB_PATH,
) -> List[Dict[str, Any]]:
    """Perform a full-text search query across event histories using SQLite FTS5."""
    clean_query = query.strip()
    if not clean_query:
        return []

    # Sanitize search term for SQLite FTS5 syntax
    safe_token = clean_query.replace('"', '""')
    match_expr = f'"{safe_token}"' if " " in clean_query else f"{safe_token}*"

    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        try:
            async with db.execute(
                """
                SELECT e.id, e.timestamp, e.agent_role, e.status, e.data
                FROM event_log_fts f
                JOIN event_log e ON f.rowid = e.id
                WHERE event_log_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (match_expr, limit),
            ) as cursor:
                rows = await cursor.fetchall()
                return [_parse_row(r) for r in rows]
        except aiosqlite.OperationalError:
            async with db.execute(
                """
                SELECT e.id, e.timestamp, e.agent_role, e.status, e.data
                FROM event_log_fts f
                JOIN event_log e ON f.rowid = e.id
                WHERE event_log_fts MATCH ?
                ORDER BY rank
                LIMIT ?
                """,
                (f'"{safe_token}"', limit),
            ) as cursor:
                rows = await cursor.fetchall()
                return [_parse_row(r) for r in rows]


async def get_recent_events(
    limit: int = 50,
    db_path: str = DB_PATH,
) -> List[Dict[str, Any]]:
    """Retrieve the most recent blackboard events in descending order."""
    async with aiosqlite.connect(db_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            """
            SELECT id, timestamp, agent_role, status, data
            FROM event_log
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ) as cursor:
            rows = await cursor.fetchall()
            return [_parse_row(r) for r in rows]
