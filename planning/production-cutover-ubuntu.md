# SignalBrief Production Cutover Runbook (Ubuntu VM + Docker Compose)

Updated: 2026-03-05 (America/New_York)

## Goal

Move runtime off the local Mac so digest delivery does not depend on laptop sleep/wake state.

Target topology:
- `web` container (`web/server.js`)
- `bot` container (`bot-server.js`)
- `worker` container (`scheduler-worker.js`)

All share persisted volumes:
- `/opt/signalbrief/data`
- `/opt/signalbrief/archive`

## 1) Provision Host

Use any always-on Ubuntu 24.04 VM (2 vCPU / 2 GB RAM minimum).

```bash
# on your local machine
export SB_HOST=<vm-ip-or-dns>
ssh root@$SB_HOST
```

## 2) Base OS + Docker

```bash
apt-get update
apt-get install -y ca-certificates curl git ufw

install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable docker
systemctl start docker
docker --version
docker compose version
```

## 3) App Checkout + Directories

```bash
mkdir -p /opt/signalbrief
cd /opt/signalbrief
git clone https://github.com/kg227-dev/signalbrief.git app
cd app

# persistent runtime state
mkdir -p data archive
```

## 4) Secrets + Runtime Config

Copy your existing `config.json` from current production machine.

```bash
# from local machine
scp /Users/kushgulati/Desktop/signalbrief/config.json root@$SB_HOST:/opt/signalbrief/app/config.json

# on VM
cd /opt/signalbrief/app
cp .env.example .env
```

Edit `.env`:

```bash
nano /opt/signalbrief/app/.env
```

Minimum values:
- `BASE_URL=https://getsignalbrief.com`
- `OPS_ALERT_CHAT_ID=<your ops chat id>` (recommended)

## 5) First Boot

```bash
cd /opt/signalbrief/app
docker compose up -d --build
docker compose ps
docker compose logs --no-color --tail=120 worker
```

Expected:
- all three services show `Up`
- worker logs show periodic digest launches

## 6) Rigorous Verification

### 6.1 Local smoke checks in containerized runtime

```bash
cd /opt/signalbrief/app
node --check digest.js
node --check scheduler-worker.js
node --check web/server.js
npm run smoke:worker
npm run smoke:admin-scheduler
```

### 6.2 Service health checks on VM

```bash
cd /opt/signalbrief/app
docker compose ps
docker compose logs --no-color --tail=200 worker
docker compose logs --no-color --tail=200 web

# worker heartbeat freshness
python3 - <<'PY'
import json, time
p="/opt/signalbrief/app/data/scheduler-heartbeat.json"
obj=json.load(open(p))
age=time.time()-__import__('datetime').datetime.fromisoformat(obj["updated_at"].replace("Z","+00:00")).timestamp()
print("heartbeat_age_seconds=",round(age,1))
print("last_run=",obj.get("last_run"))
PY
```

### 6.3 Live endpoint checks

```bash
curl -sSI https://getsignalbrief.com/ | head -n 1
curl -sSI https://getsignalbrief.com/admin | head -n 1
curl -sSI https://getsignalbrief.com/digest | head -n 1
```

Expect `HTTP/2 200`.

### 6.4 Scheduled delivery proof

Within one polling cycle (5 minutes), verify a scheduler run wrote to `data/cost-log.json`:

```bash
tail -n 3 /opt/signalbrief/app/data/cost-log.json
```

You should see a fresh `run_at` timestamp and `on_demand:false` entries when users are due.

## 7) Cut DNS / Tunnel to VM

You currently run Cloudflare tunnel from Mac. Move ingress to VM to complete cutover.

Two options:
- Keep Cloudflare Tunnel, but run `cloudflared` on VM.
- Switch DNS A/AAAA directly to VM + reverse proxy (Caddy/Nginx).

If using Cloudflare Tunnel on VM, ensure `getsignalbrief.com` routes to `http://127.0.0.1:3003`.

## 8) Decommission Mac Scheduler (after 24h clean run)

On Mac:

```bash
launchctl unload ~/Library/LaunchAgents/com.jarvis.signalbrief-digest.plist || true
launchctl unload ~/Library/LaunchAgents/com.jarvis.signalbrief-web.plist || true
launchctl unload ~/Library/LaunchAgents/com.jarvis.signalbrief-bot.plist || true
```

Keep a one-day rollback window before deleting local files.

## 9) Rollback Plan

If VM runtime fails:
1. Restore Mac LaunchAgents.
2. Re-point traffic/tunnel back to Mac.
3. Trigger manual catch-up:

```bash
cd /Users/kushgulati/Desktop/signalbrief
node digest.js
```

## 10) Ongoing Ops

Daily checks:

```bash
cd /opt/signalbrief/app
docker compose ps
docker compose logs --no-color --tail=120 worker
```

Deploy updates:

```bash
cd /opt/signalbrief/app
git pull --rebase origin main
docker compose up -d --build
```

