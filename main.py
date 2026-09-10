"""FastAPI Event Bus and Web Server for the Multi-Agent Software Sandbox.

Implements the reactive Blackboard architecture:
- Global asyncio.Queue acting as the non-blocking internal event bus.
- POST /task endpoint for ingesting user prompts and writing to SQLite event_log.
- Background worker task listening on the queue, driving the reactive multi-agent loop:
    pending_supervisor -> pending_designer -> pending_coder -> pending_reviewer -> task_completed
- Native WebSocket streaming (WS /ws/events) for broadcasting event updates to UI.
- FTS5 full-text search (GET /search?q=...) for timeline replay querying.
- Single-page dashboard served at GET /.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
import logging
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from agents import AgentDispatcher
from database import (
    get_event,
    get_recent_events,
    init_db,
    insert_event,
    search_events,
)
from schemas import EventResponse, SearchResponse, TaskCreate

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("sandbox.main")

# Global event bus queue
event_bus: asyncio.Queue[int] = asyncio.Queue()

# Reference to the background queue worker task
worker_task: Optional[asyncio.Task] = None

# Autonomous Agent Dispatcher
dispatcher = AgentDispatcher()

STATIC_DIR = Path(__file__).parent / "static"


class ConnectionManager:
    """Manages real-time WebSocket client connections and event broadcasting."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("WebSocket client connected (%d total)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
            logger.info("WebSocket client disconnected (%d remaining)", len(self.active_connections))

    async def broadcast(self, message: Dict[str, Any]) -> None:
        """Broadcast an event payload to all active WebSocket clients."""
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception as exc:
                logger.warning("Failed to send WebSocket message, dropping client: %s", exc)
                self.disconnect(connection)


manager = ConnectionManager()


async def queue_worker() -> None:
    """Background worker continuously popping events and executing reactive agent handoffs."""
    logger.info("Event bus queue worker started.")
    while True:
        try:
            event_id = await event_bus.get()
            event = await get_event(event_id)
            if event:
                # Terminal output for real-time monitoring
                print(
                    f"\n[EVENT BUS WORKER] >>> Popped Event #{event['id']} <<<\n"
                    f"  Role   : {event['agent_role']}\n"
                    f"  Status : {event['status']}\n"
                    f"  Data   : {str(event['data'])[:120]}...\n",
                    flush=True,
                )

                # Broadcast to all connected WebSocket UI clients
                await manager.broadcast(event)

                # Reactive Autonomous Agent Dispatch
                next_action = await dispatcher.process_event(event)
                if next_action:
                    next_id = await insert_event(
                        agent_role=next_action["agent_role"],
                        status=next_action["status"],
                        data=next_action["data"],
                    )
                    await event_bus.put(next_id)
                    logger.info(
                        "Autonomous Transition: Event #%d generated next event #%d (%s: %s)",
                        event["id"],
                        next_id,
                        next_action["agent_role"],
                        next_action["status"],
                    )
            else:
                logger.warning("Event ID %d popped from queue but not found in database", event_id)

            event_bus.task_done()
        except asyncio.CancelledError:
            logger.info("Event bus queue worker cancelled.")
            break
        except Exception as exc:
            logger.error("Error in queue_worker: %s", exc, exc_info=True)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage application startup (DB init, background queue worker) and graceful shutdown."""
    global worker_task
    await init_db()
    worker_task = asyncio.create_task(queue_worker())
    logger.info("Application startup complete.")
    yield
    if worker_task:
        worker_task.cancel()
        try:
            await worker_task
        except asyncio.CancelledError:
            pass
    logger.info("Application shutdown complete.")


app = FastAPI(
    title="Multi-Agent Software Sandbox",
    description="Reactive blackboard and event bus for autonomous multi-agent software development",
    version="0.2.0",
    lifespan=lifespan,
)

if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
async def get_index() -> HTMLResponse:
    """Serve the single-page HTML interface for real-time monitoring and searching."""
    index_file = STATIC_DIR / "index.html"
    if index_file.exists():
        return HTMLResponse(content=index_file.read_text(encoding="utf-8"))
    return HTMLResponse("<h2>Multi-Agent Software Sandbox is Running</h2>")


@app.get("/health")
async def health_check() -> Dict[str, Any]:
    """Health check endpoint confirming event bus queue and database status."""
    return {
        "status": "healthy",
        "queue_size": event_bus.qsize(),
        "connected_ws_clients": len(manager.active_connections),
        "model": dispatcher.llm.model,
    }


@app.post("/task", response_model=EventResponse)
async def create_task(task: TaskCreate) -> EventResponse:
    """Ingest user prompt, write entry to SQLite event_log, and push ID to event_bus."""
    if not task.prompt.strip():
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")

    event_id = await insert_event(
        agent_role="user",
        status="pending_supervisor",
        data={"prompt": task.prompt.strip()},
    )

    # Enqueue event ID to the internal asyncio event bus
    await event_bus.put(event_id)
    logger.info("Task ingested: event_id=%d pushed to event bus queue", event_id)

    event = await get_event(event_id)
    if not event:
        raise HTTPException(status_code=500, detail="Failed to retrieve created event")

    return EventResponse(
        id=event["id"],
        timestamp=event["timestamp"],
        role=event["agent_role"],
        status=event["status"],
        data=event["data"],
    )


@app.get("/search", response_model=SearchResponse)
async def search_timeline(
    q: str = Query(..., min_length=1, description="Keywords to query via SQLite FTS5"),
    limit: int = Query(50, ge=1, le=200),
) -> SearchResponse:
    """Search event histories using the SQLite FTS5 full-text search index."""
    raw_results = await search_events(query=q, limit=limit)
    results = [
        EventResponse(
            id=row["id"],
            timestamp=row["timestamp"],
            role=row["agent_role"],
            status=row["status"],
            data=row["data"],
        )
        for row in raw_results
    ]
    return SearchResponse(query=q, count=len(results), results=results)


@app.get("/events", response_model=List[EventResponse])
async def list_recent_events(limit: int = Query(50, ge=1, le=200)) -> List[EventResponse]:
    """Retrieve the most recent blackboard events."""
    raw_events = await get_recent_events(limit=limit)
    return [
        EventResponse(
            id=row["id"],
            timestamp=row["timestamp"],
            role=row["agent_role"],
            status=row["status"],
            data=row["data"],
        )
        for row in raw_events
    ]


@app.websocket("/ws/events")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """WebSocket streaming endpoint broadcasting live database events to the client."""
    await manager.connect(websocket)
    try:
        while True:
            _ = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception as exc:
        logger.debug("WebSocket exception: %s", exc)
        manager.disconnect(websocket)
