#!/bin/sh
# Naya's office shows Claude Code at a desk while someone uses it on this host. The hermes
# container must not read the transcripts (its agents run tools), so this keeps an activity-only
# copy for it: one tiny file per session changed in the last day, holding just the working
# folder's name, with the session's modification time. Project folders are hashed, so full paths
# do not leave the host either. Run it every minute (cron or a systemd timer), as the user whose
# Claude Code sessions should count:
#
#   * * * * * /opt/team-assistant/claude-activity-sync.sh /root/.claude/projects /var/lib/claude-activity
#
# Then set CLAUDE_ACTIVITY_DIR=/var/lib/claude-activity in .env; the hermes container mounts it
# read-only.
set -eu
umask 022

src="${1:-$HOME/.claude/projects}"
dst="${2:-/var/lib/claude-activity}"
out_dir="$dst/projects"
mkdir -p "$out_dir"
[ -d "$src" ] || exit 0

find "$src" -mindepth 2 -maxdepth 2 -type f -name '*.jsonl' -mmin -1440 | while IFS= read -r file; do
  key=$(basename "$(dirname "$file")" | sha256sum | cut -c1-12)
  out="$out_dir/$key/$(basename "$file")"
  # Same time as the session: nothing new since the last run.
  if [ -e "$out" ] && [ ! "$file" -nt "$out" ] && [ ! "$out" -nt "$file" ]; then continue; fi
  # The last working folder in the session, by name only, limited to safe characters.
  name=$(tail -c 65536 "$file" | grep -o '"cwd":"[^"]*"' | tail -n 1 | sed 's/^"cwd":"//; s/"$//; s#.*/##' | tr -cd 'A-Za-z0-9._-' | cut -c1-80) || true
  mkdir -p "$out_dir/$key"
  printf '{"cwd":"/%s"}\n' "$name" > "$out.tmp"
  touch -r "$file" "$out.tmp"
  mv "$out.tmp" "$out"
done

# Sessions untouched for a day drop out; the projects folder itself stays.
find "$out_dir" -mindepth 2 -type f -name '*.jsonl' -mmin +1440 -delete
find "$out_dir" -mindepth 1 -type d -empty -delete
