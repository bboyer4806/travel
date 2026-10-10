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
docker exec -i "$container" node --input-type=module <<'JS'
import { DatabaseSync } from 'node:sqlite';
const db = new DatabaseSync('/data/travel.sqlite');
const destinationId = '22222222-2222-4222-8222-222222222222';
const imageVersion = '33333333-3333-4333-8333-333333333333';
// A real 2-by-2 lossless WebP, generated with sharp.
const image = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=', 'base64');
db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
db.prepare('INSERT INTO trips(id,name,dateLabel,homeCity,travelers,notes,createdAt) VALUES(?,?,?,?,?,?,?)').run('container-smoke','Persistence test','','',2,'',new Date().toISOString());
db.prepare('INSERT INTO destinations(id,tripId,city,stay,notes,position) VALUES(?,?,?,?,?,?)').run(destinationId, 'container-smoke', 'Vienna', '', '', 0);
db.prepare('INSERT INTO destination_images(destinationId,version,data) VALUES(?,?,?)').run(destinationId, imageVersion, image);
db.exec('COMMIT;');
db.close();
JS

# Replace the container, keeping the explicitly mounted volume.
docker rm -f "$container" >/dev/null
start
docker exec -i "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const destinationId = '22222222-2222-4222-8222-222222222222';
const imageVersion = '33333333-3333-4333-8333-333333333333';
const expected = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=', 'base64');
const db = new DatabaseSync('/data/travel.sqlite');
try {
  assert.ok(db.prepare('SELECT id FROM trips WHERE id = ?').get('container-smoke'));
  assert.ok(db.prepare('SELECT id FROM destinations WHERE id = ?').get(destinationId));
  const image = db.prepare('SELECT version,data FROM destination_images WHERE destinationId = ?').get(destinationId);
  assert.equal(image?.version, imageVersion);
  assert.deepEqual(Buffer.from(image.data), expected);
} finally {
  db.close();
}
const endpoint = 'http://127.0.0.1:80/api/destination-images/' + destinationId;
const options = () => ({ signal: AbortSignal.timeout(5000) });
const response = await fetch(endpoint + '?v=' + imageVersion, options());
assert.equal(response.status, 200);
assert.equal(response.headers.get('content-type'), 'image/webp');
assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
const missingVersion = await fetch(endpoint + '?v=44444444-4444-4444-8444-444444444444', options());
assert.equal(missingVersion.status, 404);
const missingImage = await fetch('http://127.0.0.1:80/api/destination-images/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
assert.equal(missingImage.status, 404);
JS

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
