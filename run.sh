#!/usr/bin/env bash
set -euo pipefail

# Multi-Agent Software Sandbox - Bare Metal Launcher
# Target: Apple Silicon (M1/M2/M3), 16GB Unified Memory

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

DEV_MODE=false
for arg in "$@"; do
    if [ "$arg" = "--dev" ] || [ "$arg" = "-d" ]; then
        DEV_MODE=true
    fi
done

echo "========================================================"
echo "    Multi-Agent Software Sandbox (Apple Silicon)        "
echo "========================================================"
if [ "$DEV_MODE" = true ]; then
    echo " Mode: Modern Development (FastAPI + Vite HMR Dev Server)"
else
    echo " Mode: Production / Standalone (FastAPI + Built React IDE)"
fi
echo "========================================================"

# Track child PIDs for graceful cleanup
CHILD_PIDS=()
cleanup() {
    echo ""
    echo "[!] Shutting down Spark processes..."
    for pid in "${CHILD_PIDS[@]}"; do
        if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
        fi
    done
    wait 2>/dev/null || true
    echo "[✓] All processes stopped."
}
trap cleanup EXIT INT TERM

# 1. Virtual Environment Setup
if [ ! -d ".venv" ]; then
    echo "[+] Creating Python virtual environment (.venv)..."
    python3 -m venv .venv
fi

# Ensure pip is up to date and dependencies are installed
echo "[+] Ensuring backend dependencies are installed..."
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
    CHILD_PIDS+=("$LLAMA_PID")
    echo "[+] llama-server running in background (PID: $LLAMA_PID)"
else
    echo "[i] llama-server or model file not found in default path; skipping LLM backend startup."
    echo "    (The event bus, blackboard DB, WebSocket, and API are operational in standalone mode)."
fi

# 3. Initialize SQLite Blackboard Database
echo "[+] Initializing SQLite Blackboard..."
.venv/bin/python3 -c "import asyncio; from database import init_db; asyncio.run(init_db())"

# 4. Frontend & Static Assets Setup
if command -v npm &> /dev/null; then
    # Modern React + Vite Frontend
    if [ -d "frontend" ] && [ -f "frontend/package.json" ]; then
        if [ ! -d "frontend/node_modules" ]; then
            echo "[+] Installing modern frontend dependencies..."
            (cd frontend && npm install --silent)
        fi
        if [ "$DEV_MODE" = false ]; then
            echo "[+] Building modern React + Vite frontend..."
            npm --prefix frontend run build
        fi
    fi

    # Compile legacy static assets
    if [ -f "package.json" ]; then
        echo "[+] Compiling legacy CSS assets..."
        npm run build:css
    fi
fi

# 5. Launch Application
if [ "$DEV_MODE" = true ]; then
    echo "[+] Starting FastAPI backend on http://127.0.0.1:8000 ..."
    .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload \
        --reload-exclude "sandbox_workspace/*" \
        --reload-exclude "*.db" \
        --reload-exclude "*.db-*" \
        --reload-exclude "frontend/*" \
        --reload-exclude ".spark_context.md" &
    UVICORN_PID=$!
    CHILD_PIDS+=("$UVICORN_PID")

    echo "[+] Starting Vite frontend development server on http://localhost:5173 ..."
    npm --prefix frontend run dev &
    VITE_PID=$!
    CHILD_PIDS+=("$VITE_PID")

    echo "========================================================"
    echo " Spark Development Environment is Live:"
    echo "   Frontend IDE:  http://localhost:5173"
    echo "   Backend API:   http://localhost:8000"
    echo "   WebSocket:     ws://localhost:8000/ws/events"
    echo " Press Ctrl+C to terminate all services."
    echo "========================================================"

    # Wait for child processes
    wait
else
    echo "[+] Starting FastAPI server at http://127.0.0.1:8000 ..."
    echo "    Serving modern Spark IDE on http://localhost:8000 (legacy console on /legacy)"
    exec .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload \
        --reload-exclude "sandbox_workspace/*" \
        --reload-exclude "*.db" \
        --reload-exclude "*.db-*" \
        --reload-exclude "frontend/*" \
        --reload-exclude ".spark_context.md"
fi
