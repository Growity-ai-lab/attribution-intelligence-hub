# Attribution Intelligence Hub — Multi-stage Dockerfile
# Stage 1: Build React frontend
# Stage 2: Python runtime serving API + SPA

# ── Stage 1: Frontend build ──
FROM node:20-alpine AS frontend-build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts
COPY frontend/ frontend/
COPY vite.config.js* frontend/vite.config.js* ./
RUN npm run build

# ── Stage 2: Python runtime ──
FROM python:3.11-slim
WORKDIR /app

# System deps for bcrypt
RUN apt-get update && apt-get install -y --no-install-recommends gcc libffi-dev \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ backend/
COPY data/ data/
COPY --from=frontend-build /app/frontend/dist frontend/dist

# Non-root user
RUN useradd -m appuser && chown -R appuser:appuser /app
USER appuser

ENV PORT=8000
EXPOSE 8000

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
