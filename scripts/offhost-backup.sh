#!/usr/bin/env bash
# Install on the production host as /usr/local/sbin/travel-offhost-backup (root:root, mode 700).
set -euo pipefail
umask 077

. /etc/travel-backup.env
: "$TRAVEL_BACKUP_RECIPIENT"
: "$TRAVEL_BACKUP_WINDOWS_USER"
: "$TRAVEL_BACKUP_TAILSCALE_IP"
: "$TRAVEL_BACKUP_SSH_KEY"

storage=/var/lib/dokku/data/storage/travel
known_hosts=/etc/travel-backup-known-hosts
test -d "$storage"
test -s "$known_hosts"
test -r "$TRAVEL_BACKUP_SSH_KEY"
command -v age >/dev/null
command -v openssl >/dev/null
command -v dokku >/dev/null
command -v scp >/dev/null
command -v ssh >/dev/null

work=$(mktemp -d "$storage/.offhost-XXXXXX")
trap 'rm -rf -- "$work"' EXIT
chown 1001:1001 "$work"

# Backup uses SQLite's online backup API and validates PRAGMA integrity_check.
dokku run travel node scripts/backup.mjs "/data/$(basename "$work")/snapshot.sqlite"
test -s "$work/snapshot.sqlite"

filename="travel-$(date -u +%Y%m%dT%H%M%SZ)-$(openssl rand -hex 8).sqlite.age"
age -r "$TRAVEL_BACKUP_RECIPIENT" -o "$work/$filename" "$work/snapshot.sqlite"
rm -f -- "$work/snapshot.sqlite"
test -s "$work/$filename"

target="$TRAVEL_BACKUP_WINDOWS_USER@$TRAVEL_BACKUP_TAILSCALE_IP"
scp -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" -i "$TRAVEL_BACKUP_SSH_KEY" "$work/$filename" "$target:travel-backups/$filename"
hash=$(sha256sum "$work/$filename" | cut -d' ' -f1)
# The Windows receiver independently verifies the SHA-256 checksum and removes
# backups older than 30 days. A nonzero result blocks deployment.
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$known_hosts" -i "$TRAVEL_BACKUP_SSH_KEY" "$target" "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File travel-backups\\verify-retain.ps1 $filename $hash"
printf 'Verified encrypted off-host Travel backup: %s\n' "$filename"
