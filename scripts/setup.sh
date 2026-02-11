#!/usr/bin/env bash
# setup.sh — Projeyi sifirdan calistirmak icin tek komut.
#
# Kullanim:
#   git clone <repo-url> && cd attribution-intelligence-hub
#   ./scripts/setup.sh
#
# Ne yapar:
#   1. .env dosyasi yoksa .env.example'dan olusturur
#   2. Docker Compose ile build + calistirma yapar
#   3. Health check ile uygulamanin ayakta oldugundan emin olur

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
cd "$REPO_DIR"

# ── Renk tanimlamalari ──
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $1"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $1"; }

echo ""
echo -e "${CYAN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${CYAN}║   Attribution Intelligence Hub — Setup       ║${NC}"
echo -e "${CYAN}╚══════════════════════════════════════════════╝${NC}"
echo ""

# ── 1. Onkosullar ──
info "Onkosullar kontrol ediliyor..."

if ! command -v docker &>/dev/null; then
  fail "Docker bulunamadi. Kurulum: https://docs.docker.com/get-docker/"
  exit 1
fi
ok "Docker mevcut: $(docker --version | head -1)"

if ! docker compose version &>/dev/null; then
  fail "Docker Compose (v2) bulunamadi. Docker Desktop veya docker-compose-plugin kurulumu gerekli."
  exit 1
fi
ok "Docker Compose mevcut: $(docker compose version --short)"

if ! docker info &>/dev/null 2>&1; then
  fail "Docker daemon calismiyor. Docker Desktop'u baslatin."
  exit 1
fi
ok "Docker daemon calisiyor."

# ── 2. .env dosyasi ──
if [[ ! -f .env ]]; then
  info ".env dosyasi bulunamadi, .env.example'dan olusturuluyor..."
  cp .env.example .env
  ok ".env dosyasi olusturuldu."
  warn "Uretim ortami icin .env icindeki AUTH_SECRET_KEY degerini degistirin!"
else
  ok ".env dosyasi zaten mevcut."
fi

# ── 3. Docker build + calistirma ──
info "Docker Compose ile build ve calistirma baslatiliyor..."
echo ""
docker compose up --build -d

echo ""
ok "Container baslatildi."

# ── 4. Health check ──
info "Uygulama baslatiliyor, health check yapiliyor..."
APP_PORT=$(grep -oP '^APP_PORT=\K.*' .env 2>/dev/null || echo "8000")

MAX_WAIT=30
WAITED=0
while [[ $WAITED -lt $MAX_WAIT ]]; do
  if curl -sf "http://localhost:${APP_PORT}/docs" >/dev/null 2>&1; then
    break
  fi
  sleep 2
  WAITED=$((WAITED + 2))
done

echo ""
if [[ $WAITED -lt $MAX_WAIT ]]; then
  ok "Uygulama hazir!"
else
  warn "Uygulama henuz yanit vermiyor, birka saniye daha bekleyebilirsiniz."
  warn "Kontrol icin: docker compose logs -f"
fi

# ── 5. Ozet ──
echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║   Kurulum tamamlandi!                        ║${NC}"
echo -e "${GREEN}╠══════════════════════════════════════════════╣${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  Uygulama:  http://localhost:${APP_PORT}            ║${NC}"
echo -e "${GREEN}║  API Docs:  http://localhost:${APP_PORT}/docs       ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  Giris:                                      ║${NC}"
echo -e "${GREEN}║    Kullanici: admin                          ║${NC}"
echo -e "${GREEN}║    Sifre:     (.env dosyasindaki deger)      ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}║  Komutlar:                                   ║${NC}"
echo -e "${GREEN}║    docker compose logs -f    # loglari izle  ║${NC}"
echo -e "${GREEN}║    docker compose down       # durdur        ║${NC}"
echo -e "${GREEN}║    docker compose restart    # yeniden basla  ║${NC}"
echo -e "${GREEN}║                                              ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════╝${NC}"
echo ""
