#!/usr/bin/env bash
# auto-update.sh — Remote branch'i izleyip degisiklik oldugunda
# otomatik git pull + docker compose rebuild yapar.
#
# Kullanim:
#   ./scripts/auto-update.sh                  # varsayilan: 30sn aralikla kontrol
#   ./scripts/auto-update.sh --interval 60    # 60sn aralikla kontrol
#   ./scripts/auto-update.sh --once           # tek sefer kontrol et, degisiklik varsa guncelle
#
# Durdurmak icin: Ctrl+C veya 'kill $(cat .auto-update.pid)'

set -euo pipefail

BRANCH="claude/setup-attribution-hub-S0whu"
INTERVAL=30
ONCE=false
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$REPO_DIR/.auto-update.pid"
LOG_FILE="$REPO_DIR/.auto-update.log"

# --- Arg parse ---
while [[ $# -gt 0 ]]; do
  case "$1" in
    --interval) INTERVAL="$2"; shift 2 ;;
    --once)     ONCE=true; shift ;;
    --branch)   BRANCH="$2"; shift 2 ;;
    --help|-h)
      echo "Kullanim: $0 [--interval SANIYE] [--once] [--branch BRANCH]"
      exit 0
      ;;
    *) echo "Bilinmeyen parametre: $1"; exit 1 ;;
  esac
done

cd "$REPO_DIR"

log() {
  local msg="[$(date '+%Y-%m-%d %H:%M:%S')] $1"
  echo "$msg"
  echo "$msg" >> "$LOG_FILE"
}

cleanup() {
  rm -f "$PID_FILE"
  log "Auto-update durduruldu."
  exit 0
}
trap cleanup SIGINT SIGTERM

# Tek instance kontrolu
if [[ -f "$PID_FILE" ]]; then
  OLD_PID=$(cat "$PID_FILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Auto-update zaten calisiyor (PID: $OLD_PID). Durdurmak icin: kill $OLD_PID"
    exit 1
  fi
  rm -f "$PID_FILE"
fi

echo $$ > "$PID_FILE"

check_and_update() {
  # Remote'daki son commit'i al
  if ! git fetch origin "$BRANCH" 2>/dev/null; then
    log "UYARI: git fetch basarisiz, bir sonraki dongude tekrar denenecek."
    return 1
  fi

  LOCAL_HEAD=$(git rev-parse HEAD)
  REMOTE_HEAD=$(git rev-parse "origin/$BRANCH")

  if [[ "$LOCAL_HEAD" == "$REMOTE_HEAD" ]]; then
    return 1  # degisiklik yok
  fi

  log "Degisiklik tespit edildi!"
  log "  Lokal:  ${LOCAL_HEAD:0:8}"
  log "  Remote: ${REMOTE_HEAD:0:8}"

  # Yeni commit'leri goster
  log "Yeni commit'ler:"
  git log --oneline "$LOCAL_HEAD..$REMOTE_HEAD" 2>/dev/null | while read -r line; do
    log "  $line"
  done

  # Pull
  if ! git pull origin "$BRANCH"; then
    log "HATA: git pull basarisiz!"
    return 1
  fi
  log "git pull basarili."

  # Docker rebuild
  log "Docker rebuild baslatiliyor..."
  if docker compose up --build -d 2>&1 | while read -r line; do log "  docker: $line"; done; then
    log "Docker rebuild tamamlandi."
  else
    log "HATA: Docker rebuild basarisiz!"
    return 1
  fi

  return 0
}

log "Auto-update baslatildi."
log "  Branch:   $BRANCH"
log "  Interval: ${INTERVAL}s"
log "  Repo:     $REPO_DIR"
log "  PID:      $$"
log "  Log:      $LOG_FILE"
echo ""
log "Durdurmak icin: Ctrl+C veya 'kill \$(cat $PID_FILE)'"
echo ""

if [[ "$ONCE" == true ]]; then
  if check_and_update; then
    log "Guncelleme tamamlandi."
  else
    log "Degisiklik yok veya hata olustu."
  fi
  rm -f "$PID_FILE"
  exit 0
fi

# Ana dongu
while true; do
  if check_and_update; then
    log "Guncelleme tamamlandi. Izlemeye devam ediliyor..."
  fi
  sleep "$INTERVAL"
done
