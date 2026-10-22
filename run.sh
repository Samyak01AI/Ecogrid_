#!/usr/bin/env bash
# ==============================================================================
# EcoGrid AI 2.0 — Local Runner Script (Bash)
# ==============================================================================
set -e

# Colors for terminal output
GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

MODE="${1:-all}"

echo -e "${CYAN}====================================================${NC}"
echo -e "${CYAN}           🌿 EcoGrid AI 2.0 Runner               ${NC}"
echo -e "${CYAN}====================================================${NC}"

# 1. Activate Python virtual environment for backend
activate_venv() {
  if [ -f "$ROOT_DIR/backend/.venv/Scripts/activate" ]; then
    echo -e "${GREEN}[1/3] Activating Windows/Git-Bash Python virtualenv...${NC}"
    source "$ROOT_DIR/backend/.venv/Scripts/activate"
  elif [ -f "$ROOT_DIR/backend/.venv/bin/activate" ]; then
    echo -e "${GREEN}[1/3] Activating Linux/macOS Python virtualenv...${NC}"
    source "$ROOT_DIR/backend/.venv/bin/activate"
  elif [ -f "$ROOT_DIR/.venv/Scripts/activate" ]; then
    source "$ROOT_DIR/.venv/Scripts/activate"
  elif [ -f "$ROOT_DIR/.venv/bin/activate" ]; then
    source "$ROOT_DIR/.venv/bin/activate"
  else
    echo -e "${YELLOW}Warning: Virtual environment not found. Setting up in backend/.venv...${NC}"
    python3 -m venv "$ROOT_DIR/backend/.venv" || python -m venv "$ROOT_DIR/backend/.venv"
    if [ -f "$ROOT_DIR/backend/.venv/Scripts/activate" ]; then
      source "$ROOT_DIR/backend/.venv/Scripts/activate"
    else
      source "$ROOT_DIR/backend/.venv/bin/activate"
    fi
    pip install -r "$ROOT_DIR/backend/requirements.txt"
  fi
}

# 2. Build shared packages
build_packages() {
  echo -e "${GREEN}[2/3] Building TypeScript domain & contract packages...${NC}"
  pnpm run build:packages
}

# 3. Running modes
start_backend() {
  activate_venv
  echo -e "${GREEN}Starting FastAPI backend on http://127.0.0.1:3001 (Swagger: /docs)...${NC}"
  python -m uvicorn app.main:app --app-dir "$ROOT_DIR/backend" --host 0.0.0.0 --port 3001 --reload
}

start_web() {
  echo -e "${GREEN}Starting Vite frontend on http://localhost:3000...${NC}"
  pnpm --filter @ecogrid/web dev
}

run_tests() {
  activate_venv
  echo -e "${GREEN}Running backend test suite...${NC}"
  python -m pytest "$ROOT_DIR/backend/tests" -v
}

case "$MODE" in
  backend)
    start_backend
    ;;
  web)
    build_packages
    start_web
    ;;
  test)
    run_tests
    ;;
  all)
    activate_venv
    build_packages

    echo -e "\n${CYAN}====================================================${NC}"
    echo -e "${GREEN}Backend API : http://localhost:3001 (Docs: /docs)${NC}"
    echo -e "${GREEN}Web Client  : http://localhost:3000${NC}"
    echo -e "${YELLOW}Press Ctrl+C at any time to stop all services.${NC}"
    echo -e "${CYAN}====================================================${NC}\n"

    # Trap to shut down all child background processes cleanly on exit
    trap 'echo -e "\n${YELLOW}Stopping EcoGrid AI services...${NC}"; kill 0' SIGINT SIGTERM EXIT

    python -m uvicorn app.main:app --app-dir "$ROOT_DIR/backend" --host 0.0.0.0 --port 3001 --reload &
    BACKEND_PID=$!

    pnpm --filter @ecogrid/web dev &
    WEB_PID=$!

    wait $BACKEND_PID $WEB_PID
    ;;
  *)
    echo -e "${RED}Usage: $0 [all|backend|web|test]${NC}"
    exit 1
    ;;
esac
