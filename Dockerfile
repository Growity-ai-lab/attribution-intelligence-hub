# Time's Hub | Attribution Intelligence — Multi-stage Dockerfile
# Stage 1: Build React frontend with Vite
# Stage 2: Python runtime serving API + SPA

# ── Stage 1: Frontend build ──
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY frontend/ frontend/
RUN npm run build

# ── Stage 2: Python runtime ──
FROM python:3.11-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends gcc libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && \
    pip install --no-cache-dir --timeout 60 --retries 10 -r requirements.txt

COPY backend/ backend/
COPY data/ data/
COPY --from=frontend-build /app/frontend/dist frontend/dist

RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Render.com sets PORT env var; default to 8000 for local Docker
CMD ["sh", "-c", "python -m uvicorn backend.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
