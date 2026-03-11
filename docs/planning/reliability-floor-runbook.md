# Reliability Floor Runbook (Week 1)

Last updated: **March 11, 2026**

## Purpose

Define the minimum operational standard for state protection and fast recovery.

This runbook covers:
- scheduled state backups (`data/`, `archive/`)
- backup retention policy
- restore drill procedure
- incident restore procedure

## Scope

- Runtime topology: single Ubuntu VM with Docker Compose (`web`, `bot`, `worker`)
- State paths: `/opt/signalbrief/app/data`, `/opt/signalbrief/app/archive`
- Backup scripts:
  - `npm run ops:backup:state`
  - `npm run ops:drill:restore-state`

## Backup Policy

## Cadence

- Nightly backup: **daily at 02:15 ET**
- Pre-deploy backup: run immediately before each production deploy
- On-demand backup: allowed before any high-risk operation touching state

## Retention

- Keep at least **14** most recent backups on-host
- Backup retention is controlled via `SIGNALBRIEF_BACKUP_KEEP` (default `14`)
- Recommended backup directory on VM:
  - `/opt/signalbrief/backups`

## Backup Command (VM)

Run from `/opt/signalbrief/app`:

```bash
SIGNALBRIEF_BACKUP_DIR=/opt/signalbrief/backups \
SIGNALBRIEF_BACKUP_KEEP=14 \
npm run -s ops:backup:state
```

Expected output includes:
- `OK archive=...state-backup-<timestamp>-<sha>.tgz`
- `files=<n> bytes=<n>`

## Scheduled Execution Examples

## Option A: cron

Install crontab entry for user `ubuntu`:

```cron
15 2 * * * cd /opt/signalbrief/app && SIGNALBRIEF_BACKUP_DIR=/opt/signalbrief/backups SIGNALBRIEF_BACKUP_KEEP=14 npm run -s ops:backup:state >> /var/log/signalbrief-backup.log 2>&1
```

## Option B: systemd timer

Create `/etc/systemd/system/signalbrief-backup.service`:

```ini
[Unit]
Description=SignalBrief state backup
After=network.target docker.service

[Service]
Type=oneshot
User=ubuntu
WorkingDirectory=/opt/signalbrief/app
Environment=SIGNALBRIEF_BACKUP_DIR=/opt/signalbrief/backups
Environment=SIGNALBRIEF_BACKUP_KEEP=14
ExecStart=/usr/bin/npm run -s ops:backup:state
StandardOutput=append:/var/log/signalbrief-backup.log
StandardError=append:/var/log/signalbrief-backup.log
```

Create `/etc/systemd/system/signalbrief-backup.timer`:

```ini
[Unit]
Description=Run SignalBrief state backup daily

[Timer]
OnCalendar=*-*-* 02:15:00
Persistent=true
Unit=signalbrief-backup.service

[Install]
WantedBy=timers.target
```

Enable timer:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now signalbrief-backup.timer
sudo systemctl list-timers signalbrief-backup.timer
```

## Restore Drill Checklist (No Production Impact)

Run at least weekly.

1. Ensure latest backup exists.
2. Run drill extraction + checksum verification:

```bash
SIGNALBRIEF_BACKUP_DIR=/opt/signalbrief/backups \
npm run -s ops:drill:restore-state -- --latest --clean
```

3. Confirm output includes:
  - `verified files=...`
  - `restore drill OK`
4. Record drill timestamp and operator in ops notes.

## Incident Restore Procedure (Production Impact)

Use only when live state is corrupted/lost and service behavior is degraded.

1. Select recovery point:
  - pick newest known-good `state-backup-*.tgz`
2. Stop writes:

```bash
cd /opt/signalbrief/app
docker compose stop web bot worker
```

3. Extract backup to staging directory:

```bash
mkdir -p /tmp/signalbrief-restore-live
tar -xzf /opt/signalbrief/backups/state-backup-<timestamp>-<sha>.tgz -C /tmp/signalbrief-restore-live
```

4. Replace live state from extracted payload:

```bash
rm -rf /opt/signalbrief/app/data /opt/signalbrief/app/archive
cp -R /tmp/signalbrief-restore-live/data /opt/signalbrief/app/data
cp -R /tmp/signalbrief-restore-live/archive /opt/signalbrief/app/archive
```

5. Restart services:

```bash
cd /opt/signalbrief/app
docker compose up -d web bot worker
```

6. Verify runtime:

```bash
npm run -s ops:verify-runtime:quick
curl -sS https://getsignalbrief.com/api/health/scheduler
```

7. Validate public checks:
  - `GET /` returns `200`
  - cache-busted `index.js?v=...` is present on landing page
  - `GET /api/health/scheduler` returns `{"ok": true}`
8. If verification fails, roll forward to next newest backup and repeat.

## Drill Acceptance Criteria

- Restore drill completes in **< 30 minutes**
- Manifest verification has zero mismatches
- Post-restore runtime checks are green

## Ownership

- Primary owner: platform/runtime maintainer on call
- Secondary owner: any engineer with VM deploy access and SSH key
