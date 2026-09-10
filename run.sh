#!/usr/bin/env bash
set -euo pipefail

# Multi-Agent Software Sandbox - Bare Metal Launcher
# Target: Apple Silicon (M1/M2/M3), 16GB Unified Memory

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "========================================================"
echo "    Multi-Agent Software Sandbox (Apple Silicon)        "
echo "========================================================"

# 1. Virtual Environment Setup
if [ ! -d ".venv" ]; then
    echo "[+] Creating Python virtual environment (.venv)..."
    python3 -m venv .venv
fi

# Ensure pip is up to date and dependencies are installed
echo "[+] Ensuring dependencies are installed..."
.venv/bin/pip install -q -r requirements.txt

# 2. Check for llama-server (optional if user has GGUF ready)
LLAMA_SERVER_BIN="${LLAMA_SERVER_BIN:-llama-server}"
MODEL_PATH="${MODEL_PATH:-./models/qwen2.5-coder-1.5b-instruct-q4_k_m.gguf}"

if command -v "$LLAMA_SERVER_BIN" &> /dev/null && [ -f "$MODEL_PATH" ]; then
    echo "[+] Starting local llama-server (Metal enabled)..."
    "$LLAMA_SERVER_BIN" \
        -m "$MODEL_PATH" \
        --ctx-size 8192 \
        --parallel 4 \
        --cache-prompt true \
        --port 8080 &
    LLAMA_PID=$!
    echo "[+] llama-server running in background (PID: $LLAMA_PID)"
    trap "kill $LLAMA_PID 2>/dev/null || true" EXIT
else
    echo "[i] llama-server or model file not found in default path; skipping LLM backend startup."
    echo "    (The event bus, blackboard DB, WebSocket, and API are operational in standalone mode)."
fi

# 3. Initialize SQLite Blackboard Database
echo "[+] Initializing SQLite Blackboard..."
.venv/bin/python3 -c "import asyncio; from database import init_db; asyncio.run(init_db())"

# 4. Compile Tailwind CSS via PostCSS
if command -v npm &> /dev/null && [ -f "package.json" ]; then
    echo "[+] Compiling Tailwind CSS via PostCSS..."
    npm run build:css
fi

# 5. Launch FastAPI Event Bus Server
echo "[+] Starting FastAPI server at http://127.0.0.1:8000 ..."
exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload
