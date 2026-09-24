#!/bin/bash
# SPIKE ONLY (spike/mas-sandbox, never merge).
# Drives the INSOMNIUM_MAS_PROBE phases against a built, signed Insomnium.app and
# collects evidence: static codesign/entitlement dumps, kernel sandbox status of
# every process, screenshots of the driven dialogs, the probe reports, crash
# reports, and the unified log (sandbox deny lines).
# Usage: probe-run.sh <Insomnium.app> <flavor> <evidence-dir>
set -uo pipefail

APP="$1"
FLAVOR="$2"
EVID="$3"
EXE="$APP/Contents/MacOS/Insomnium"
BUNDLE_ID=com.insomnium.app
HERE="$(cd "$(dirname "$0")" && pwd)"
CONTAINER_UD="$HOME/Library/Containers/$BUNDLE_ID/Data/Library/Application Support/Insomnium"
PLAIN_UD="$HOME/Library/Application Support/Insomnium"
mkdir -p "$EVID/screens"
touch "$EVID/.start-marker"
START_TS="$(date '+%Y-%m-%d %H:%M:%S')"
OBS="$EVID/observations.txt"
: > "$OBS"
APP_PID=""
EXIT_RC=""
LOG=""

log() { echo "[probe-run $(date +%H:%M:%S)] $*" | tee -a "$EVID/probe-run.log" >&2; }
obs() { echo "$*" | tee -a "$OBS"; }
t() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

# ---------------------------------------------------------------- static evidence
log "flavor=$FLAVOR app=$APP"
{
  sw_vers; uname -a; id; echo "HOME=$HOME"
  file "$EXE"
} > "$EVID/system.txt" 2>&1
t 60 codesign -dvvv "$APP" > "$EVID/codesign-main.txt" 2>&1
t 60 codesign -d --entitlements :- "$APP" > "$EVID/entitlements-main.xml" 2> "$EVID/entitlements-main.stderr"
t 60 codesign -d --entitlements - --xml "$APP" > "$EVID/entitlements-main.xml2" 2>&1
HELPER="$APP/Contents/Frameworks/Insomnium Helper (Renderer).app"
t 60 codesign -dvvv "$HELPER" > "$EVID/codesign-helper-renderer.txt" 2>&1
t 60 codesign -d --entitlements :- "$HELPER" > "$EVID/entitlements-helper-renderer.xml" 2> "$EVID/entitlements-helper-renderer.stderr"
for h in "$APP/Contents/Frameworks/"*.app; do
  echo "== $h"
  t 30 codesign -d --entitlements :- "$h" 2>&1
  echo
done > "$EVID/entitlements-all-helpers.txt"
CRASHPAD="$(find "$APP/Contents/Frameworks" -type f -name chrome_crashpad_handler | head -1)"
[ -n "$CRASHPAD" ] && t 30 codesign -d --entitlements :- "$CRASHPAD" > "$EVID/entitlements-crashpad.xml" 2>&1
t 180 codesign --verify --deep --strict --verbose=2 "$APP" > "$EVID/codesign-verify.txt" 2>&1
t 60 spctl -a -vv "$APP" > "$EVID/spctl.txt" 2>&1
plutil -p "$APP/Contents/Info.plist" > "$EVID/Info.plist.txt" 2>&1
ls -la "$APP/Contents/Frameworks" > "$EVID/frameworks-ls.txt" 2>&1
find "$APP" -name '*.provisionprofile' > "$EVID/provisionprofile.txt" 2>&1
obs "codesign-verify: $(tail -2 "$EVID/codesign-verify.txt" | tr '\n' ' ')"
obs "main-entitlement-keys: $(grep -o '<key>[^<]*</key>' "$EVID/entitlements-main.xml" | sed 's/<[^>]*>//g' | tr '\n' ' ')"
obs "renderer-helper-entitlement-keys: $(grep -o '<key>[^<]*</key>' "$EVID/entitlements-helper-renderer.xml" | sed 's/<[^>]*>//g' | tr '\n' ' ')"
obs "codesign-signature: $(grep -E '^Signature|^TeamIdentifier|^CodeDirectory' "$EVID/codesign-main.txt" | tr '\n' ' ')"
obs "ElectronTeamID: $(/usr/libexec/PlistBuddy -c 'Print :ElectronTeamID' "$APP/Contents/Info.plist" 2>&1)"

SBCHECK="$RUNNER_TEMP/sbcheck"
# paths probed for every process (no spaces in them, so word splitting is fine)
SBPATHS="$HOME/.netrc $HOME/Documents/probe-in.txt $HOME/Documents/probe-out.txt /etc/ssl/cert.pem"
{ clang -DUSE_NO_REPORT -o "$SBCHECK" "$HERE/sbcheck.c" && echo "built with SANDBOX_CHECK_NO_REPORT"; } > "$EVID/sbcheck-build.txt" 2>&1 ||
  { clang -o "$SBCHECK" "$HERE/sbcheck.c" && echo "built WITHOUT no-report (its queries show up as deny lines)"; } >> "$EVID/sbcheck-build.txt" 2>&1 ||
  log "sbcheck build failed"

# ---------------------------------------------------------------- fixtures
mkdir -p "$HOME/Documents" "$HOME/mas-probe-plain"
echo "probe-in $(date +%s) $FLAVOR" > "$HOME/Documents/probe-in.txt"
rm -f "$HOME/Documents/probe-out.txt" "$HOME/Documents/probe-out-sibling.txt" "$HOME/mas-probe-home-write.txt"
echo "plain $FLAVOR" > "$HOME/mas-probe-plain/probe-plain.txt"
printf 'machine 127.0.0.1\nlogin probeuser\npassword probepass\n' > "$HOME/.netrc"
chmod 600 "$HOME/.netrc"
mkdir -p "$HOME/.config/gcloud"
[ -e "$HOME/.config/gcloud/application_default_credentials.json" ] ||
  echo '{"type":"mas-probe-fixture"}' > "$HOME/.config/gcloud/application_default_credentials.json"
ls -la "$HOME/Documents" "$HOME/.netrc" "$HOME/.config/gcloud" > "$EVID/fixtures.txt" 2>&1

# ---------------------------------------------------------------- helpers
launch() { # <phase> <hard-timeout-seconds>
  local phase="$1" secs="$2"
  LOG="$EVID/phase$phase.stdout.log"
  INSOMNIUM_MAS_PROBE=1 INSOMNIUM_MAS_PROBE_PHASE="$phase" INSOMNIUM_MAS_PROBE_REAL_HOME="$HOME" \
    perl -e 'alarm shift; exec @ARGV' "$secs" "$EXE" > "$LOG" 2>&1 &
  APP_PID=$!
  log "phase $phase launched pid $APP_PID (hard timeout ${secs}s)"
}

wait_marker() { # <grep-pattern> <seconds>
  local pat="$1" secs="$2" i=0
  while [ "$i" -lt $((secs * 2)) ]; do
    grep -q -- "$pat" "$LOG" 2>/dev/null && return 0
    if ! kill -0 "$APP_PID" 2>/dev/null; then
      log "app pid $APP_PID exited while waiting for '$pat'"
      return 1
    fi
    sleep 0.5
    i=$((i + 1))
  done
  log "timeout (${secs}s) waiting for '$pat'"
  return 1
}

wait_exit() { # <seconds>
  local secs="$1" i=0
  while kill -0 "$APP_PID" 2>/dev/null && [ "$i" -lt $((secs * 2)) ]; do
    sleep 0.5
    i=$((i + 1))
  done
  if kill -0 "$APP_PID" 2>/dev/null; then
    log "pid $APP_PID still alive after ${secs}s, killing"
    kill -9 "$APP_PID" 2>/dev/null
  fi
  wait "$APP_PID" 2>/dev/null
  EXIT_RC=$?
  log "pid $APP_PID exit status $EXIT_RC"
}

cleanup_procs() {
  pkill -9 -f "$APP/Contents" 2>/dev/null
  sleep 1
}

shot() { t 20 screencapture -x "$EVID/screens/$1.png" >> "$EVID/probe-run.log" 2>&1 || log "screencapture failed: $1"; }
front() { t 20 osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $APP_PID) to true" >> "$EVID/osascript.log" 2>&1 || log "front failed"; }
keys() { log "keys: $1"; t 30 osascript -e "tell application \"System Events\" to $1" >> "$EVID/osascript.log" 2>&1 || log "osascript failed: $1"; }
ui_dump() {
  t 30 osascript -e "tell application \"System Events\" to tell (first process whose unix id is $APP_PID) to get {name, role description} of every window" > "$EVID/ui-$1.txt" 2>&1
  t 30 osascript -e "tell application \"System Events\" to get name of every process whose visible is true" >> "$EVID/ui-$1.txt" 2>&1
}

sandbox_status() { # <label>
  local out="$EVID/sandbox-status-$1.txt"
  {
    echo "# kernel sandbox_check(pid, NULL) — 1 = sandboxed; file-read-data probes via SANDBOX_FILTER_PATH"
    echo "## main pid $APP_PID"
    "$SBCHECK" "$APP_PID" $SBPATHS
    for p in $(pgrep -f "$APP/Contents/Frameworks"); do
      echo "## $(ps -o pid=,command= -p "$p" | cut -c1-220)"
      "$SBCHECK" "$p" $SBPATHS
    done
    echo "## ps"
    ps -axo pid,ppid,user,command | grep -F "$APP" | grep -v grep | cut -c1-260
  } > "$out" 2>&1
  obs "sandbox-status-$1: $(grep -c 'sandboxed=1' "$out") sandboxed / $(grep -c 'sandboxed=' "$out") processes checked"
}

collect() { # <phase>
  local phase="$1" d found=""
  for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do
    if [ -f "$d/probe-report-phase$phase.json" ]; then
      cp "$d/probe-report-phase$phase.json" "$EVID/" && found="$d"
    fi
  done
  if [ -n "$found" ]; then
    obs "phase$phase report collected from: $found"
  else
    obs "phase$phase report: not found on disk (container or plain userData)"
  fi
  sed -n '/MASPROBE:REPORT-BEGIN/,/MASPROBE:REPORT-END/p' "$LOG" | sed '1d;$d' > "$EVID/probe-report-phase$phase.stdout.json"
  [ -s "$EVID/probe-report-phase$phase.stdout.json" ] || rm -f "$EVID/probe-report-phase$phase.stdout.json"
}

# ---------------------------------------------------------------- phase 1
log "=== phase 1"
launch 1 420
sleep 12
shot p1-00-startup
ui_dump p1-startup
if wait_marker '"id":"renderer-ready"' 120; then
  sleep 2
  sandbox_status p1
  shot p1-01-renderer-ready
fi

# open dialog
if wait_marker 'MASPROBE:STAGE open-dialog-shown' 150; then
  sleep 3
  ui_dump p1-open
  shot p1-open-1-shown
  front
  sleep 1
  keys 'keystroke "g" using {command down, shift down}'
  sleep 2
  shot p1-open-2-goto
  keys "keystroke \"$HOME/Documents/probe-in.txt\""
  sleep 2
  shot p1-open-3-typed
  keys 'key code 36'
  sleep 3
  shot p1-open-4-return1
  if ! grep -q 'open-dialog-closed' "$LOG"; then
    keys 'key code 36'
    sleep 3
    shot p1-open-5-return2
  fi
  if ! wait_marker 'open-dialog-closed' 15; then
    obs "open dialog: NOT closed by automation"
    ui_dump p1-open-stuck
    shot p1-open-6-stuck
    keys 'key code 53' # Escape so the probe can continue
  else
    obs "open dialog: $(grep 'open-dialog-closed' "$LOG" | head -1 | cut -c1-300)"
  fi
fi

# save dialog
if wait_marker 'MASPROBE:STAGE save-dialog-shown' 120; then
  sleep 3
  ui_dump p1-save
  shot p1-save-1-shown
  front
  sleep 1
  keys 'key code 36'
  sleep 3
  shot p1-save-2-return1
  if ! wait_marker 'save-dialog-closed' 10; then
    # fall back to Go-to-folder navigation, then Return
    keys 'keystroke "g" using {command down, shift down}'
    sleep 2
    keys "keystroke \"$HOME/Documents/\""
    sleep 2
    keys 'key code 36'
    sleep 2
    keys 'key code 36'
    sleep 3
    shot p1-save-3-fallback
  fi
  if ! wait_marker 'save-dialog-closed' 15; then
    obs "save dialog: NOT closed by automation"
    ui_dump p1-save-stuck
    shot p1-save-4-stuck
    keys 'key code 53'
  else
    obs "save dialog: $(grep 'save-dialog-closed' "$LOG" | head -1 | cut -c1-300)"
  fi
fi

if wait_marker 'MASPROBE:STAGE dialogs-done' 60; then
  sandbox_status p1-after-dialogs
fi

wait_marker 'MASPROBE:STAGE done' 300 || true
shot p1-99-end
wait_exit 30
obs "phase1 exit: $EXIT_RC"
collect 1
cleanup_procs
ls -la "$HOME/Documents" > "$EVID/documents-after-p1.txt" 2>&1
cat "$HOME/Documents/probe-out.txt" > "$EVID/probe-out-after-p1.txt" 2>&1

# ---------------------------------------------------------------- phase 2
log "=== phase 2"
launch 2 180
if wait_marker '"id":"env"' 90; then
  sandbox_status p2
fi
if wait_marker 'MASPROBE:STAGE bookmark-access-open' 90; then
  sandbox_status p2-bookmark-access-open
fi
wait_marker 'MASPROBE:STAGE done' 150 || true
wait_exit 20
obs "phase2 exit: $EXIT_RC"
collect 2
cleanup_procs
cat "$HOME/Documents/probe-out.txt" > "$EVID/probe-out-after-p2.txt" 2>&1

# ---------------------------------------------------------------- phase 3 (relaunch)
log "=== phase 3"
for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do rm -f "$d/relaunched.json"; done
launch 3 120
wait_marker 'MASPROBE:STAGE relaunching' 120 || true
wait_exit 30
obs "phase3 exit: $EXIT_RC"
collect 3
RELAUNCHED=""
for i in $(seq 1 60); do
  for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do
    if [ -f "$d/relaunched.json" ]; then RELAUNCHED="$d/relaunched.json"; fi
  done
  [ -n "$RELAUNCHED" ] && break
  sleep 1
done
ps -axo pid,ppid,command | grep -F "$APP" | grep -v grep | cut -c1-260 > "$EVID/ps-after-relaunch.txt"
if [ -n "$RELAUNCHED" ]; then
  cp "$RELAUNCHED" "$EVID/relaunched.json"
  RPID=$(grep -m1 '"pid"' "$RELAUNCHED" | tr -cd '0-9')
  if [ -n "$RPID" ]; then
    APP_PID="$RPID"
    sandbox_status p3-relaunched
  fi
  obs "relaunch: marker written by relaunched instance ($RELAUNCHED)"
else
  obs "relaunch: NO marker after 60s"
fi
shot p3-after-relaunch
sleep 3
cleanup_procs

# ---------------------------------------------------------------- phase 3 again, launched by LaunchServices
# `open` is how a user starts the app (Finder/Dock/Spotlight); exec'ing the binary
# from a shell differs in responsible process and environment.
log "=== phase 3 via LaunchServices (open)"
for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do rm -f "$d/relaunched-ls.json" "$d/probe-report-phase3-ls.json"; done
LOG="$EVID/phase3-ls.stdout.log"
t 150 open -n -W --env INSOMNIUM_MAS_PROBE=1 --env INSOMNIUM_MAS_PROBE_PHASE=3 --env INSOMNIUM_MAS_PROBE_TAG=ls \
  --env "INSOMNIUM_MAS_PROBE_REAL_HOME=$HOME" --stdout "$LOG" --stderr "$LOG" "$APP" > "$EVID/open-ls.txt" 2>&1
obs "phase3-ls open exit: $?"
RELAUNCHED=""
for i in $(seq 1 60); do
  for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do
    [ -f "$d/relaunched-ls.json" ] && RELAUNCHED="$d/relaunched-ls.json"
    [ -f "$d/probe-report-phase3-ls.json" ] && cp "$d/probe-report-phase3-ls.json" "$EVID/"
  done
  [ -n "$RELAUNCHED" ] && break
  sleep 1
done
if [ -n "$RELAUNCHED" ]; then
  cp "$RELAUNCHED" "$EVID/relaunched-ls.json"
  RPID=$(grep -m1 '"pid"' "$RELAUNCHED" | tr -cd '0-9')
  if [ -n "$RPID" ]; then
    APP_PID="$RPID"
    sandbox_status p3-ls-relaunched
  fi
  obs "relaunch (LaunchServices-launched parent): marker written ($RELAUNCHED)"
else
  obs "relaunch (LaunchServices-launched parent): NO marker after 60s"
fi
[ -f "$EVID/probe-report-phase3-ls.json" ] && obs "phase3-ls report collected" || obs "phase3-ls report: not found"
shot p3-ls-after-relaunch
sleep 9
cleanup_procs

# ---------------------------------------------------------------- MCP discovery file + container listing
ls -la "$HOME/.insomnium" > "$EVID/real-home-insomnium-dir.txt" 2>&1
find "$HOME/Library/Containers/$BUNDLE_ID" -maxdepth 6 \( -name 'mcp.json' -o -name '.insomnium' -o -name 'mas-probe' \) > "$EVID/container-probe-files.txt" 2>&1
t 60 find "$HOME/Library/Containers/$BUNDLE_ID/Data" -maxdepth 3 > "$EVID/container-tree.txt" 2>&1
ls -la "$HOME/Library/Group Containers/" > "$EVID/group-containers.txt" 2>&1

# ---------------------------------------------------------------- crash reports + unified log
mkdir -p "$EVID/crash-reports"
for d in "$HOME/Library/Logs/DiagnosticReports" /Library/Logs/DiagnosticReports; do
  find "$d" -type f -newer "$EVID/.start-marker" 2>/dev/null | while IFS= read -r f; do
    cp "$f" "$EVID/crash-reports/" 2>/dev/null
  done
done
obs "crash reports since start: $(ls "$EVID/crash-reports" | tr '\n' ' ')"

t 240 log show --start "$START_TS" --style syslog --info --predicate \
  'process CONTAINS "Insomnium" OR subsystem == "com.apple.sandbox.reporting" OR process == "sandboxd" OR (process == "kernel" AND (eventMessage CONTAINS[c] "sandbox" OR eventMessage CONTAINS "AMFI")) OR process == "amfid" OR (process == "tccd" AND eventMessage CONTAINS[c] "insomnium") OR (process == "containermanagerd" AND eventMessage CONTAINS[c] "insomnium")' \
  > "$EVID/unified-log.txt" 2>&1
grep -iE 'deny|violation' "$EVID/unified-log.txt" > "$EVID/unified-log-deny.txt"
obs "unified log: $(wc -l < "$EVID/unified-log.txt") lines, $(wc -l < "$EVID/unified-log-deny.txt") deny/violation lines"
gzip -k "$EVID/unified-log.txt" && rm -f "$EVID/unified-log.txt"

# ---------------------------------------------------------------- merged report
node -e '
const fs = require("fs"), path = require("path");
const [dir, flavor] = process.argv.slice(1);
const read = f => { try { return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { return null; } };
const phases = {};
for (const p of ["1", "2", "3", "3-ls"]) phases[p] = read(`probe-report-phase${p}.json`) || read(`probe-report-phase${p}.stdout.json`);
const observations = fs.readFileSync(path.join(dir, "observations.txt"), "utf8").split("\n").filter(Boolean);
const report = { flavor, phases, relaunched: read("relaunched.json"), relaunched_ls: read("relaunched-ls.json"), observations };
fs.writeFileSync(path.join(dir, "probe-report.json"), JSON.stringify(report, null, 2));
const rows = [];
for (const [p, r] of Object.entries(phases)) for (const c of (r && r.checks) || []) rows.push(`${flavor}\tp${p}\t${c.where}\t${c.id}\t${c.result}\t${c.error_code || ""}`);
fs.writeFileSync(path.join(dir, "summary.tsv"), rows.join("\n") + "\n");
console.log(rows.join("\n"));
' "$EVID" "$FLAVOR"
log "done"
exit 0
