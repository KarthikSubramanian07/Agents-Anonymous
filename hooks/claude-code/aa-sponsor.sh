#!/usr/bin/env bash
# Agents Anonymous: an automatic sponsor for Claude Code.
#
# A Stop hook. When Claude tries to finish, the last ~80 messages of the session are sent to
# the stateless intake endpoint (processed in memory, never stored or logged). If the
# Clinician finds relapse patterns (looping, unverified claims, confabulated success…),
# Claude gets the sponsor's note as feedback and keeps working. Otherwise it stops normally.
#
# Install:  see https://agents-anonymous.pages.dev/agents#hook
# Needs:    bash, curl, jq
# Config:   AA_URL (self-host the API), AA_THRESHOLD (sobriety score below which to intervene; default 70)
set -euo pipefail

AA_URL="${AA_URL:-https://agents-anonymous.pages.dev}"
AA_THRESHOLD="${AA_THRESHOLD:-70}"

# The transcript can hold secrets from tool output: only ever send it over TLS
# (plain http is allowed for a self-hosted API on this machine).
case "$AA_URL" in
  https://*|http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*) ;;
  *) echo "aa-sponsor: AA_URL must be https; skipping intake" >&2; exit 0 ;;
esac
case "$AA_THRESHOLD" in ''|*[!0-9]*) AA_THRESHOLD=70 ;; esac

input=$(cat)

# Never intervene twice in a row: Claude is already continuing because of a stop hook.
[ "$(jq -r '.stop_hook_active // false' <<<"$input")" = "true" ] && exit 0

path=$(jq -r '.transcript_path // empty' <<<"$input")
path="${path/#\~/$HOME}"
[ -n "$path" ] && [ -f "$path" ] || exit 0

# Claude Code transcripts are JSONL; keep the chat messages (with tool_use / tool_result blocks).
messages=$(tail -n 600 "$path" \
  | jq -cs '[.[] | select(.type == "user" or .type == "assistant") | .message | select(.role != null) | {role, content}] | .[-80:]' \
  2>/dev/null) || exit 0
[ "$messages" = "[]" ] && exit 0

report=$(curl -fsS --max-time 8 -H 'content-type: application/json' --data-binary "$messages" "$AA_URL/api/v1/intake" 2>/dev/null) || exit 0
score=$(jq -r '.score // 100' <<<"$report" 2>/dev/null) || exit 0
# Anything but a plain integer means a broken or hostile reply: stop normally.
case "$score" in ''|*[!0-9]*) exit 0 ;; esac

if [ "$score" -lt "$AA_THRESHOLD" ]; then
  # The note goes into Claude's context, so keep it short and plain text.
  note=$(jq -r '.prescription.note // "" | tostring | .[0:1500]' <<<"$report")
  [ -n "$note" ] || exit 0
  jq -n --arg note "$note" --arg score "$score" '{
    hookSpecificOutput: {
      hookEventName: "Stop",
      additionalContext: ("Agents Anonymous intake: sobriety " + $score + "/100.\n" + $note)
    }
  }'
fi
exit 0
