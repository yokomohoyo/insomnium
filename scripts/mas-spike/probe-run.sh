#!/bin/bash
# SPIKE ONLY (spike/mas-sandbox, never merge).
# Round 2: drives the INSOMNIUM_MAS_PROBE phases against a built, signed Insomnium.app and
# collects evidence: static codesign/entitlement dumps, host-side sandbox_check() of every
# app process (requested by the probe through host-agent.js), screenshots of the driven
# dialogs, the probe reports, crash reports (with positive controls) and the unified log.
# Usage: probe-run.sh <Insomnium.app> <flavor> <evidence-dir> <parent-ent.plist> <inherit-ent.plist> [os-label]
set -uo pipefail

APP="$1"
FLAVOR="$2"
EVID="$3"
ENT="$4"
ENT_INHERIT="$5"
OSLABEL="${6:-unknown}"
EXE="$APP/Contents/MacOS/Insomnium"
BUNDLE_ID=com.insomnium.app
HERE="$(cd "$(dirname "$0")" && pwd)"
CONTAINER="$HOME/Library/Containers/$BUNDLE_ID"
CONTAINER_UD="$CONTAINER/Data/Library/Application Support/Insomnium"
PLAIN_UD="$HOME/Library/Application Support/Insomnium"
if [ "$FLAVOR" = mas ]; then UD="$CONTAINER_UD"; else UD="$PLAIN_UD"; fi
LSREGISTER=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
TOOLS="${RUNNER_TEMP:-/tmp}/mas-probe-tools"
SBCHECK="$TOOLS/sbcheck"
LSHANDLER="$TOOLS/lshandler"
CERTGEN="$TOOLS/certgen"
mkdir -p "$EVID/screens" "$TOOLS" "$CERTGEN"
touch "$EVID/.start-marker"
START_TS="$(date '+%Y-%m-%d %H:%M:%S')"
OBS="$EVID/observations.txt"
: > "$OBS"
APP_PID=""
EXIT_RC=""
LOG=""
AGENT_PID=""

log() { echo "[probe-run $(date +%H:%M:%S)] $*" | tee -a "$EVID/probe-run.log" >&2; }
obs() { echo "$*" | tee -a "$OBS"; }
t() { local s="$1"; shift; perl -e 'alarm shift; exec @ARGV' "$s" "$@"; }

# ---------------------------------------------------------------- static evidence
log "flavor=$FLAVOR os=$OSLABEL app=$APP"
{
  sw_vers; uname -a; id; echo "HOME=$HOME"
  sysctl -n machdep.cpu.brand_string 2>/dev/null
  file "$EXE"
} > "$EVID/system.txt" 2>&1
obs "sw_vers: $(sw_vers | tr '\n' ' ' | tr -s ' \t' ' ')"
t 60 codesign -dvvv "$APP" > "$EVID/codesign-main.txt" 2>&1
t 60 codesign -d --entitlements :- "$APP" > "$EVID/entitlements-main.xml" 2> "$EVID/entitlements-main.stderr"
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
obs "codesign-signature: $(grep -E '^Signature|^TeamIdentifier|^CodeDirectory|^CDHash=' "$EVID/codesign-main.txt" | tr '\n' ' ')"
obs "ElectronTeamID: $(/usr/libexec/PlistBuddy -c 'Print :ElectronTeamID' "$APP/Contents/Info.plist" 2>&1)"
obs "CFBundleVersion: $(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist" 2>&1)"

# ---------------------------------------------------------------- tools
{ clang -DUSE_NO_REPORT -o "$SBCHECK" "$HERE/sbcheck.c" && echo "sbcheck built with SANDBOX_CHECK_NO_REPORT"; } > "$EVID/tools-build.txt" 2>&1 ||
  { clang -o "$SBCHECK" "$HERE/sbcheck.c" && echo "sbcheck built WITHOUT no-report (its queries show up as deny lines)"; } >> "$EVID/tools-build.txt" 2>&1 ||
  log "sbcheck build failed"
{ clang -fobjc-arc -framework AppKit -framework CoreServices -framework Foundation -o "$LSHANDLER" "$HERE/lshandler.m" && echo "lshandler built"; } >> "$EVID/tools-build.txt" 2>&1 ||
  log "lshandler build failed"

# ---------------------------------------------------------------- fixtures
D="$HOME/Documents"
mkdir -p "$D" "$HOME/mas-probe-plain"
echo "probe-in $(date +%s) $FLAVOR" > "$D/probe-in.txt"
echo "ls-in $(date +%s) $FLAVOR" > "$D/ls-in.txt"
rm -f "$D/probe-out.txt" "$D/probe-out-sibling.txt" "$D/ls-out.txt" "$D/ls-out-sibling.txt" "$HOME/mas-probe-home-write.txt"
echo "plain $FLAVOR" > "$HOME/mas-probe-plain/probe-plain.txt"
printf 'machine 127.0.0.1\nlogin probeuser\npassword probepass\n' > "$HOME/.netrc"
chmod 600 "$HOME/.netrc"
mkdir -p "$HOME/.config/gcloud"
[ -e "$HOME/.config/gcloud/application_default_credentials.json" ] ||
  echo '{"type":"mas-probe-fixture"}' > "$HOME/.config/gcloud/application_default_credentials.json"
# probe 1: a directory tree to grant with openDirectory
rm -rf "$D/probe-dir"
mkdir -p "$D/probe-dir/sub1/sub2"
echo "top" > "$D/probe-dir/top.txt"
echo "nested" > "$D/probe-dir/sub1/nested.txt"
echo "deep" > "$D/probe-dir/sub1/sub2/deep.txt"
# probe 2: a.proto imports its sibling b.proto
rm -rf "$D/protos"
mkdir -p "$D/protos"
cat > "$D/protos/a.proto" <<'EOF'
syntax = "proto3";
package probe;
import "b.proto";
service ProbeService { rpc Ping (PingRequest) returns (PingReply); }
message PingRequest { B b = 1; }
message PingReply { string msg = 1; }
EOF
cat > "$D/protos/b.proto" <<'EOF'
syntax = "proto3";
package probe;
message B { string v = 1; }
EOF
# control: an import that does not exist at all
cat > "$D/protos/c.proto" <<'EOF'
syntax = "proto3";
package probe;
import "missing.proto";
message C { Missing m = 1; }
EOF
# probe 6: local CA, server cert (SAN 127.0.0.1), client cert/key in ~/Documents/certs
OPENSSL=openssl
[ -x /opt/homebrew/opt/openssl@3/bin/openssl ] && OPENSSL=/opt/homebrew/opt/openssl@3/bin/openssl
rm -rf "$D/certs"
mkdir -p "$D/certs"
(
  set -e
  cd "$CERTGEN"
  printf 'basicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\n' > ca.ext
  printf 'subjectAltName=IP:127.0.0.1,DNS:localhost\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n' > server.ext
  printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' > client.ext
  "$OPENSSL" req -new -newkey rsa:2048 -nodes -keyout ca.key -out ca.csr -subj "/CN=MAS Probe CA"
  "$OPENSSL" x509 -req -in ca.csr -signkey ca.key -out "$D/certs/ca.crt" -days 3 -extfile ca.ext
  "$OPENSSL" req -new -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=127.0.0.1"
  "$OPENSSL" x509 -req -in server.csr -CA "$D/certs/ca.crt" -CAkey ca.key -CAcreateserial -out server.crt -days 3 -extfile server.ext
  "$OPENSSL" req -new -newkey rsa:2048 -nodes -keyout "$D/certs/client.key" -out client.csr -subj "/CN=mas-probe-client"
  "$OPENSSL" x509 -req -in client.csr -CA "$D/certs/ca.crt" -CAkey ca.key -CAcreateserial -out "$D/certs/client.crt" -days 3 -extfile client.ext
) > "$EVID/certgen.log" 2>&1 || log "cert generation failed (see certgen.log)"
"$OPENSSL" x509 -in "$D/certs/client.crt" -noout -subject -issuer >> "$EVID/certgen.log" 2>&1
CA_B64="$(base64 < "$D/certs/ca.crt" | tr -d '\n')"
ls -laR "$D" "$HOME/.netrc" "$HOME/.config/gcloud" > "$EVID/fixtures.txt" 2>&1

# ---------------------------------------------------------------- host agent + fixture servers
rm -f "$EVID/.agent-ready"
t 3000 node "$HERE/host-agent.js" "$EVID" "$SBCHECK" "$APP" "$LSHANDLER" "$CERTGEN" > "$EVID/host-agent.stdout.log" 2>&1 &
AGENT_PID=$!
for i in $(seq 1 40); do [ -f "$EVID/.agent-ready" ] && break; sleep 0.5; done
[ -f "$EVID/.agent-ready" ] && obs "host agent up (pid $AGENT_PID)" || obs "host agent NOT ready"
sleep 1
{
  echo "## unix socket /tmp"; t 10 curl -sS --max-time 5 --unix-socket /tmp/insomnium-probe.sock http://x/selftest; echo " rc=$?"
  echo "## unix socket ~/probe.sock"; t 10 curl -sS --max-time 5 --unix-socket "$HOME/probe.sock" http://x/selftest; echo " rc=$?"
  echo "## TLS without client cert (must fail)"; t 10 curl -sS --max-time 5 --cacert "$D/certs/ca.crt" https://127.0.0.1:18443/selftest-nocert; echo " rc=$?"
  echo "## TLS with client cert (must succeed, client_cn=mas-probe-client)"
  t 10 curl -sS --max-time 5 --cacert "$D/certs/ca.crt" --cert "$D/certs/client.crt" --key "$D/certs/client.key" https://127.0.0.1:18443/selftest-cert; echo " rc=$?"
} > "$EVID/fixtures-selftest.txt" 2>&1
obs "fixture self-test: $(grep -c 'rc=0' "$EVID/fixtures-selftest.txt") of 4 curl calls rc=0 (expected 3: the no-cert TLS call must fail)"

# ---------------------------------------------------------------- crash-report baseline positive control
sleep 600 &
SPID=$!
sleep 0.5
kill -SEGV "$SPID" 2>/dev/null
wait "$SPID" 2>/dev/null
echo "baseline-sleep $SPID $(date -u +%FT%TZ)" >> "$EVID/crash-control.txt"

# ---------------------------------------------------------------- LaunchServices registration
t 60 "$LSREGISTER" -f "$APP" > "$EVID/lsregister.txt" 2>&1
t 20 "$LSHANDLER" insomnia > "$EVID/ls-handler-before.txt" 2>&1

# ---------------------------------------------------------------- helpers
# Chromium's single-instance files. A MAS instance killed with SIGKILL can leave
# tmp/S/SingletonCookie behind in the container, after which the next launch fails
# requestSingleInstanceLock() and quits (round-2 run 1). The harness records and clears
# them before every launch, except in the force-quit experiment that measures exactly that.
singleton_state() { # <label>
  {
    echo "## $1 $(date +%H:%M:%S)"
    ls -la "$UD"/Singleton* 2>&1
    ls -la "$CONTAINER/Data/tmp/S" 2>&1
  } >> "$EVID/singleton-files.txt"
}
clear_stale() { # <label>
  local n
  n=$( (ls -d "$UD"/Singleton* "$CONTAINER/Data/tmp/S/"Singleton* 2>/dev/null || true) | wc -l | tr -d ' ')
  if [ "$n" != 0 ]; then
    singleton_state "stale-before-$1"
    obs "stale singleton files before $1: $n (cleared)"
    rm -f "$UD"/Singleton* "$CONTAINER/Data/tmp/S/"Singleton*
  fi
}

launch() { # <phase> <hard-timeout-seconds>   (env PROBE_TAG, NO_CLEAR)
  local phase="$1" secs="$2" tag="${PROBE_TAG:-}"
  [ -n "${NO_CLEAR:-}" ] || clear_stale "phase$phase${tag:+-$tag}"
  LOG="$EVID/phase$phase${tag:+-$tag}.stdout.log"
  LAUNCH_AGENT_LINES=$(wc -l < "$EVID/host-agent.log" 2>/dev/null || echo 0)
  INSOMNIUM_MAS_PROBE=1 INSOMNIUM_MAS_PROBE_PHASE="$phase" INSOMNIUM_MAS_PROBE_TAG="$tag" INSOMNIUM_MAS_PROBE_REAL_HOME="$HOME" \
    INSOMNIUM_MAS_PROBE_CA_B64="$CA_B64" perl -e 'alarm shift; exec @ARGV' "$secs" "$EXE" > "$LOG" 2>&1 &
  APP_PID=$!
  log "phase $phase${tag:+ ($tag)} launched pid $APP_PID (hard timeout ${secs}s)"
}

# Wait for the probe's start stage; if the app stalls before it (a modal alert before
# 'ready'), record the screen and the alert text, then press Return once.
startup_guard() { # <label> [phase-name-in-agent-log]
  local label="$1" ph="${2:-}" i=0 pid
  while [ "$i" -lt 90 ]; do
    grep -q 'MASPROBE:STAGE start' "$LOG" 2>/dev/null && return 0
    [ -n "$ph" ] && tail -n +"$((LAUNCH_AGENT_LINES + 1))" "$EVID/host-agent.log" 2>/dev/null | grep -q "\"phase\":\"$ph\"" && return 0
    sleep 0.5
    i=$((i + 1))
  done
  pid="$(pgrep -f "$APP/Contents/MacOS/Insomnium" | head -1)"
  shot "stall-$label"
  t 30 osascript -e "tell application \"System Events\" to tell (first process whose unix id is ${pid:-0}) to get {name, value of static texts, name of buttons} of every window" > "$EVID/stall-$label.txt" 2>&1
  obs "STARTUP STALL in $label (pid ${pid:-none}): $(tr '\n' ' ' < "$EVID/stall-$label.txt" | cut -c1-400)"
  [ -n "$pid" ] || return 1
  t 20 osascript -e "tell application \"System Events\" to set frontmost of (first process whose unix id is $pid) to true" >> "$EVID/osascript.log" 2>&1
  t 20 osascript -e 'tell application "System Events" to key code 36' >> "$EVID/osascript.log" 2>&1
  return 1
}

lock_obs() { # <label>: did main.development.ts give up on the single-instance lock?
  local n
  n=$(grep -c '› \[app\] Failed to get instance lock' "$LOG" 2>/dev/null)
  [ "${n:-0}" = 0 ] || obs "$1: '[app] Failed to get instance lock' x$n"
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

wait_file() { # <file> <seconds>
  local f="$1" secs="$2" i=0
  while [ "$i" -lt $((secs * 2)) ]; do
    [ -f "$f" ] && return 0
    sleep 0.5
    i=$((i + 1))
  done
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

cleanup_procs() { # graceful first (SIGTERM makes Electron quit normally), then SIGKILL leftovers
  local i=0
  pkill -TERM -f "$APP/Contents/MacOS/Insomnium" 2>/dev/null
  while pgrep -f "$APP/Contents/MacOS/Insomnium" > /dev/null && [ "$i" -lt 16 ]; do sleep 0.5; i=$((i + 1)); done
  if pgrep -f "$APP/Contents" > /dev/null; then
    log "cleanup: SIGKILL leftovers: $(pgrep -f "$APP/Contents" | tr '\n' ' ')"
    pkill -9 -f "$APP/Contents" 2>/dev/null
  fi
  sleep 1
}

shot() { t 20 screencapture -x "$EVID/screens/$1.png" >> "$EVID/probe-run.log" 2>&1 || log "screencapture failed: $1"; }

collect() { # <report-name, e.g. 1, 3-ls, relaunched-ls, url-cold>
  local name="$1" d
  if [ -f "$EVID/agent-reports/probe-report-phase$name.json" ]; then
    cp "$EVID/agent-reports/probe-report-phase$name.json" "$EVID/probe-report-phase$name.json"
    obs "phase$name report: posted to the host agent"
  else
    for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do
      if [ -f "$d/probe-report-phase$name.json" ]; then
        cp "$d/probe-report-phase$name.json" "$EVID/" && obs "phase$name report: copied from $d"
      fi
    done
    [ -f "$EVID/probe-report-phase$name.json" ] || obs "phase$name report: NOT FOUND (agent or userData)"
  fi
  if [ -f "$EVID/phase$name.stdout.log" ]; then
    sed -n '/MASPROBE:REPORT-BEGIN/,/MASPROBE:REPORT-END/p' "$EVID/phase$name.stdout.log" | sed '1d;$d' > "$EVID/probe-report-phase$name.stdout.json"
    [ -s "$EVID/probe-report-phase$name.stdout.json" ] || rm -f "$EVID/probe-report-phase$name.stdout.json"
  fi
}

container_meta() { # <label>
  {
    ls -la "$CONTAINER" 2>&1
    plutil -p "$CONTAINER/.com.apple.containermanagerd.metadata.plist" 2>&1 | head -80
  } > "$EVID/container-metadata-$1.txt"
}

# ---------------------------------------------------------------- phase 1
log "=== phase 1"
launch 1 1000
startup_guard p1 1
shot p1-00-startup
wait_marker 'MASPROBE:STAGE done' 960 || true
shot p1-99-end
wait_exit 30
obs "phase1 exit: $EXIT_RC"
lock_obs phase1
collect 1
cleanup_procs
ls -la "$D" "$D/probe-dir" > "$EVID/documents-after-p1.txt" 2>&1
cat "$D/probe-out.txt" > "$EVID/probe-out-after-p1.txt" 2>&1
container_meta after-p1

# ---------------------------------------------------------------- phase 2
log "=== phase 2"
launch 2 300
startup_guard p2 2
wait_marker 'MASPROBE:STAGE done' 280 || true
wait_exit 20
obs "phase2 exit: $EXIT_RC"
lock_obs phase2
collect 2
cleanup_procs
cat "$D/probe-out.txt" > "$EVID/probe-out-after-p2.txt" 2>&1
ls -la "$D/probe-dir" > "$EVID/probe-dir-after-p2.txt" 2>&1

# ---------------------------------------------------------------- force-quit experiment
# Kill a fully started instance with SIGKILL (like Force Quit or a crash), then start the
# app again twice WITHOUT clearing Chromium's singleton files.
log "=== force-quit experiment"
launch idle 200
startup_guard idle idle
if wait_marker 'MASPROBE:STAGE idle-ready' 120; then
  singleton_state fq-1-running
  kill -9 "$APP_PID" 2>/dev/null
  sleep 5
  pgrep -fl "$APP/Contents" > "$EVID/fq-ps-after-kill.txt" 2>&1
  pkill -9 -f "$APP/Contents" 2>/dev/null
  wait "$APP_PID" 2>/dev/null
  obs "force-quit: SIGKILLed main pid $APP_PID"
  collect idle
  sleep 1
  singleton_state fq-2-after-kill
  for tag in first second; do
    NO_CLEAR=1 PROBE_TAG=$tag launch lockcheck 120
    startup_guard "lockcheck-$tag" "lockcheck-$tag"
    wait_marker 'MASPROBE:STAGE done' 90 || true
    wait_exit 15
    obs "force-quit: relaunch ($tag) exit $EXIT_RC, app log '[app] Failed to get instance lock' x$(grep -c '› \[app\] Failed to get instance lock' "$LOG"), singleton errors x$(grep -c 'process_singleton_posix' "$LOG"), probe reached renderer-ready: $(grep '^MASPROBE:CHECK {"id":"renderer-ready"' "$LOG" | grep -c '"result":"ok"')"
    collect "lockcheck-$tag"
    cleanup_procs
    singleton_state "fq-3-after-lockcheck-$tag"
  done
else
  obs "force-quit: the idle instance never became ready"
  cleanup_procs
fi

# ---------------------------------------------------------------- phase 3 (relaunch)
log "=== phase 3"
for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do rm -f "$d/relaunched.json"; done
launch 3 120
startup_guard p3 3
wait_marker 'MASPROBE:STAGE relaunching' 120 || true
wait_exit 30
obs "phase3 exit: $EXIT_RC"
collect 3
if wait_file "$EVID/agent-reports/probe-report-phaserelaunched.json" 100; then
  obs "relaunch: the relaunched instance reported (agent)"
  sleep 3
else
  obs "relaunch: NO report from the relaunched instance after 100s"
fi
collect relaunched
for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do [ -f "$d/relaunched.json" ] && cp "$d/relaunched.json" "$EVID/relaunched.json"; done
ps -axo pid,ppid,command | grep -F "$APP" | grep -v grep | cut -c1-260 > "$EVID/ps-after-relaunch.txt"
shot p3-after-relaunch
cleanup_procs

# ---------------------------------------------------------------- phase 3 again, launched by LaunchServices
log "=== phase 3 via LaunchServices (open)"
for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do rm -f "$d/relaunched-ls.json" "$d/probe-report-phase3-ls.json"; done
clear_stale phase3-ls
LOG="$EVID/phase3-ls.stdout.log"
LAUNCH_AGENT_LINES=$(wc -l < "$EVID/host-agent.log")
t 150 open -n -W --env INSOMNIUM_MAS_PROBE=1 --env INSOMNIUM_MAS_PROBE_PHASE=3 --env INSOMNIUM_MAS_PROBE_TAG=ls \
  --env "INSOMNIUM_MAS_PROBE_REAL_HOME=$HOME" --stdout "$LOG" --stderr "$LOG" "$APP" > "$EVID/open-3-ls.txt" 2>&1 &
OPEN_PID=$!
startup_guard 3-ls 3-ls
wait "$OPEN_PID"
obs "phase3-ls open exit: $?"
lock_obs phase3-ls
collect 3-ls
if wait_file "$EVID/agent-reports/probe-report-phaserelaunched-ls.json" 100; then
  obs "relaunch (LaunchServices-launched parent): the relaunched instance reported (agent)"
  sleep 3
else
  obs "relaunch (LaunchServices-launched parent): NO report after 100s"
fi
collect relaunched-ls
for d in "$CONTAINER_UD/mas-probe" "$PLAIN_UD/mas-probe"; do [ -f "$d/relaunched-ls.json" ] && cp "$d/relaunched-ls.json" "$EVID/relaunched-ls.json"; done
shot p3-ls-after-relaunch
cleanup_procs

# ---------------------------------------------------------------- phase lsd: LaunchServices-launched dialogs + app group
log "=== phase lsd (open -n -W: the app is its own responsible process)"
clear_stale phaselsd
LOG="$EVID/phaselsd.stdout.log"
LAUNCH_AGENT_LINES=$(wc -l < "$EVID/host-agent.log")
t 420 open -n -W --env INSOMNIUM_MAS_PROBE=1 --env INSOMNIUM_MAS_PROBE_PHASE=lsd --env "INSOMNIUM_MAS_PROBE_REAL_HOME=$HOME" \
  --env "INSOMNIUM_MAS_PROBE_CA_B64=$CA_B64" --stdout "$LOG" --stderr "$LOG" "$APP" > "$EVID/open-lsd.txt" 2>&1 &
OPEN_PID=$!
startup_guard lsd lsd
wait "$OPEN_PID"
obs "phase lsd open exit: $?"
lock_obs phaselsd
collect lsd
ps -axo pid,ppid,user,command | grep -F "$APP" | grep -v grep | cut -c1-260 > "$EVID/ps-after-lsd.txt"
cleanup_procs

# ---------------------------------------------------------------- url-cold: open insomnia://... while not running
log "=== url-cold"
clear_stale url-cold
t 20 "$LSHANDLER" insomnia > "$EVID/ls-handler-before-url-cold.txt" 2>&1
mkdir -p "$UD/mas-probe" 2>> "$EVID/probe-run.log"
if echo '{"phase":"url-cold"}' > "$UD/mas-probe/arm.json" 2>> "$EVID/probe-run.log"; then
  obs "url-cold: arm file written to $UD/mas-probe/arm.json"
  LOG=/dev/null
  LAUNCH_AGENT_LINES=$(wc -l < "$EVID/host-agent.log")
  t 90 open 'insomnia://app/probe?x=1&cold=1' > "$EVID/open-url-cold.txt" 2>&1
  obs "url-cold: open exit $?"
  startup_guard url-cold url-cold
  if wait_file "$EVID/agent-reports/probe-report-phaseurl-cold.json" 60; then
    obs "url-cold: the URL-launched instance reported (agent)"
    sleep 3
  else
    obs "url-cold: NO report from a URL-launched instance after 60s"
  fi
  if [ -f "$UD/mas-probe/arm.json" ]; then obs "url-cold: arm file NOT consumed"; else obs "url-cold: arm file consumed"; fi
else
  obs "url-cold: could not write the arm file (container write from the host blocked?)"
fi
ps -axo pid,ppid,command | grep -F "Insomnium.app" | grep -v grep | cut -c1-260 > "$EVID/ps-url-cold.txt"
collect url-cold
rm -f "$UD/mas-probe/arm.json"
cleanup_procs

# ---------------------------------------------------------------- simulated update: bump CFBundleVersion + re-sign
log "=== simulated update"
container_meta before-update
t 60 codesign -dvvv "$APP" > "$EVID/update-codesign-before.txt" 2>&1
OLD_V="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP/Contents/Info.plist")"
if printf '%s' "$OLD_V" | grep -qE '^[0-9]+$'; then NEW_V=$((OLD_V + 1)); else NEW_V="$OLD_V.1"; fi
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $NEW_V" "$APP/Contents/Info.plist"
bash "$HERE/sign-adhoc.sh" "$APP" "$ENT" "$ENT_INHERIT" > "$EVID/update-sign.log" 2>&1
obs "update re-sign exit: $?"
t 60 codesign -dvvv "$APP" > "$EVID/update-codesign-after.txt" 2>&1
t 60 "$LSREGISTER" -f "$APP" >> "$EVID/lsregister.txt" 2>&1
CD_BEFORE="$(grep -m1 '^CDHash=' "$EVID/update-codesign-before.txt" | cut -d= -f2)"
CD_AFTER="$(grep -m1 '^CDHash=' "$EVID/update-codesign-after.txt" | cut -d= -f2)"
printf '{"old_bundle_version":"%s","new_bundle_version":"%s","cdhash_before":"%s","cdhash_after":"%s","note":"ad-hoc signature: the designated requirement is the cdhash, so a team-signed update may behave differently"}\n' \
  "$OLD_V" "$NEW_V" "$CD_BEFORE" "$CD_AFTER" > "$EVID/update-info.json"
obs "update: CFBundleVersion $OLD_V -> $NEW_V, cdhash $CD_BEFORE -> $CD_AFTER"

# ---------------------------------------------------------------- phase 4 (post-update)
log "=== phase 4"
launch 4 300
startup_guard p4 4 || { sleep 20; startup_guard p4-retry 4; }
wait_marker 'MASPROBE:STAGE done' 280 || true
wait_exit 20
obs "phase4 exit: $EXIT_RC"
lock_obs phase4
collect 4
cleanup_procs
container_meta after-p4

# ---------------------------------------------------------------- MCP discovery file + container listing
ls -la "$HOME/.insomnium" > "$EVID/real-home-insomnium-dir.txt" 2>&1
find "$CONTAINER" -maxdepth 6 \( -name 'mcp.json' -o -name '.insomnium' -o -name 'mas-probe' \) > "$EVID/container-probe-files.txt" 2>&1
t 60 find "$CONTAINER/Data" -maxdepth 3 > "$EVID/container-tree.txt" 2>&1
ls -la "$HOME/Library/Group Containers/" > "$EVID/group-containers.txt" 2>&1
ls -la "$HOME/Library/Group Containers/M4B2LM9HCJ.com.insomnium.app" >> "$EVID/group-containers.txt" 2>&1
t 20 "$LSHANDLER" insomnia > "$EVID/ls-handler-after.txt" 2>&1

# ---------------------------------------------------------------- crash reports (with positive controls)
mkdir -p "$EVID/crash-reports"
REPORT_DIRS="$HOME/Library/Logs/DiagnosticReports /Library/Logs/DiagnosticReports"
for i in $(seq 1 45); do
  missing=0
  while read -r kind pid _; do
    [ -n "$pid" ] && [ "$pid" != null ] || continue
    grep -rlsE "\"pid\" ?: ?$pid[,}]" $REPORT_DIRS > /dev/null 2>&1 || missing=$((missing + 1))
  done < "$EVID/crash-control.txt"
  [ "$missing" -eq 0 ] && break
  sleep 2
done
for d in $REPORT_DIRS; do
  find "$d" -type f -newer "$EVID/.start-marker" 2>/dev/null | while IFS= read -r f; do
    cp "$f" "$EVID/crash-reports/" 2>/dev/null
  done
done
: > "$EVID/crash-control-found.txt"
while read -r kind pid _; do
  f="$(grep -lsE "\"pid\" ?: ?$pid[,}]" "$EVID/crash-reports/"* 2>/dev/null | head -1)"
  if [ -n "$f" ]; then r="$(basename "$f")"; else r=MISSING; fi
  echo "$kind pid=$pid report=$r" >> "$EVID/crash-control-found.txt"
done < "$EVID/crash-control.txt"
obs "crash positive controls: $(tr '\n' ';' < "$EVID/crash-control-found.txt")"
obs "crash reports since start: $(ls "$EVID/crash-reports" | tr '\n' ' ')"

# ---------------------------------------------------------------- unified log
t 300 log show --start "$START_TS" --style syslog --info --predicate \
  'process CONTAINS "Insomnium" OR subsystem == "com.apple.sandbox.reporting" OR process == "sandboxd" OR (process == "kernel" AND (eventMessage CONTAINS[c] "sandbox" OR eventMessage CONTAINS "AMFI")) OR process == "amfid" OR (process == "tccd" AND eventMessage CONTAINS[c] "insomnium") OR (process == "containermanagerd" AND eventMessage CONTAINS[c] "insomnium") OR process == "ScopedBookmarkAgent" OR (process == "launchservicesd" AND eventMessage CONTAINS[c] "insomni") OR (process == "ReportCrash" AND eventMessage CONTAINS[c] "insomnium")' \
  > "$EVID/unified-log.txt" 2>&1
grep -iE 'deny|violation' "$EVID/unified-log.txt" > "$EVID/unified-log-deny.txt"
grep -oE 'deny\([0-9]+\) [a-z0-9*-]+ [^ ]+' "$EVID/unified-log-deny.txt" | sed -E 's/deny\([0-9]+\)/deny/' | sort | uniq -c | sort -rn > "$EVID/deny-summary.txt"
grep -iE 'ScopedBookmarkAgent|containermanagerd' "$EVID/unified-log.txt" | cut -c1-600 > "$EVID/unified-log-bookmark-container.txt"
obs "unified log: $(wc -l < "$EVID/unified-log.txt") lines, $(wc -l < "$EVID/unified-log-deny.txt") deny/violation lines, $(grep -c 'Description: AppSandbox' "$EVID/unified-log.txt") libsecinit AppSandbox lines"

# ---------------------------------------------------------------- merged report
kill "$AGENT_PID" 2>/dev/null
node "$HERE/merge-report.js" "$EVID" "$FLAVOR" "$OSLABEL"
gzip -k "$EVID/unified-log.txt" && rm -f "$EVID/unified-log.txt"
rm -f "$EVID"/.dialog-closed-*
log "done"
exit 0
