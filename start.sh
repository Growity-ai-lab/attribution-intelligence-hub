#!/usr/bin/env bash
# Attribution Intelligence Hub — Full-Stack Startup
# Usage: ./start.sh [--build] [--port 8000]

set -e

PORT="${PORT:-8000}"
BUILD=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --build) BUILD=true; shift ;;
    --port) PORT="$2"; shift 2 ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

cd "$(dirname "$0")"

# Install Python deps if needed
if ! python3 -c "import fastapi" 2>/dev/null; then
  echo "Installing Python dependencies..."
  pip3 install -r requirements.txt
fi

# Build frontend if --build flag or dist doesn't exist
if [ "$BUILD" = true ] || [ ! -f "frontend/dist/index.html" ]; then
  echo "Building frontend..."
  if [ ! -d "node_modules" ]; then
    npm install
  fi
  npm run build
fi

echo ""
echo "  Attribution Intelligence Hub"
echo "  http://localhost:${PORT}"
echo ""

python3 -m uvicorn backend.main:app --host 0.0.0.0 --port "$PORT"
