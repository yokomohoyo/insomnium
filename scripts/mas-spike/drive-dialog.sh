#!/bin/bash
# SPIKE ONLY (spike/mas-sandbox, never merge).
# Drives one NSOpenPanel/NSSavePanel shown by the probe, with System Events keystrokes.
# Started by host-agent.js when the probe announces a dialog; the probe reports the close
# back to the agent, which touches $EVID/.dialog-closed-<key>.
#   drive-dialog.sh <key> <id> <drive> <app-pid> <path> <evidence-dir>
# drive: goto            Cmd-Shift-G, type <path>, Return (twice if needed). A path ending
#                        in / navigates into that folder, so Return then chooses the folder.
#        default         Return (save panel with the default name).
#        goto-selectall  goto <folder>/, Cmd-A, Return (multi-select open panel).
set -u
KEY="$1"; ID="$2"; DRIVE="$3"; PID="$4"; P="$5"; EVID="$6"
S="$EVID/screens"
mkdir -p "$S"
FLAG="$EVID/.dialog-closed-$KEY"

t() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }
log() { echo "[drive $(date +%H:%M:%S) $KEY $ID] $*"; }
closed() { [ -f "$FLAG" ]; }
shot() { t 20 screencapture -x "$S/dlg-$KEY-$ID-$1.png" >/dev/null 2>&1 || log "screencapture failed: $1"; }
front() { t 20 osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $PID) to true" >> "$EVID/osascript.log" 2>&1 || log "front failed"; }
keys() { log "keys: $1"; t 30 osascript -e "tell application \"System Events\" to $1" >> "$EVID/osascript.log" 2>&1 || log "osascript failed: $1"; }
ui_dump() {
  t 30 osascript -e "tell application \"System Events\" to tell (first process whose unix id is $PID) to get {name, role description} of every window" > "$EVID/ui-dlg-$KEY-$1.txt" 2>&1
}
wait_closed() { local i=0; while [ "$i" -lt $(($1 * 2)) ]; do closed && return 0; sleep 0.5; i=$((i + 1)); done; return 1; }
goto() { # <path> <shot-label>
  keys 'keystroke "g" using {command down, shift down}'
  sleep 2
  keys "keystroke \"$1\""
  sleep 2
  shot "$2-typed"
  keys 'key code 36'
  sleep 3
}

log "start drive=$DRIVE path=$P pid=$PID"
sleep 3
closed && { log "already closed"; exit 0; }
ui_dump shown
shot 1-shown
front
sleep 1
case "$DRIVE" in
  goto)
    goto "$P" 2
    shot 3-after-goto
    closed || { keys 'key code 36'; sleep 3; shot 4-return2; }
    ;;
  default)
    keys 'key code 36'
    sleep 3
    shot 2-return
    ;;
  goto-selectall)
    goto "$P" 2
    keys 'keystroke "a" using {command down}'
    sleep 1
    shot 3-selectall
    keys 'key code 36'
    sleep 3
    shot 4-return
    ;;
esac
if ! wait_closed 10; then
  log "not closed after the primary drive; fallback: go-to + Return"
  ui_dump fallback
  front
  sleep 1
  if [ "$DRIVE" = default ]; then goto "$(dirname "$P")/" 5; else goto "$P" 5; fi
  closed || { keys 'key code 36'; sleep 3; }
  shot 6-fallback
fi
if ! wait_closed 12; then
  log "STUCK: Escape"
  ui_dump stuck
  shot 9-stuck
  keys 'key code 53'
  sleep 2
  closed || keys 'key code 53'
fi
log "end closed=$(closed && echo yes || echo no)"
