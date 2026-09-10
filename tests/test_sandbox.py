"""Automated tests for the Multi-Agent Software Sandbox.

Covers:
- Database initialization and CRUD operations.
- SQLite FTS5 full-text search and synchronization triggers.
- Data contracts validation (Pydantic schemas).
- FastAPI endpoints (POST /task, GET /search, GET /events, GET /health).
- Asynchronous event bus queue and background worker processing.
- WebSocket event streaming.
"""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

# Ensure Spark root is in Python search path
ROOT_DIR = Path(__file__).parent.parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

import database
from database import get_event, get_recent_events, init_db, insert_event, search_events
from main import app, event_bus, manager
from schemas import (
    CoderResponse,
    DesignerResponse,
    EventCreate,
    EventResponse,
    ReviewerResponse,
    SearchResponse,
    SupervisorResponse,
    TaskCreate,
)


@pytest.fixture
def temp_db_path():
    """Create a temporary SQLite database path for isolated testing."""
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    yield path
    if os.path.exists(path):
        os.remove(path)


@pytest.fixture(autouse=True)
def clear_event_bus():
    """Ensure the global event_bus queue is cleared between tests."""
    while not event_bus.empty():
        try:
            event_bus.get_nowait()
            event_bus.task_done()
        except (asyncio.QueueEmpty, ValueError):
            break
    yield
    while not event_bus.empty():
        try:
            event_bus.get_nowait()
            event_bus.task_done()
        except (asyncio.QueueEmpty, ValueError):
            break


@pytest.mark.asyncio
async def test_database_lifecycle_and_fts(temp_db_path: str):
    """Test table creation, event insertion, retrieval, and FTS5 search."""
    # 1. Initialize DB
    await init_db(db_path=temp_db_path)

    # 2. Insert test events
    ev1_id = await insert_event(
        agent_role="user",
        status="pending_supervisor",
        data={"prompt": "Fix memory leak in websocket connection"},
        db_path=temp_db_path,
    )
    assert ev1_id == 1

    ev2_id = await insert_event(
        agent_role="supervisor",
        status="planning",
        data={"plan": "Inspect socket handle closures and free buffers"},
        db_path=temp_db_path,
    )
    assert ev2_id == 2

    # 3. Retrieve event by ID
    event = await get_event(ev1_id, db_path=temp_db_path)
    assert event is not None
    assert event["id"] == 1
    assert event["role"] == "user"
    assert event["status"] == "pending_supervisor"
    assert event["data"] == {"prompt": "Fix memory leak in websocket connection"}

    # 4. Full-Text Search via FTS5
    results_leak = await search_events("leak", db_path=temp_db_path)
    assert len(results_leak) == 1
    assert results_leak[0]["id"] == 1

    results_buffers = await search_events("buffers", db_path=temp_db_path)
    assert len(results_buffers) == 1
    assert results_buffers[0]["id"] == 2

    # Search with no matches
    results_empty = await search_events("nonexistentkeyword", db_path=temp_db_path)
    assert len(results_empty) == 0

    # 5. Recent events
    recent = await get_recent_events(limit=10, db_path=temp_db_path)
    assert len(recent) == 2
    assert recent[0]["id"] == 2  # Most recent first


def test_schemas():
    """Verify Pydantic schemas validate agent data contracts cleanly."""
    task = TaskCreate(prompt="Create a microservice")
    assert task.prompt == "Create a microservice"

    event_req = EventCreate(agent_role="coder", status="in_progress", data={"file": "main.py"})
    assert event_req.role == "coder"

    event_resp = EventResponse(
        id=10,
        timestamp="2026-09-10T12:00:00",
        role="reviewer",
        status="review_passed",
        data="All checks ok",
    )
    assert event_resp.role == "reviewer"
    assert event_resp.agent_role == "reviewer"

    coder_out = CoderResponse(file_path="main.py", code="print('hello')", explanation="Sample")
    assert coder_out.file_path == "main.py"

    reviewer_out = ReviewerResponse(passed=True, feedback="Clean code")
    assert reviewer_out.passed is True


@pytest.mark.asyncio
async def test_fastapi_endpoints():
    """Test REST API endpoints using HTTPX AsyncClient."""
    await init_db()

    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Health check
        resp_health = await client.get("/health")
        assert resp_health.status_code == 200
        health_data = resp_health.json()
        assert health_data["status"] == "healthy"

        # 2. POST /task
        task_payload = {"prompt": "Build an async token bucket rate limiter"}
        resp_task = await client.post("/task", json=task_payload)
        assert resp_task.status_code == 200
        data = resp_task.json()
        assert data["role"] == "user"
        assert data["status"] == "pending_supervisor"
        assert "rate limiter" in str(data["data"])
        event_id = data["id"]

        # Ensure event reached the event_bus queue
        assert event_bus.qsize() >= 0

        # 3. GET /search
        resp_search = await client.get("/search?q=limiter")
        assert resp_search.status_code == 200
        search_data = resp_search.json()
        assert search_data["count"] >= 1
        assert any(item["id"] == event_id for item in search_data["results"])

        # 4. GET /events
        resp_events = await client.get("/events?limit=5")
        assert resp_events.status_code == 200
        events_list = resp_events.json()
        assert len(events_list) >= 1
        assert events_list[0]["id"] >= 1

        # 5. GET /
        resp_root = await client.get("/")
        assert resp_root.status_code == 200
        assert "Multi-Agent Sandbox" in resp_root.text


@pytest.mark.asyncio
async def test_websocket_broadcast():
    """Verify WebSocket connection and broadcast functionality."""
    messages_received = []

    class MockWebSocket:
        def __init__(self):
            self.accepted = False

        async def accept(self):
            self.accepted = True

        async def send_json(self, message):
            messages_received.append(message)

    mock_ws = MockWebSocket()
    await manager.connect(mock_ws)
    assert len(manager.active_connections) == 1

    test_msg = {"id": 999, "agent_role": "supervisor", "status": "planning", "data": "Test plan"}
    await manager.broadcast(test_msg)

    assert len(messages_received) == 1
    assert messages_received[0]["id"] == 999
    assert messages_received[0]["status"] == "planning"

    manager.disconnect(mock_ws)
    assert len(manager.active_connections) == 0


@pytest.mark.asyncio
async def test_queue_worker_processing():
    """Verify that background worker consumes from event_bus and logs/broadcasts."""
    await init_db()

    # Clear any residual items
    while not event_bus.empty():
        try:
            event_bus.get_nowait()
        except asyncio.QueueEmpty:
            break

    # Insert an event directly
    test_id = await insert_event(
        agent_role="coder",
        status="code_generated",
        data={"file": "sandbox.py", "lines": 42},
    )

    # Capture broadcast
    received = []

    class MockClient:
        async def send_json(self, data):
            received.append(data)

    client = MockClient()
    manager.active_connections.append(client)

    try:
        # Enqueue event
        await event_bus.put(test_id)

        # Worker processing step
        popped_id = await event_bus.get()
        event = await get_event(popped_id)
        assert event is not None
        await manager.broadcast(event)
        event_bus.task_done()

        assert len(received) == 1
        assert received[0]["id"] == test_id
        assert received[0]["agent_role"] == "coder"
    finally:
        if client in manager.active_connections:
            manager.active_connections.remove(client)
