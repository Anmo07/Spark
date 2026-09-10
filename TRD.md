# Technical Requirements Document (TRD)

Multi-Agent Software Sandbox

1. Infrastructure & Deployment

⚬ Hardware Target: Apple Silicon (M1/M2/M3), 16GB Unified Memory, limited SSD.
⚬ Deployment Pattern: Bare-metal shell script (run.sh). Docker is explicitly banned to maintain direct access to the Metal API.
⚬ Inference Engine: llama-server compiled with GGML_METAL=1.
  ⚬ Flags required: --ctx-size 8192 (RAM limit), --parallel 4 (concurrency), --cache-prompt true (KV Cache reuse).
⚬ Model: Qwen 2.5 Coder 1.5B in Q4_K_M GGUF format.

2. Application Architecture (The Event Bus)

⚬ Framework: FastAPI (Python).
⚬ Concurrency: asyncio for non-blocking local tool execution and HTTP requests to the llama-server.
⚬ State Management (Blackboard):
  ⚬ Database: SQLite3.
  ⚬ Table 1: event_log (id, timestamp, agent_role, status_trigger, action_data, raw_json).
  ⚬ Table 2: event_log_fts (Virtual Table utilizing SQLite FTS5 extension for ultra-fast full-text search across action histories).

3. Agent Implementation & Contracts

⚬ Agent Creation: Agents are not distinct models; they are distinct System Prompts routed to the shared llama-server.
⚬ Roles: Supervisor, Designer, Coder, Reviewer.
⚬ Validation: All prompts must append a system directive enforcing JSON outputs.
⚬ Pydantic Schemas: Every agent response is cast through a Pydantic model (e.g., class CoderResponse(BaseModel): file_path: str, code: str). If validation fails, tenacity or a custom wait_for block handles the retry.

4. API Endpoints (FastAPI)

⚬ POST /task: Ingests initial user prompt, writes to event_log.
⚬ WS /ws/events: WebSocket streaming new database rows to the frontend UI in real-time.
⚬ GET /search?q={query}: Queries the FTS5 table, returns timeline context for the UI replay visualizer.
