#!/usr/bin/env bash
# Pasang profil tim Hermes ke container `hermes` yang sudah berjalan.
# Aman dijalankan ulang (idempotent): file lama dibackup, config di-set via CLI.
set -euo pipefail

CONTAINER="${HERMES_CONTAINER:-hermes}"
MODEL="${HERMES_MODEL:-gemini-3.5-flash-lite}"
PROVIDER="${HERMES_PROVIDER:-gemini}"
PLATFORM="${HERMES_PLATFORM:-}"
GEMINI_KEY="${GEMINI_API_KEY:-${GOOGLE_API_KEY:-${AI_API_KEY:-}}}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if ! [[ "$MODEL" =~ ^[A-Za-z0-9._:-]+$ ]]; then
  echo "HERMES_MODEL mengandung karakter tidak valid: $MODEL" >&2
  exit 1
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose tidak ditemukan." >&2
  exit 1
fi

if ! "${COMPOSE[@]}" ps -q "$CONTAINER" | grep -q .; then
  echo "Service '$CONTAINER' tidak sedang berjalan. Nyalakan dulu dengan: ${COMPOSE[*]} up -d $CONTAINER" >&2
  exit 1
fi

hx() { "${COMPOSE[@]}" exec -T "$CONTAINER" "$@"; }
hsh() { "${COMPOSE[@]}" exec -T "$CONTAINER" sh -c "$1" sh "${@:2}"; }

declare -A DESC=(
  [default]="Asisten umum dan orkestrator utama. Memahami permintaan, memecah pekerjaan, mendelegasikan ke CEO/PM, memantau Kanban, lalu merangkum hasil."
  [ceo]="Orkestrator strategi dan koordinasi tim. Menentukan prioritas bisnis, mengambil keputusan tingkat tinggi, menyelaraskan PM dan Asisten Umum, dan mengeskalasi risiko."
  [pm]="Product Manager dan pekerja Kanban. Mengubah ide menjadi spesifikasi, user story, acceptance criteria, dan rencana tugas untuk desain serta implementasi."
)
PROFILES=(default ceo pm)
ORCHESTRATORS=(default ceo)
WORKERS=(pm)

backup_if_exists() {
  hsh '[ -f "$1" ] && cp -a "$1" "$1.bak.$(date +%s)" || true' "$1"
}

profile_home() {
  if [ "$1" = "default" ]; then printf '/opt/data'; else printf '/opt/data/profiles/%s' "$1"; fi
}

set_cfg() {
  local profile="$1" key="$2" value="$3"
  if [ "$profile" = "default" ]; then
    hx hermes config set "$key" "$value"
  else
    hx hermes -p "$profile" config set "$key" "$value"
  fi
}

echo "==> 1/6 Buat profile yang belum ada"
for p in ceo pm; do
  if ! hx hermes profile show "$p" >/dev/null 2>&1; then
    hx hermes profile create "$p" --description "${DESC[$p]}"
  fi
done

echo "==> 2/6 Pasang SOUL.md dan profile.yaml"
for p in "${PROFILES[@]}"; do
  dest="$(profile_home "$p")"
  hsh 'mkdir -p "$1"' "$dest"
  backup_if_exists "$dest/SOUL.md"
  backup_if_exists "$dest/profile.yaml"
  "${COMPOSE[@]}" cp "$ROOT/hermes/profiles/$p/SOUL.md" "$CONTAINER:$dest/SOUL.md"
  "${COMPOSE[@]}" cp "$ROOT/hermes/profiles/$p/profile.yaml" "$CONTAINER:$dest/profile.yaml"
done

echo "==> 3/6 Set display name dan deskripsi"
# ID `default` tidak bisa diganti; rename hanya mengubah display_name.
# profile.yaml yang disalin juga sudah mengandung display_name; jadi ini hanya pelengkap UI.
hx hermes profile rename default "Asisten Umum" >/dev/null 2>&1 || true
for p in "${PROFILES[@]}"; do
  hx hermes profile describe "$p" --text "${DESC[$p]}" >/dev/null
done

echo "==> 4/6 Set model free-tier, delegasi, dan Kanban ($PROVIDER/$MODEL)"
for p in "${PROFILES[@]}"; do
  set_cfg "$p" model.provider "$PROVIDER"
  set_cfg "$p" model.default "$MODEL"
  set_cfg "$p" delegation.enabled true
  set_cfg "$p" delegation.max_spawn_depth 1
  set_cfg "$p" kanban.review_dispatch false
done
for p in "${ORCHESTRATORS[@]}"; do
  set_cfg "$p" delegation.orchestrator_enabled true
done
for p in "${WORKERS[@]}"; do
  set_cfg "$p" delegation.orchestrator_enabled false
done
# Dispatcher Kanban berjalan di gateway; pengaturan global dibaca dari profile default.
set_cfg default kanban.dispatch_in_gateway true
set_cfg default kanban.auto_decompose true
set_cfg default kanban.orchestrator_profile default
set_cfg default kanban.default_assignee default

echo "==> 5/6 Aktifkan toolset kanban untuk orkestrator"
hx hermes tools enable kanban >/dev/null
hx hermes -p ceo tools enable kanban >/dev/null
if [ -n "$PLATFORM" ]; then
  hx hermes tools enable kanban --platform "$PLATFORM" >/dev/null
  hx hermes -p ceo tools enable kanban --platform "$PLATFORM" >/dev/null
fi

echo "==> 6/6 Pastikan kunci Gemini tersedia di setiap profile"
if [ -z "$GEMINI_KEY" ]; then
  tmpdir="$(mktemp -d)"
  trap 'rm -rf "$tmpdir"' EXIT
  for p in "${PROFILES[@]}"; do
    "${COMPOSE[@]}" cp "$CONTAINER:$(profile_home "$p")/.env" "$tmpdir/$p.env" >/dev/null 2>&1 || true
  done
  for f in "$tmpdir"/*.env; do
    [ -f "$f" ] || continue
    line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?(GEMINI_API_KEY|GOOGLE_API_KEY|AI_API_KEY)=' "$f" | head -n 1 || true)"
    [ -n "$line" ] || continue
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    GEMINI_KEY="$value"
    break
  done
fi
if [ -z "$GEMINI_KEY" ] && [ -f "$ROOT/.env" ]; then
  line="$(grep -E '^[[:space:]]*(export[[:space:]]+)?(GEMINI_API_KEY|GOOGLE_API_KEY|AI_API_KEY)=' "$ROOT/.env" | head -n 1 || true)"
  if [ -n "$line" ]; then
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    value="${value%\'}"; value="${value#\'}"
    GEMINI_KEY="$value"
  fi
fi
if [ -z "$GEMINI_KEY" ] && [ -t 0 ]; then
  read -rsp "Masukkan GEMINI_API_KEY: " GEMINI_KEY
  echo
fi
if [ -z "$GEMINI_KEY" ]; then
  echo "GEMINI_API_KEY belum tersedia. Set env GEMINI_API_KEY lalu jalankan ulang skrip ini." >&2
  exit 1
fi
for p in "${PROFILES[@]}"; do
  printf 'GEMINI_API_KEY=%s\n' "$GEMINI_KEY" | hsh '
    f="$1"
    mkdir -p "$(dirname "$f")"
    if [ -f "$f" ]; then
      grep -viE "^[[:space:]]*(export[[:space:]]+)?GEMINI_API_KEY=" "$f" > "$f.tmp" || true
      mv "$f.tmp" "$f"
      if [ -n "$(tail -c 1 "$f")" ]; then printf "\n" >> "$f"; fi
    fi
    cat >> "$f"
  ' "$(profile_home "$p")/.env"
done

echo
echo "Selesai. Ringkasan profile:"
hx hermes profile list
echo
echo "Model aktif (default):"
hx hermes config get model --json || true
echo
echo "Restart gateway agar sesi baru memakai toolset/config terbaru:"
echo "  ${COMPOSE[*]} restart $CONTAINER"
echo "Jika memakai platform gateway (Telegram/Discord/dsb), ulangi dengan:"
echo "  HERMES_PLATFORM=<nama_platform> $0"
