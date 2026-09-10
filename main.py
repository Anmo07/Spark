"""FastAPI Event Bus and Web Server for the Multi-Agent Software Sandbox.

Implements the reactive Blackboard architecture:
- Global asyncio.Queue acting as the non-blocking internal event bus.
- POST /chat endpoint as Master Agent gateway (intent routing).
- POST /task endpoint for direct pipeline ingestion (backward compat).
- Background worker task listening on the queue, driving the reactive multi-agent loop:
    pending_supervisor -> pending_designer -> pending_coder -> pending_reviewer -> task_completed
- Native WebSocket streaming (WS /ws/events) for broadcasting event updates to UI.
- WS /ws/terminal for interactive PTY shell access.
- Workspace CRUD endpoints for file/directory management.
- FTS5 full-text search (GET /search?q=...) for timeline replay querying.
"""

from __future__ import annotations

import asyncio
import fcntl
from contextlib import asynccontextmanager
import logging
import os
import pty
import shutil
import struct
import subprocess
import termios
from pathlib import Path
from typing import Any, AsyncGenerator, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel as _BaseModel

from agents import AgentDispatcher, MasterAgent
from database import (
    get_event,
    get_recent_events,
    init_db,
    insert_event,
    search_events,
)
from schemas import (
    ChatRequest,
    ChatResponse,
    DeleteFilePayload,
    EventResponse,
    RenameFilePayload,
    RoadmapFeedbackRequest,
    SearchResponse,
    TaskCreate,
)

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

# Master Agent (Phase 3)
master_agent = MasterAgent()

STATIC_DIR = Path(__file__).parent / "static"
WORKSPACE_DIR = Path(__file__).parent / "sandbox_workspace"
ROADMAP_STATE_FILE = Path(__file__).parent / ".spark_roadmap.json"


def save_roadmap_state(roadmap: Optional[Dict[str, Any]]) -> None:
    """Persist active roadmap state to disk so it survives restarts."""
    try:
        if roadmap:
            ROADMAP_STATE_FILE.write_text(json.dumps(roadmap, indent=2), encoding="utf-8")
        elif ROADMAP_STATE_FILE.exists():
            ROADMAP_STATE_FILE.unlink()
    except Exception as exc:
        logger.warning("Failed to save roadmap state: %s", exc)


def load_roadmap_state() -> Optional[Dict[str, Any]]:
    """Load persisted active roadmap state if present."""
    if ROADMAP_STATE_FILE.exists():
        try:
            return json.loads(ROADMAP_STATE_FILE.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("Failed to load roadmap state: %s", exc)
    return None


# Human-in-the-Loop active roadmap state
active_roadmap: Optional[Dict[str, Any]] = load_roadmap_state()

# Track files modified during the active execution session
session_modified_files: List[str] = []


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


async def on_coder_file_write(rel_path: str, content: str) -> None:
    """Invoked whenever Coder agent writes a file to the sandbox workspace."""
    if rel_path not in session_modified_files:
        session_modified_files.append(rel_path)
    # Objective 3.1: Live File Pills in Chat
    await manager.broadcast({
        "type": "file_written",
        "path": rel_path,
        "action": "created",
    })
    # Objective 1.2: Real-time file sync
    await manager.broadcast({
        "type": "fs_update",
        "action": "write",
        "path": rel_path,
    })
    logger.info("Live file write broadcasted: %s", rel_path)


# Wire the live file write callback into the dispatcher
dispatcher.on_file_write = on_coder_file_write


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

                # Context memory: update on task completion
                if event.get("status") == "task_completed":
                    try:
                        master_agent.update_context_from_completion(event.get("data") or {})
                    except Exception as exc:
                        logger.warning("Failed to update context memory: %s", exc)

                    # Objective 3.2: Final Summary output in Chat UI
                    try:
                        files = list(session_modified_files)
                        file_path_data = (event.get("data") or {}).get("file_path")
                        if file_path_data and file_path_data not in files:
                            files.append(file_path_data)
                        summary_text = await master_agent.generate_final_summary(
                            completion_data=event.get("data") or {},
                            modified_files=files,
                        )
                        await manager.broadcast({
                            "type": "final_summary",
                            "content": summary_text,
                            "files": files,
                        })
                        logger.info("Broadcasted final summary with %d files to Chat UI", len(files))

                        # Reset completed roadmap state
                        global active_roadmap
                        if active_roadmap and active_roadmap.get("status") == "approved":
                            active_roadmap = None
                            save_roadmap_state(None)
                    except Exception as exc:
                        logger.error("Failed to generate/broadcast final summary: %s", exc)

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
    version="0.3.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
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


# ---------------------------------------------------------------------------
# Master Agent Chat Gateway (Phase 3)
# ---------------------------------------------------------------------------

@app.post("/chat", response_model=ChatResponse)
async def chat_with_master(req: ChatRequest) -> ChatResponse:
    """Master Agent gateway: classifies intent, manages HITL roadmap workflow, or routes to chat."""
    global active_roadmap
    prompt = req.prompt.strip()
    if not prompt:
        raise HTTPException(status_code=400, detail="Prompt must not be empty.")

    # -----------------------------------------------------------------------
    # Objective 2: Human-in-the-Loop Roadmap State Machine
    # -----------------------------------------------------------------------
    if active_roadmap and active_roadmap.get("status") == "awaiting_approval":
        normalized = prompt.lower()
        is_approval = (
            normalized in [
                "proceed", "approve", "approved", "go ahead", "yes",
                "confirm", "continue", "start", "run", "ok", "lgtm",
            ]
            or normalized.startswith("proceed")
            or normalized.startswith("approve")
        )

        if is_approval:
            # Resumption: Resume pipeline and hand off to Designer
            approved_plan = active_roadmap["plan"]
            task_prompt = active_roadmap["prompt"]
            active_roadmap["status"] = "approved"
            save_roadmap_state(active_roadmap)
            session_modified_files.clear()

            event_id = await insert_event(
                agent_role="supervisor",
                status="pending_designer",
                data={
                    "task_prompt": task_prompt,
                    **approved_plan,
                },
            )
            await event_bus.put(event_id)
            logger.info("HITL: Roadmap APPROVED by user! Resumed pipeline with event #%d", event_id)

            await manager.broadcast({
                "type": "roadmap_status",
                "status": "approved",
                "message": "Roadmap approved. Execution pipeline resumed.",
            })

            return ChatResponse(
                type="system_event",
                content="✅ Roadmap approved! Starting execution with Designer and Coder...",
                status="approved",
            )
        elif normalized in ["cancel", "abort", "stop"]:
            active_roadmap = None
            save_roadmap_state(None)
            return ChatResponse(
                type="chat",
                content="Roadmap execution cancelled. How else can I assist you?",
                status="cancelled",
            )
        else:
            # Custom instructions given by user to revise the roadmap
            logger.info("HITL: User provided custom instructions to revise roadmap: '%s'", prompt[:60])
            try:
                revised_plan = await dispatcher.revise_roadmap(
                    prompt=active_roadmap["prompt"],
                    current_plan=active_roadmap["plan"],
                    feedback=prompt,
                )
                active_roadmap["plan"] = revised_plan.model_dump()
                active_roadmap.setdefault("feedback_history", []).append(prompt)
                save_roadmap_state(active_roadmap)

                return ChatResponse(
                    type="roadmap",
                    content=f"I've updated the roadmap based on your instructions. Please review and reply with **Proceed** or provide further instructions:",
                    roadmap=active_roadmap["plan"],
                    status="awaiting_approval",
                )
            except Exception as exc:
                logger.error("Failed to revise roadmap: %s", exc)
                return ChatResponse(
                    type="roadmap",
                    content=f"Error revising roadmap: {str(exc)}. Retaining current plan. Please review or retry:",
                    roadmap=active_roadmap["plan"],
                    status="awaiting_approval",
                )

    # -----------------------------------------------------------------------
    # Normal Master Agent Routing
    # -----------------------------------------------------------------------
    route_result = await master_agent.route(prompt)

    if route_result.intent == "general_chat":
        chat_text = route_result.chat_response
        if not chat_text or len(chat_text) < 20:
            chat_text = await master_agent.chat(prompt)

        return ChatResponse(
            type="chat",
            content=chat_text,
        )
    else:
        # Project execution: The Pause State!
        # Supervisor generates Roadmap Plan, sends to Chat UI, and pauses pipeline
        logger.info("Master Agent categorized prompt as project_execution. Supervisor generating Roadmap Plan...")
        try:
            supervisor_plan = await dispatcher.generate_roadmap(prompt)
            active_roadmap = {
                "prompt": prompt,
                "plan": supervisor_plan.model_dump(),
                "status": "awaiting_approval",
                "feedback_history": [],
            }
            save_roadmap_state(active_roadmap)
            logger.info("HITL: Roadmap generated. Execution PAUSED awaiting user approval.")
            return ChatResponse(
                type="roadmap",
                content="Here is the architectural roadmap plan. Please review and reply with **Proceed** or provide custom instructions to adjust the plan:",
                roadmap=active_roadmap["plan"],
                status="awaiting_approval",
            )
        except Exception as exc:
            logger.error("Supervisor roadmap generation failed, falling back to direct pipeline: %s", exc)
            event_id = await insert_event(
                agent_role="user",
                status="pending_supervisor",
                data={"prompt": prompt},
            )
            await event_bus.put(event_id)
            return ChatResponse(
                type="system_event",
                content="🚀 Dispatched task directly to agent pipeline.",
                sub_tasks=[prompt],
            )


@app.post("/roadmap/approve", response_model=ChatResponse)
async def approve_roadmap() -> ChatResponse:
    """Explicitly approve the pending roadmap and resume pipeline execution to Designer & Coder."""
    global active_roadmap
    if not active_roadmap or active_roadmap.get("status") != "awaiting_approval":
        raise HTTPException(status_code=400, detail="No roadmap is currently awaiting approval.")

    approved_plan = active_roadmap["plan"]
    task_prompt = active_roadmap["prompt"]
    active_roadmap["status"] = "approved"
    save_roadmap_state(active_roadmap)
    session_modified_files.clear()

    event_id = await insert_event(
        agent_role="supervisor",
        status="pending_designer",
        data={
            "task_prompt": task_prompt,
            **approved_plan,
        },
    )
    await event_bus.put(event_id)
    logger.info("Roadmap APPROVED via /roadmap/approve! Resumed pipeline with event #%d", event_id)

    await manager.broadcast({
        "type": "roadmap_status",
        "status": "approved",
        "message": "Roadmap approved. Pipeline execution resumed.",
    })

    return ChatResponse(
        type="system_event",
        content="✅ Roadmap approved! Starting execution with Designer and Coder...",
        status="approved",
    )


@app.post("/roadmap/feedback", response_model=ChatResponse)
async def feedback_roadmap(payload: RoadmapFeedbackRequest) -> ChatResponse:
    """Submit custom instructions to update the pending roadmap."""
    global active_roadmap
    if not active_roadmap or active_roadmap.get("status") != "awaiting_approval":
        raise HTTPException(status_code=400, detail="No roadmap is currently awaiting approval.")

    feedback_text = payload.feedback.strip()
    if not feedback_text:
        raise HTTPException(status_code=400, detail="Feedback must not be empty.")

    try:
        revised_plan = await dispatcher.revise_roadmap(
            prompt=active_roadmap["prompt"],
            current_plan=active_roadmap["plan"],
            feedback=feedback_text,
        )
        active_roadmap["plan"] = revised_plan.model_dump()
        active_roadmap.setdefault("feedback_history", []).append(feedback_text)
        save_roadmap_state(active_roadmap)

        return ChatResponse(
            type="roadmap",
            content=f"I've updated the roadmap with your instructions. Please review and approve to proceed:",
            roadmap=active_roadmap["plan"],
            status="awaiting_approval",
        )
    except Exception as exc:
        logger.error("Failed to revise roadmap: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to revise roadmap: {exc}")


@app.get("/roadmap/current")
async def get_current_roadmap() -> Dict[str, Any]:
    """Inspect current active roadmap state."""
    return active_roadmap or {"status": "none"}



# ---------------------------------------------------------------------------
# Legacy Task Endpoint (backward compatibility)
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Workspace file-management endpoints
# ---------------------------------------------------------------------------

def _build_tree(root: Path) -> dict:
    """Recursively build a nested dict representing the directory tree."""
    node: dict = {"name": root.name, "type": "directory", "children": []}
    try:
        entries = sorted(root.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
    except PermissionError:
        return node
    for entry in entries:
        if entry.name.startswith("."):
            continue
        if entry.is_dir():
            node["children"].append(_build_tree(entry))
        else:
            node["children"].append({"name": entry.name, "type": "file"})
    return node


def _safe_workspace_path(relative: str) -> Path:
    """Resolve a relative path inside WORKSPACE_DIR; raise 400 on traversal."""
    resolved = (WORKSPACE_DIR / relative).resolve()
    if not str(resolved).startswith(str(WORKSPACE_DIR.resolve())):
        raise HTTPException(status_code=400, detail="Path escapes the sandbox workspace.")
    return resolved


@app.get("/workspace/tree")
async def workspace_tree() -> dict:
    """Return a nested JSON tree of sandbox_workspace/ contents."""
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)
    return _build_tree(WORKSPACE_DIR)


@app.get("/workspace/file")
async def workspace_read_file(path: str = Query(..., description="Relative file path inside sandbox_workspace")) -> dict:
    """Read and return the text content of a workspace file."""
    target = _safe_workspace_path(path)
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"File not found: {path}")
    try:
        content = target.read_text(encoding="utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error reading file: {exc}")
    return {"path": path, "content": content}


class _FileWritePayload(_BaseModel):
    path: str
    content: str

@app.post("/workspace/file")
async def workspace_write_file(payload: _FileWritePayload) -> dict:
    """Write (overwrite) a file inside sandbox_workspace/, auto-creating parent directories."""
    target = _safe_workspace_path(payload.path)
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        target.write_text(payload.content, encoding="utf-8")
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error writing file: {exc}")

    # Objective 1.2: Broadcast fs_update on file write
    await manager.broadcast({
        "type": "fs_update",
        "action": "write",
        "path": payload.path,
    })
    return {"path": payload.path, "size": len(payload.content), "status": "written"}


# --- Directory management & CRUD ---

class _MkdirPayload(_BaseModel):
    path: str

@app.post("/workspace/mkdir")
async def workspace_mkdir(payload: _MkdirPayload) -> dict:
    """Create a directory (and parents) inside sandbox_workspace/."""
    target = _safe_workspace_path(payload.path)
    try:
        target.mkdir(parents=True, exist_ok=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error creating directory: {exc}")

    # Objective 1.2: Broadcast fs_update on directory creation
    await manager.broadcast({
        "type": "fs_update",
        "action": "mkdir",
        "path": payload.path,
    })
    return {"path": payload.path, "status": "created"}


class _RenamePayload(_BaseModel):
    old_path: str
    new_path: str

@app.put("/workspace/rename")
async def workspace_rename(payload: _RenamePayload) -> dict:
    """Rename/move a file or directory inside sandbox_workspace/."""
    source = _safe_workspace_path(payload.old_path)
    dest = _safe_workspace_path(payload.new_path)
    if not source.exists():
        raise HTTPException(status_code=404, detail=f"Source not found: {payload.old_path}")
    if dest.exists():
        raise HTTPException(status_code=409, detail=f"Destination already exists: {payload.new_path}")
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        source.rename(dest)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error renaming: {exc}")

    # Objective 1.2: Broadcast fs_update on rename
    await manager.broadcast({
        "type": "fs_update",
        "action": "rename",
        "old_path": payload.old_path,
        "new_path": payload.new_path,
    })
    return {"old_path": payload.old_path, "new_path": payload.new_path, "status": "renamed"}


class _DeletePayload(_BaseModel):
    path: Optional[str] = None


async def _execute_delete(path_str: str) -> dict:
    target = _safe_workspace_path(path_str)
    if not target.exists():
        raise HTTPException(status_code=404, detail=f"Not found: {path_str}")
    try:
        if target.is_dir():
            shutil.rmtree(target)
        else:
            target.unlink()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Error deleting: {exc}")

    # Objective 1.2: Broadcast fs_update on delete
    await manager.broadcast({
        "type": "fs_update",
        "action": "delete",
        "path": path_str,
    })
    return {"path": path_str, "status": "deleted"}


@app.delete("/workspace/file")
async def workspace_delete_file(
    path: Optional[str] = Query(None, description="Relative path inside sandbox_workspace to delete"),
    payload: Optional[_DeletePayload] = None,
) -> dict:
    """Delete a file or directory inside sandbox_workspace/ (Objective 1.1)."""
    target_path = path or (payload.path if payload else None)
    if not target_path:
        raise HTTPException(status_code=400, detail="Must provide 'path' as query param or in JSON payload.")
    return await _execute_delete(target_path)


@app.delete("/workspace/delete")
async def workspace_delete(
    payload: Optional[_DeletePayload] = None,
    path: Optional[str] = Query(None),
) -> dict:
    """Backward-compatible endpoint to delete a file or directory."""
    target_path = (payload.path if payload else None) or path
    if not target_path:
        raise HTTPException(status_code=400, detail="Must provide 'path' as query param or in JSON payload.")
    return await _execute_delete(target_path)



# ---------------------------------------------------------------------------
# WebSocket Endpoints
# ---------------------------------------------------------------------------

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


@app.websocket("/ws/terminal")
async def terminal_websocket(websocket: WebSocket) -> None:
    """PTY terminal WebSocket: spawns a real shell and pipes stdin/stdout."""
    await websocket.accept()
    logger.info("Terminal WebSocket client connected.")

    # Spawn PTY + shell
    master_fd, slave_fd = pty.openpty()

    # Set initial terminal size (80x24)
    winsize = struct.pack("HHHH", 24, 80, 0, 0)
    fcntl.ioctl(slave_fd, termios.TIOCSWINSZ, winsize)

    workspace_path = str(WORKSPACE_DIR.resolve())
    WORKSPACE_DIR.mkdir(parents=True, exist_ok=True)

    proc = subprocess.Popen(
        ["/bin/zsh", "-i", "-l"],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        cwd=workspace_path,
        env={
            **os.environ,
            "TERM": "xterm-256color",
            "HOME": os.environ.get("HOME", "/tmp"),
        },
        preexec_fn=os.setsid,
    )
    os.close(slave_fd)

    # Keep master_fd in BLOCKING mode so os.read() in the executor thread
    # blocks naturally until data arrives, avoiding CPU-spinning loops.
    loop = asyncio.get_event_loop()

    async def read_pty():
        """Read output from PTY master fd and send to WebSocket."""
        try:
            while proc.poll() is None:
                try:
                    # Blocks in thread until the shell produces output
                    data = await loop.run_in_executor(
                        None, lambda: os.read(master_fd, 4096)
                    )
                    if not data:
                        break
                    await websocket.send_bytes(data)
                except OSError:
                    break
                except Exception:
                    break
        except Exception as exc:
            logger.debug("PTY reader ended: %s", exc)

    reader_task = asyncio.create_task(read_pty())

    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break

            # Handle text messages (including resize commands)
            if "text" in msg:
                text = msg["text"]
                # Check for resize command: "\x1b[8;ROWS;COLSt"
                if text.startswith('{"type":"resize"'):
                    import json as _json
                    try:
                        resize = _json.loads(text)
                        rows = resize.get("rows", 24)
                        cols = resize.get("cols", 80)
                        winsize = struct.pack("HHHH", rows, cols, 0, 0)
                        fcntl.ioctl(master_fd, termios.TIOCSWINSZ, winsize)
                    except Exception:
                        pass
                else:
                    os.write(master_fd, text.encode("utf-8"))

            # Handle binary messages (raw stdin)
            elif "bytes" in msg:
                os.write(master_fd, msg["bytes"])

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.debug("Terminal WebSocket exception: %s", exc)
    finally:
        reader_task.cancel()
        try:
            proc.terminate()
            proc.wait(timeout=2)
        except Exception:
            proc.kill()
        try:
            os.close(master_fd)
        except OSError:
            pass
        logger.info("Terminal WebSocket client disconnected, shell cleaned up.")
