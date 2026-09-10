# Multi-Agent Software Sandbox

A lightweight, reactive development sandbox for autonomous AI agent collaboration on Apple Silicon (Metal API).

## Overview

The Multi-Agent Software Sandbox is built to execute reactive agent workflows (Supervisor, Designer, Coder, Reviewer) around a shared SQLite Blackboard state store and an asynchronous event bus.

The system is optimized for Apple Silicon (16GB unified memory) using shared memory prefix caching, running concurrent agent workflows on a sub-3B model instance (Qwen 2.5 Coder 1.5B Q4_K_M GGUF) via `llama-server`.

## Architecture

- **Event Bus & Web Server**: Python FastAPI with `asyncio.Queue` for internal non-blocking event distribution.
- **Blackboard State**: SQLite with `aiosqlite`.
  - `event_log`: Append-only chronological timeline of agent states and actions.
  - `event_log_fts`: SQLite FTS5 virtual table for millisecond full-text search across action histories and timeline reconstruction.
- **Real-Time Streaming**: Native WebSockets (`/ws/events`) streaming blackboard updates to the user interface.
- **Inference Server**: `llama-server` compiled with `GGML_METAL=1` (`--parallel 4`, `--ctx-size 8192`, `--cache-prompt true`).

## Quick Start

### 1. Requirements
- macOS (Apple Silicon recommended)
- Python 3.9+
- SQLite 3 with FTS5 support (included with macOS Python)

### 2. Setup & Run
Run the bare-metal launcher:
```bash
chmod +x run.sh
./run.sh
```

This script will:
1. Initialize the Python virtual environment (`.venv`).
2. Install dependencies (`fastapi`, `uvicorn`, `aiosqlite`, `pydantic`, etc.).
3. Initialize the SQLite database blackboard and FTS5 search index (`sandbox.db`).
4. Launch the FastAPI server at `http://localhost:8000`.

### 3. API Endpoints
- `POST /task`: Submit an initial task prompt to the event log (`status="pending_supervisor"`).
- `GET /search?q={query}`: Query the FTS5 full-text search index across event action histories.
- `GET /events`: Retrieve recent events from the blackboard.
- `WS /ws/events`: Real-time WebSocket connection streaming all blackboard transitions.
- `GET /`: Lightweight single-page UI for monitoring live agent events and searching the timeline.

## Running Tests
```bash
.venv/bin/pytest tests/test_sandbox.py -v
```
