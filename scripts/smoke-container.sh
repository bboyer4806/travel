#!/usr/bin/env bash
set -euo pipefail

# Used only on an ephemeral GitHub Actions runner, with a dedicated test volume.
image="travel-check"
container="travel-check"
volume="travel-check-storage"
cleanup() {
  if [ "$?" -ne 0 ]; then docker logs "$container" || true; fi
  docker rm -f "$container" travel-check-no-storage >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build -t "$image" .
docker volume create "$volume" >/dev/null
docker run --rm --user 0 --entrypoint sh -v "$volume:/data" "$image" -c 'touch /data/.travel-persistent-storage && chown -R 1001:1001 /data'

start() {
  docker run -d --name "$container" -p 127.0.0.1:3007:80 -v "$volume:/data" "$image" >/dev/null
  curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --retry-max-time 45 --retry 20 --retry-delay 1 --retry-connrefused --retry-all-errors http://127.0.0.1:3007/api/health
}

start
docker exec "$container" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/data/travel.sqlite'); db.prepare('INSERT INTO trips(id,name,dateLabel,homeCity,travelers,notes,createdAt) VALUES(?,?,?,?,?,?,?)').run('container-smoke','Persistence test','','',2,'',new Date().toISOString()); db.close();"

# Replace the container, keeping the explicitly mounted volume.
docker rm -f "$container" >/dev/null
start
docker exec "$container" node --input-type=module -e "import { DatabaseSync } from 'node:sqlite'; const db = new DatabaseSync('/data/travel.sqlite'); if (!db.prepare('SELECT id FROM trips WHERE id = ?').get('container-smoke')) process.exitCode = 1; db.close();"

# A container without the persistent mount must refuse to start.
set +e
timeout 10s docker run --rm --name travel-check-no-storage "$image" > storage-guard.log 2>&1
guard_status=$?
set -e
if [ "$guard_status" -ne 1 ] || ! grep -q "Persistent travel storage is not ready" storage-guard.log; then
  cat storage-guard.log >&2
  echo "The app did not correctly refuse startup without persistent storage." >&2
  exit 1
fi
