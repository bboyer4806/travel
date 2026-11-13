#!/usr/bin/env bash
set -euo pipefail

# Used only on an ephemeral GitHub Actions runner, with a dedicated test volume.
image="travel-check"
container="travel-check"
volume="travel-check-storage"
# The schema version this build upgrades every database to. The checks run in the container, which has no source.
schema_version="$(node --input-type=module --eval 'import { SCHEMA_VERSION } from "./src/lib/store.ts"; console.log(SCHEMA_VERSION);')"
cleanup() {
  if [ "$?" -ne 0 ]; then docker logs "$container" || true; fi
  docker rm -f "$container" travel-check-refusal >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Server Action IDs derive from this key, which every deploy passes to the build. A throwaway key
# is enough to check that the build used it.
server_actions_key="$(node --print 'require("node:crypto").randomBytes(32).toString("base64")')"
NEXT_SERVER_ACTIONS_ENCRYPTION_KEY="$server_actions_key" docker build --secret id=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY,env=NEXT_SERVER_ACTIONS_ENCRYPTION_KEY -t "$image" .
built_key="$(docker run --rm --entrypoint node "$image" --print 'require("./.next/server/server-reference-manifest.json").encryptionKey')"
if [ "$built_key" != "$server_actions_key" ]; then
  echo "The image was not built with the given Server Actions key." >&2
  exit 1
fi
docker volume create "$volume" >/dev/null
docker run --rm --user 0 --entrypoint sh -v "$volume:/data" "$image" -c 'touch /data/.travel-persistent-storage && chown -R 1001:1001 /data'

# Test-only sign-in settings. Google is never called: sessions are inserted as a completed sign-in leaves them.
auth_env=(-e GOOGLE_CLIENT_ID=smoke-test-client -e GOOGLE_CLIENT_SECRET=smoke-test-secret -e TRAVEL_OWNER_EMAIL=owner@example.test)

start() {
  docker run -d --name "$container" -p 127.0.0.1:3007:80 -v "$volume:/data" "${auth_env[@]}" "$image" >/dev/null
  curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --retry-max-time 45 --retry 20 --retry-delay 1 --retry-connrefused --retry-all-errors http://127.0.0.1:3007/api/health
}

start
docker exec -i -e SCHEMA_VERSION="$schema_version" "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
// Image uploads and Server Actions must be able to load the packaged native runtime.
const processed = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).webp().toBuffer();
assert.ok(processed.length > 0);
const db = new DatabaseSync('/data/travel.sqlite');
const destinationId = '22222222-2222-4222-8222-222222222222';
const imageVersion = '33333333-3333-4333-8333-333333333333';
const requirements = { passportNationality: 'United States', travelPurpose: 'Tourism', travelerCircumstances: 'Whole party', visaRequirements: 'Review authorization rules', passportValidity: 'Review passport rules', requiredDocuments: 'Review health and entry documents', transitRequirements: 'Review transit rules separately', notes: 'Manually maintained', sources: [{ id: 'c1000000-0000-4000-8000-000000000001', url: 'https://example.gov/entry', description: 'Official source' }], lastCheckedDate: '2026-11-03' };
const healthSafety = { advisoryLevel: 'Level 1: Exercise normal precautions', advisoryWarnings: 'Review the advisory before departure', healthPrecautions: 'Routine vaccines', localSafety: 'Watch for pickpockets', emergencyContacts: [{ id: 'f1000000-0000-4000-8000-000000000001', name: 'Emergency services', phone: '112', notes: 'Police, fire and ambulance' }], sources: [{ id: 'f2000000-0000-4000-8000-000000000001', url: 'https://example.gov/advisory', description: 'Official advisory' }], lastCheckedDate: '2026-11-10' };
const candidates = [
  { id: '66666666-6666-4666-8666-666666666666', category: 'hotels', version: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { id: '77777777-7777-4777-8777-777777777777', category: 'activities', version: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
  { id: '88888888-8888-4888-8888-888888888888', category: 'restaurants', version: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
];
const churches = [
  { id: 'b1000000-0000-4000-8000-000000000001', name: 'St. Stephen', address: 'Stephansplatz 3, Vienna', denomination: 'Catholic', url: 'https://example.com/church', massTimes: [
    { id: 'b2000000-0000-4000-8000-000000000001', day: 'Sunday', time: '09:00' },
    { id: 'b2000000-0000-4000-8000-000000000002', day: '2027-05-13', time: '18:30' },
  ] },
  { id: 'b1000000-0000-4000-8000-000000000002', name: 'Church with unknown times', address: '', denomination: '', url: '', massTimes: [] },
];
// Two different real 2-by-2 lossless WebP images, generated with sharp.
const images = [
  Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=', 'base64'),
  Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQwjaXpf+BiOh/AAA=', 'base64'),
];
assert.equal(db.prepare('PRAGMA user_version').get().user_version, Number(process.env.SCHEMA_VERSION));
// TRAVEL_OWNER_EMAIL is authorized at startup, before anyone signs in.
assert.deepEqual(db.prepare('SELECT email, googleSubject FROM accounts').all().map(row => ({...row})), [{ email: 'owner@example.test', googleSubject: null }]);
db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
// As the owner's first Google sign-in leaves it: the stable subject bound, and a session per browser
// stored only as a token hash. One session has already expired.
const owner = db.prepare("SELECT id FROM accounts WHERE email = 'owner@example.test'").get().id;
db.prepare("UPDATE accounts SET googleSubject = 'smoke-owner-subject', name = 'Smoke Owner' WHERE id = ?").run(owner);
const tokenHash = (token) => createHash('sha256').update(token).digest('hex');
db.prepare('INSERT INTO sessions(tokenHash, accountId, expiresAt) VALUES(?,?,?)').run(tokenHash('smoke-owner-session'), owner, Date.now() + 3_600_000);
db.prepare('INSERT INTO sessions(tokenHash, accountId, expiresAt) VALUES(?,?,?)').run(tokenHash('smoke-expired-session'), owner, Date.now() - 60_000);
// Two more signed-in accounts: one the owner shares the trip with, and one it is never shared with.
for (const [id, person] of [['e1000000-0000-4000-8000-000000000001', 'editor'], ['e1000000-0000-4000-8000-000000000002', 'outsider']]) {
  db.prepare('INSERT INTO accounts(id,email,googleSubject,name,authorizedAt) VALUES(?,?,?,?,?)').run(id, `${person}@example.test`, `smoke-${person}-subject`, `Smoke ${person}`, new Date().toISOString());
  db.prepare('INSERT INTO sessions(tokenHash, accountId, expiresAt) VALUES(?,?,?)').run(tokenHash(`smoke-${person}-session`), id, Date.now() + 3_600_000);
}
db.prepare('INSERT INTO trips(id,name,dateLabel,homeCity,travelers,notes,createdAt,ownerId) VALUES(?,?,?,?,?,?,?,?)').run('container-smoke','Persistence test','','',2,'',new Date().toISOString(),owner);
db.prepare('INSERT INTO trip_shares(tripId,accountId,sharedAt) VALUES(?,?,?)').run('container-smoke', 'e1000000-0000-4000-8000-000000000001', new Date().toISOString());
db.prepare("UPDATE trips SET startDate = '2027-05-10' WHERE id = 'container-smoke'").run();
db.prepare('INSERT INTO home_items(id,tripId,name,priceCents,notes,completed,createdAt) VALUES(?,?,?,?,?,?,?)').run('a1000000-0000-4000-8000-000000000001','container-smoke','House sitting',23950,'Give sitter a key',1,'2026-10-12T12:00:00.000Z');
db.prepare('INSERT INTO home_items(id,tripId,name,priceCents,notes,completed,createdAt) VALUES(?,?,?,?,?,?,?)').run('a1000000-0000-4000-8000-000000000002','container-smoke','Pause mail',null,'Arrange before leaving',0,'2026-10-12T12:01:00.000Z');
// The owner's shared destination, and the trip's stop there, which shares its ID as each destination's first stop does.
db.prepare('INSERT INTO destinations(id,ownerId,city,cityKey,notes,miscDailyMinor,miscCurrency,hotelNightlyMinor,hotelCurrency) VALUES(?,?,?,?,?,?,?,?,?)').run(destinationId, owner, 'Vienna', 'vienna', '', 3250, 'USD', 17525, 'USD');
db.prepare('INSERT INTO trip_stops(id,tripId,destinationId,position,stay,nights,arrivalDate,departureDate) VALUES(?,?,?,?,?,?,?,?)').run(destinationId, 'container-smoke', destinationId, 0, 'Spring visit', 3, '2027-05-10', '2027-05-13');
db.prepare("UPDATE destinations SET activitiesBudgetMode = 'general', activitiesGeneralMinor = 22550, activitiesCurrency = 'USD' WHERE id = ?").run(destinationId);
db.prepare("UPDATE destinations SET foodBudgetMode = 'daily', foodDailyMinor = 8025, foodCurrency = 'USD' WHERE id = ?").run(destinationId);
db.prepare("UPDATE destinations SET shoppingMinor = 12550, shoppingCurrency = 'USD' WHERE id = ?").run(destinationId);
db.prepare('UPDATE destinations SET weatherHighF=?,weatherLowF=?,weatherRainfall=?,weatherPeriod=?,weatherSource=? WHERE id=?').run(0,-12.5,'Light winter precipitation','January','Historical climate notes',destinationId);
for (const [index, data] of images.entries()) {
  db.prepare('INSERT INTO destination_images(id,destinationId,version,data,position,isMain) VALUES(?,?,?,?,?,?)').run(`a2000000-0000-4000-8000-00000000000${index + 1}`, destinationId, index === 0 ? imageVersion : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', data, 1 - index, index === 0 ? 1 : 0);
}
db.prepare('INSERT INTO destination_entry_requirements(destinationId,requirementsJson) VALUES(?,?)').run(destinationId, JSON.stringify(requirements));
db.prepare('INSERT INTO destination_health_safety(destinationId,healthSafetyJson) VALUES(?,?)').run(destinationId, JSON.stringify(healthSafety));
for (const [index, candidate] of candidates.entries()) {
  db.prepare('INSERT INTO candidates(id,destinationId,category,name,position,mustDo) VALUES(?,?,?,?,?,?)').run(candidate.id, destinationId, candidate.category, 'Persistence test: ' + candidate.category, index + 2, candidate.category === 'hotels' ? 0 : 1);
  for (const [position, data] of images.entries()) {
    const photoId = `90000000-0000-4000-8000-${String(index * 2 + position + 1).padStart(12, '0')}`;
    const version = position === 1 ? candidate.version : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    db.prepare('INSERT INTO candidate_images(id,candidateId,version,data,position,isMain) VALUES(?,?,?,?,?,?)')
      .run(photoId, candidate.id, version, data, position, position === 1 ? 1 : 0);
  }
}
db.prepare("UPDATE candidates SET included = 1, priceCents = 40000 WHERE category = 'hotels'").run();
db.prepare("UPDATE candidates SET included = 1, priceCents = 7550 WHERE category = 'activities'").run();
db.prepare("UPDATE candidates SET included = 1, priceCents = 4525 WHERE category = 'restaurants'").run();
db.prepare('UPDATE destinations SET churchEnabled = 1 WHERE id = ?').run(destinationId);
for (const church of churches) {
  db.prepare('INSERT INTO churches(id,destinationId,name,address,denomination,url,massTimesJson) VALUES(?,?,?,?,?,?,?)')
    .run(church.id, destinationId, church.name, church.address, church.denomination, church.url, JSON.stringify(church.massTimes));
}
for (const [position, data] of images.entries()) {
  db.prepare('INSERT INTO church_images(id,churchId,version,data,position,isMain) VALUES(?,?,?,?,?,?)')
    .run(`b3000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`, churches[0].id, position === 1 ? 'b4000000-0000-4000-8000-000000000001' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', data, position, position === 1 ? 1 : 0);
}
// Hiding must preserve both churches and the gallery after container replacement.
db.prepare('UPDATE destinations SET churchEnabled = 0 WHERE id = ?').run(destinationId);
db.exec('COMMIT;');
db.close();
JS

# Replace the container, keeping the explicitly mounted volume.
docker rm -f "$container" >/dev/null
start
docker exec -i -e SCHEMA_VERSION="$schema_version" "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const destinationId = '22222222-2222-4222-8222-222222222222';
const imageVersion = '33333333-3333-4333-8333-333333333333';
const requirements = { passportNationality: 'United States', travelPurpose: 'Tourism', travelerCircumstances: 'Whole party', visaRequirements: 'Review authorization rules', passportValidity: 'Review passport rules', requiredDocuments: 'Review health and entry documents', transitRequirements: 'Review transit rules separately', notes: 'Manually maintained', sources: [{ id: 'c1000000-0000-4000-8000-000000000001', url: 'https://example.gov/entry', description: 'Official source' }], lastCheckedDate: '2026-11-03' };
const healthSafety = { advisoryLevel: 'Level 1: Exercise normal precautions', advisoryWarnings: 'Review the advisory before departure', healthPrecautions: 'Routine vaccines', localSafety: 'Watch for pickpockets', emergencyContacts: [{ id: 'f1000000-0000-4000-8000-000000000001', name: 'Emergency services', phone: '112', notes: 'Police, fire and ambulance' }], sources: [{ id: 'f2000000-0000-4000-8000-000000000001', url: 'https://example.gov/advisory', description: 'Official advisory' }], lastCheckedDate: '2026-11-10' };
const candidates = [
  { id: '66666666-6666-4666-8666-666666666666', category: 'hotels', version: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  { id: '77777777-7777-4777-8777-777777777777', category: 'activities', version: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' },
  { id: '88888888-8888-4888-8888-888888888888', category: 'restaurants', version: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' },
];
const churches = [
  { id: 'b1000000-0000-4000-8000-000000000001', name: 'St. Stephen', address: 'Stephansplatz 3, Vienna', denomination: 'Catholic', url: 'https://example.com/church', massTimes: [
    { id: 'b2000000-0000-4000-8000-000000000001', day: 'Sunday', time: '09:00' },
    { id: 'b2000000-0000-4000-8000-000000000002', day: '2027-05-13', time: '18:30' },
  ] },
  { id: 'b1000000-0000-4000-8000-000000000002', name: 'Church with unknown times', address: '', denomination: '', url: '', massTimes: [] },
];
const images = [
  Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=', 'base64'),
  Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQwjaXpf+BiOh/AAA=', 'base64'),
];
const db = new DatabaseSync('/data/travel.sqlite');
try {
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, Number(process.env.SCHEMA_VERSION));
  assert.deepEqual(db.prepare('SELECT email, googleSubject, name FROM accounts ORDER BY email').all().map(row => ({...row})), [
    { email: 'editor@example.test', googleSubject: 'smoke-editor-subject', name: 'Smoke editor' },
    { email: 'outsider@example.test', googleSubject: 'smoke-outsider-subject', name: 'Smoke outsider' },
    { email: 'owner@example.test', googleSubject: 'smoke-owner-subject', name: 'Smoke Owner' },
  ], 'Authorization must persist');
  assert.equal(db.prepare('SELECT count(*) AS count FROM sessions').get().count, 4, 'Sessions must persist');
  assert.equal(db.prepare("SELECT accounts.email FROM trips JOIN accounts ON accounts.id = trips.ownerId WHERE trips.id = 'container-smoke'").get().email, 'owner@example.test', 'Ownership must persist');
  assert.deepEqual(db.prepare('SELECT tripId, accountId FROM trip_shares').all().map(row => ({...row})), [{ tripId: 'container-smoke', accountId: 'e1000000-0000-4000-8000-000000000001' }], 'Sharing must persist');
  assert.equal(db.prepare('SELECT startDate FROM trips WHERE id = ?').get('container-smoke').startDate, '2027-05-10');
  assert.deepEqual({ ...db.prepare('SELECT tripId,destinationId,position,stay,nights,arrivalDate,departureDate FROM trip_stops WHERE id = ?').get(destinationId) }, { tripId: 'container-smoke', destinationId, position: 0, stay: 'Spring visit', nights: 3, arrivalDate: '2027-05-10', departureDate: '2027-05-13' });
  const homeItems = db.prepare('SELECT name,priceCents,notes,completed,createdAt FROM home_items WHERE tripId = ? ORDER BY createdAt').all('container-smoke').map(row => ({...row}));
  assert.deepEqual(homeItems, [
    {name:'House sitting',priceCents:23950,notes:'Give sitter a key',completed:1,createdAt:'2026-10-12T12:00:00.000Z'},
    {name:'Pause mail',priceCents:null,notes:'Arrange before leaving',completed:0,createdAt:'2026-10-12T12:01:00.000Z'},
  ]);
  assert.deepEqual({ ...db.prepare('SELECT accounts.email,city,cityKey,miscDailyMinor,miscCurrency,hotelNightlyMinor,hotelCurrency FROM destinations JOIN accounts ON accounts.id = destinations.ownerId WHERE destinations.id = ?').get(destinationId) }, { email: 'owner@example.test', city: 'Vienna', cityKey: 'vienna', miscDailyMinor: 3250, miscCurrency: 'USD', hotelNightlyMinor: 17525, hotelCurrency: 'USD' });
  assert.deepEqual({ ...db.prepare('SELECT activitiesBudgetMode,activitiesGeneralMinor,activitiesCurrency FROM destinations WHERE id = ?').get(destinationId) }, { activitiesBudgetMode: 'general', activitiesGeneralMinor: 22550, activitiesCurrency: 'USD' });
  assert.deepEqual({ ...db.prepare('SELECT foodBudgetMode,foodDailyMinor,foodCurrency FROM destinations WHERE id = ?').get(destinationId) }, { foodBudgetMode: 'daily', foodDailyMinor: 8025, foodCurrency: 'USD' });
  assert.deepEqual({ ...db.prepare('SELECT shoppingMinor,shoppingCurrency FROM destinations WHERE id = ?').get(destinationId) }, { shoppingMinor: 12550, shoppingCurrency: 'USD' });
  assert.deepEqual({...db.prepare('SELECT weatherHighF,weatherLowF,weatherRainfall,weatherPeriod,weatherSource FROM destinations WHERE id=?').get(destinationId)}, {weatherHighF:0,weatherLowF:-12.5,weatherRainfall:'Light winter precipitation',weatherPeriod:'January',weatherSource:'Historical climate notes'});
  const image = db.prepare('SELECT version,data FROM destination_images WHERE destinationId = ? AND isMain = 1').get(destinationId);
  assert.equal(image?.version, imageVersion);
  assert.deepEqual(Buffer.from(image.data), images[0]);
  const destinationPhotos = db.prepare('SELECT id,version,data,position,isMain FROM destination_images WHERE destinationId = ? ORDER BY position').all(destinationId);
  assert.equal(destinationPhotos.length, 2);
  for (const [position, photo] of destinationPhotos.entries()) {
    const index = 1 - position;
    assert.equal(photo.id, `a2000000-0000-4000-8000-00000000000${index + 1}`);
    assert.equal(photo.position, position);
    assert.equal(photo.isMain, index === 0 ? 1 : 0);
    assert.deepEqual(Buffer.from(photo.data), images[index]);
  }
  assert.deepEqual(JSON.parse(db.prepare('SELECT requirementsJson FROM destination_entry_requirements WHERE destinationId = ?').get(destinationId).requirementsJson), requirements);
  assert.deepEqual(JSON.parse(db.prepare('SELECT healthSafetyJson FROM destination_health_safety WHERE destinationId = ?').get(destinationId).healthSafetyJson), healthSafety);
  assert.equal(db.prepare('SELECT count(*) AS count FROM candidate_images').get().count, 6);
  for (const [index, candidate] of candidates.entries()) {
    const saved = db.prepare('SELECT destinationId,category,included,priceCents,position,mustDo FROM candidates WHERE id = ?').get(candidate.id);
    assert.equal(saved?.destinationId, destinationId);
    assert.equal(saved.category, candidate.category);
    assert.equal(saved.position, index + 2);
    assert.equal(saved.mustDo, candidate.category === 'hotels' ? 0 : 1);
    if (candidate.category === 'hotels') { assert.equal(saved.included, 1); assert.equal(saved.priceCents, 40000); }
    if (candidate.category === 'activities') { assert.equal(saved.included, 1); assert.equal(saved.priceCents, 7550); }
    if (candidate.category === 'restaurants') { assert.equal(saved.included, 1); assert.equal(saved.priceCents, 4525); }
    const savedImages = db.prepare('SELECT id,version,data,position,isMain FROM candidate_images WHERE candidateId = ? ORDER BY position').all(candidate.id);
    assert.equal(savedImages.length, 2, candidate.category + ' must retain both photos');
    for (const [position, savedImage] of savedImages.entries()) {
      assert.equal(savedImage.id, `90000000-0000-4000-8000-${String(index * 2 + position + 1).padStart(12, '0')}`);
      assert.equal(savedImage.version, position === 1 ? candidate.version : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
      assert.equal(savedImage.position, position);
      assert.equal(savedImage.isMain, position === 1 ? 1 : 0, candidate.category + ' main selection must persist');
      assert.deepEqual(Buffer.from(savedImage.data), images[position], candidate.category + ' photo bytes must persist');
    }
  }
  assert.equal(db.prepare('SELECT churchEnabled FROM destinations WHERE id = ?').get(destinationId).churchEnabled, 0, 'Hidden Church section must remain hidden');
  const savedChurches = db.prepare('SELECT id,destinationId,name,address,denomination,url,massTimesJson FROM churches WHERE destinationId = ? ORDER BY id').all(destinationId);
  assert.deepEqual(savedChurches.map(({massTimesJson, ...church}) => ({...church, massTimes: JSON.parse(massTimesJson)})), churches.map(church => ({...church, destinationId})));
  assert.equal(db.prepare('SELECT count(*) AS count FROM candidates WHERE destinationId = ?').get(destinationId).count, 3, 'Churches must not enter the budget candidate table');
  const churchImages = db.prepare('SELECT id,churchId,version,data,position,isMain FROM church_images ORDER BY position').all();
  assert.equal(churchImages.length, 2);
  for (const [position, photo] of churchImages.entries()) {
    assert.equal(photo.id, `b3000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`);
    assert.equal(photo.churchId, churches[0].id);
    assert.equal(photo.version, position === 1 ? 'b4000000-0000-4000-8000-000000000001' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(photo.position, position);
    assert.equal(photo.isMain, position === 1 ? 1 : 0, 'Church main selection must persist');
    assert.deepEqual(Buffer.from(photo.data), images[position], 'Church photo bytes must persist');
  }
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
} finally {
  db.close();
}
const base = 'http://127.0.0.1:80/api/';
const options = () => ({ headers: { cookie: 'travel_session=smoke-owner-session' }, signal: AbortSignal.timeout(5000) });
async function verifyImage(path, version, expected) {
  const endpoint = base + path;
  const response = await fetch(endpoint + '?v=' + version, options());
  assert.equal(response.status, 200, endpoint);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected);
  const missingVersion = await fetch(endpoint + '?v=44444444-4444-4444-8444-444444444444', options());
  assert.equal(missingVersion.status, 404, 'Unknown versions must not return the current image');
}
await verifyImage('destination-images/' + destinationId, imageVersion, images[0]);
for (const [index, expected] of images.entries()) {
  const photoId = `a2000000-0000-4000-8000-00000000000${index + 1}`;
  await verifyImage('destination-images/' + destinationId + '/' + photoId, index === 0 ? imageVersion : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expected);
  assert.equal((await fetch(base + 'destination-images/11111111-1111-4111-8111-111111111111/' + photoId, options())).status, 404, 'Destination photo ownership must be enforced');
}
for (const [index, candidate] of candidates.entries()) {
  const legacyRoute = await fetch(base + 'candidate-images/' + candidate.id + '?v=' + candidate.version, options());
  assert.equal(legacyRoute.status, 404, 'The removed single-image idea route must not serve photos');
  for (const [position, expected] of images.entries()) {
    const photoId = `90000000-0000-4000-8000-${String(index * 2 + position + 1).padStart(12, '0')}`;
    const version = position === 1 ? candidate.version : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    await verifyImage('candidate-images/' + candidate.id + '/' + photoId, version, expected);
    const otherCandidate = candidates[(index + 1) % candidates.length];
    const wrongOwner = await fetch(base + 'candidate-images/' + otherCandidate.id + '/' + photoId + '?v=' + version, options());
    assert.equal(wrongOwner.status, 404, 'A photo must only be served under its own candidate');
  }
  const wrongRoute = await fetch(base + 'destination-images/' + candidate.id + '?v=' + candidate.version, options());
  assert.equal(wrongRoute.status, 404, 'Candidate photos must not be returned by the destination route');
}
for (const [position, expected] of images.entries()) {
  const photoId = `b3000000-0000-4000-8000-${String(position + 1).padStart(12, '0')}`;
  const version = position === 1 ? 'b4000000-0000-4000-8000-000000000001' : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await verifyImage('church-images/' + churches[0].id + '/' + photoId, version, expected);
  const wrongOwner = await fetch(base + 'church-images/' + churches[1].id + '/' + photoId + '?v=' + version, options());
  assert.equal(wrongOwner.status, 404, 'A church photo must only be served under its own church');
  const wrongCandidateRoute = await fetch(base + 'candidate-images/' + churches[0].id + '/' + photoId + '?v=' + version, options());
  assert.equal(wrongCandidateRoute.status, 404, 'Church photos must not be returned by candidate gallery routes');
}
const wrongChurchRoute = await fetch(base + 'church-images/' + candidates[0].id + '/90000000-0000-4000-8000-000000000001?v=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', options());
assert.equal(wrongChurchRoute.status, 404, 'Candidate photos must not be returned by church routes');
const missingChurchPhoto = await fetch(base + 'church-images/' + churches[0].id + '/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
assert.equal(missingChurchPhoto.status, 404);
const missingImage = await fetch(base + 'destination-images/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
assert.equal(missingImage.status, 404);
const missingPhoto = await fetch(base + 'candidate-images/' + candidates[0].id + '/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
assert.equal(missingPhoto.status, 404);
JS

# A live page, static script, and actual Server Action are required for a usable build,
# and only a current session may read or change trips.
docker exec -i "$container" node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const origin = "http://127.0.0.1:80";
const signal = () => AbortSignal.timeout(10000);
const cookie = (token, name = "travel_session") => token === undefined ? {} : { Cookie: `${name}=${token}` };
const owner = cookie("smoke-owner-session");
// The seeded trip is shared with the editor and never with the outsider.
const editor = cookie("smoke-editor-session");
const outsider = cookie("smoke-outsider-session");
const https = { "X-Forwarded-Proto": "https" };
const get = (path, headers = {}) => fetch(origin + path, { headers, redirect: "manual", signal: signal() });
const tokenHash = (token) => createHash("sha256").update(token).digest("hex");

const home = await get("/", owner);
assert.equal(home.status, 200, "The production home page must render");
const html = await home.text();
assert.match(html, /Persistence test/, "The signed-in owner must see saved trips");
assert.match(html, /owner@example\.test/, "The header must show the signed-in account");
const asset = html.match(/(?:src|href)="(\/_next\/static\/[^"]+\.js(?:\?[^"]*)?)"/);
assert.ok(asset, "The home page must reference a JavaScript chunk");
const script = await fetch(origin + asset[1], { signal: signal() });
assert.equal(script.status, 200, "A referenced JavaScript chunk must load");
assert.ok((await script.text()).length > 0, "The chunk must not be empty");
const login = await get("/login");
assert.equal(login.status, 200, "The sign-in page must render for signed-out visitors");
assert.match(await login.text(), /href="\/auth\/google"[^>]*>Sign in with Google/);

const manifest = JSON.parse(readFileSync("/app/.next/server/server-reference-manifest.json", "utf8"));
const actions = Object.fromEntries(Object.entries(manifest.node ?? {}).map(([id, entry]) => [entry.exportedName, id]));
assert.deepEqual(Object.keys(actions).sort(), ["mutatePlanner", "signOutOfTravel"], "Only the planner and sign-out Server Actions may be exposed");
async function action(name, args, headers) {
  const response = await fetch(origin + "/", {
    method: "POST",
    redirect: "manual",
    headers: { "Next-Action": actions[name], "Accept": "text/x-component", "Content-Type": "text/plain;charset=UTF-8", "Origin": origin, ...headers },
    body: JSON.stringify(args),
    signal: signal(),
  });
  assert.equal(response.status, 200, "Server Action HTTP error");
  return response;
}
async function mutation(input, headers = owner) {
  const body = await (await action("mutatePlanner", [input], headers)).text();
  const results = body.split("\n").flatMap((line) => {
    const separator = line.indexOf(":");
    if (separator < 0) return [];
    try {
      const value = JSON.parse(line.slice(separator + 1));
      return value && typeof value.ok === "boolean" ? [value] : [];
    } catch { return []; }
  });
  assert.equal(results.length, 1, "Server Action must return one parseable operation result");
  return results[0];
}
// The seeded trip's pages, and its destination's pages in Destinations.
const tripPages = ["/trips/container-smoke", "/trips/container-smoke/destinations/22222222-2222-4222-8222-222222222222/hotels"];
const destinationPages = ["/destinations/22222222-2222-4222-8222-222222222222", "/destinations/22222222-2222-4222-8222-222222222222/hotels"];
const pages = ["/", "/destinations", ...tripPages, ...destinationPages, "/whats-new"];
const dataRoutes = ["/api/destination-images/22222222-2222-4222-8222-222222222222?v=33333333-3333-4333-8333-333333333333",
  "/api/destination-images/22222222-2222-4222-8222-222222222222/a2000000-0000-4000-8000-000000000001?v=33333333-3333-4333-8333-333333333333",
  "/api/candidate-images/66666666-6666-4666-8666-666666666666/90000000-0000-4000-8000-000000000002?v=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "/api/church-images/b1000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000002?v=b4000000-0000-4000-8000-000000000001",
  "/api/locations?q=Vienna"];
async function assertRefused(label, headers) {
  for (const path of pages) {
    const response = await get(path, headers);
    const body = await response.text();
    // Without a cookie the proxy redirects; with one it can't judge, the page itself redirects.
    if (response.status === 307) assert.equal(new URL(response.headers.get("location"), origin).pathname, "/login", `${label} ${path}`);
    else assert.ok(body.includes("NEXT_REDIRECT;replace;/login;307;"), `${label} ${path} must redirect to sign in`);
    assert.ok(!body.includes("Persistence test") && !body.includes("Vienna"), `${label} ${path} must not include trip data`);
  }
  for (const path of dataRoutes) {
    const response = await get(path, headers);
    assert.equal(response.status, 401, `${label} ${path} must be refused`);
    assert.ok(!response.headers.get("content-type")?.startsWith("image/"), `${label} ${path} must not return image bytes`);
  }
  const feedback = await fetch(origin + "/api/feedback", { method: "POST", headers: { ...headers, "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ action: "open" }), signal: signal() });
  assert.equal(feedback.status, 401, `${label} feedback must be refused`);
}
// Signed in, but the trip isn't theirs: it and its destination are missing from their lists, their pages are not
// found, and their photos aren't served.
async function assertHidden(label, headers) {
  const list = await get("/", headers);
  assert.equal(list.status, 200, `${label} home page`);
  assert.ok(!(await list.text()).includes("Persistence test"), `${label} must not see the trip in their list`);
  const destinations = await get("/destinations", headers);
  assert.equal(destinations.status, 200, `${label} Destinations`);
  assert.ok(!(await destinations.text()).includes("Vienna"), `${label} must not see the destination in Destinations`);
  for (const path of [...tripPages, ...destinationPages]) {
    const body = await (await get(path, headers)).text();
    assert.ok(body.includes("This page has moved on."), `${label} ${path} must be not found`);
    assert.ok(!body.includes("Persistence test") && !body.includes("Vienna"), `${label} ${path} must not include trip data`);
  }
  for (const path of dataRoutes.slice(0, 4)) {
    const response = await get(path, headers);
    assert.equal(response.status, 404, `${label} ${path} must not be served`);
    assert.ok(!response.headers.get("content-type")?.startsWith("image/"), `${label} ${path} must not return image bytes`);
  }
}

const db = new DatabaseSync("/data/travel.sqlite", { readOnly: true });
try {
  const trip = { type: "trip.save", name: "Container action smoke", startDate: null, dateLabel: "", homeCity: "Test", returnCity: null, travelers: 2, notes: "" };
  // A new trip carries the ID its editor gives it.
  const newTrip = { ...trip, id: "d1000000-0000-4000-8000-000000000001", create: true };
  // Signed out, an expired, unknown or malformed session, or a cookie read over the wrong protocol.
  const rejected = { none: undefined, expired: "smoke-expired-session", unknown: "smoke-unknown-session", malformed: "x", wrongName: "smoke-owner-session" };
  for (const [label, token] of Object.entries(rejected)) {
    const headers = label === "wrongName" ? cookie(token, "__Host-travel_session") : cookie(token);
    await assertRefused(label, headers);
    assert.deepEqual(await mutation(newTrip, headers), { ok: false, error: "Your session has ended. Sign in again in another tab, then save again." }, `${label} must not save`);
    assert.equal(db.prepare("SELECT count(*) AS count FROM trips WHERE name = ?").get(trip.name).count, 0, `${label} must not create a trip`);
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE tokenHash = ?").get(tokenHash("smoke-expired-session")).count, 0, "An expired session is removed when presented");

  // The owner's trip pages offer Share and Delete. Someone it is shared with opens the same trip, its
  // ideas and its photos, without either; someone it isn't shared with finds nothing.
  const ownerPage = await (await get(tripPages[0], owner)).text();
  assert.ok(ownerPage.includes(">Share<") && ownerPage.includes('aria-label="Delete trip"'), "The owner can share and delete the trip");
  assert.ok(ownerPage.includes(">Health and safety<"), "Each destination on the trip page has Health and safety");
  assert.ok((await (await get(destinationPages[0], owner)).text()).includes(">Health and safety<"), "A destination's page has Health and safety");
  assert.match(await (await get("/destinations", owner)).text(), /Vienna/, "The owner's destination appears in Destinations");
  const editorList = await (await get("/", editor)).text();
  assert.match(editorList, /Persistence test/, "A shared trip appears in its recipient's list");
  assert.match(editorList, /Shared by Smoke Owner/);
  const editorDestinations = await (await get("/destinations", editor)).text();
  assert.match(editorDestinations, /Vienna/, "A shared trip's destination appears in its recipient's Destinations");
  assert.match(editorDestinations, /Shared by Smoke Owner/);
  for (const path of [...tripPages, ...destinationPages]) {
    const response = await get(path, editor);
    assert.equal(response.status, 200, `editor ${path}`);
    const body = await response.text();
    assert.match(body, /Persistence test/, `The editor can open ${path}`);
    assert.ok(!body.includes(">Share<") && !body.includes('aria-label="Delete trip"'), `The editor can't share or delete from ${path}`);
  }
  for (const path of dataRoutes.slice(0, 4)) assert.equal((await get(path, editor)).status, 200, `The editor can load ${path}`);
  await assertHidden("outsider", outsider);

  const saved = await mutation(newTrip);
  assert.deepEqual(saved, { ok: true, id: newTrip.id }, "Server Action returned a save error");
  assert.equal(db.prepare("SELECT name FROM trips WHERE id = ?").get(saved.id)?.name, "Container action smoke");
  // Saving it again, as after a lost response, saves the same trip instead of adding another.
  assert.deepEqual(await mutation(newTrip), saved);
  assert.equal(db.prepare("SELECT count(*) AS count FROM trips WHERE name = ?").get(trip.name).count, 1, "A new trip saved again is one trip");

  // Sharing through the real Server Action: only the owner may share, delete or remove access, and removing access ends it at once.
  const notAvailable = { ok: false, error: "This item no longer exists or isn't shared with you. Please refresh and try again." };
  const edit = (notes) => ({ ...trip, id: saved.id, notes });
  const notes = () => db.prepare("SELECT notes FROM trips WHERE id = ?").get(saved.id).notes;
  assert.deepEqual(await mutation(edit("Editor, too soon"), editor), notAvailable, "Nobody else can change a trip before it is shared");
  assert.deepEqual(await mutation({ type: "trip.share", tripId: saved.id, email: " Editor@Example.test " }), { ok: true, id: saved.id });
  assert.deepEqual(await mutation({ type: "trip.share", tripId: saved.id, email: "editor@example.test" }), { ok: false, error: "This trip is already shared with editor@example.test." });
  // Someone who has never signed in is authorized by the share alone; nothing is sent to them.
  assert.deepEqual(await mutation({ type: "trip.share", tripId: saved.id, email: "first-timer@example.test" }), { ok: true, id: saved.id });
  assert.deepEqual({ ...db.prepare("SELECT email, googleSubject FROM accounts WHERE email = 'first-timer@example.test'").get() }, { email: "first-timer@example.test", googleSubject: null });
  assert.deepEqual(await mutation(edit("Edited by the editor"), editor), { ok: true, id: saved.id });
  assert.equal(notes(), "Edited by the editor");
  assert.match(await (await get("/trips/" + saved.id, owner)).text(), /Edited by the editor/, "The owner sees the editor's change");
  assert.deepEqual(await mutation({ type: "trip.delete", id: saved.id }, editor), { ok: false, error: "Only the trip's owner can delete it." });
  assert.deepEqual(await mutation({ type: "trip.share", tripId: saved.id, email: "outsider@example.test" }, editor), { ok: false, error: "Only the trip's owner can share it." });
  assert.deepEqual(await mutation({ type: "trip.unshare", tripId: saved.id, email: "first-timer@example.test" }, editor), { ok: false, error: "Only the trip's owner can remove someone's access." });
  assert.deepEqual(await mutation(edit("Outsider"), outsider), notAvailable);
  // A destination is shared by every trip that visits it: someone a visiting trip is shared with may change it, nobody else.
  const destinationEdit = (destinationNotes) => ({ type: "destination.save", id: "22222222-2222-4222-8222-222222222222", notes: destinationNotes });
  assert.deepEqual(await mutation(destinationEdit("Outsider"), outsider), notAvailable);
  assert.deepEqual(await mutation(destinationEdit("Edited from Destinations"), editor), { ok: true, id: "22222222-2222-4222-8222-222222222222" });
  assert.equal(db.prepare("SELECT notes FROM destinations WHERE id = ?").get("22222222-2222-4222-8222-222222222222").notes, "Edited from Destinations");
  // Its health and safety research has the same access, through the same action.
  const healthSafety = { advisoryLevel: "Level 2", advisoryWarnings: "", healthPrecautions: "", localSafety: "Edited from a shared trip", emergencyContacts: [{ id: "f1000000-0000-4000-8000-000000000002", name: "Embassy", phone: "+1 202 555 0100", notes: "" }], sources: [], lastCheckedDate: null };
  const healthSafetyEdit = { type: "destination.healthSafety", id: "22222222-2222-4222-8222-222222222222", healthSafety };
  assert.deepEqual(await mutation(healthSafetyEdit, outsider), notAvailable);
  assert.deepEqual(await mutation(healthSafetyEdit, editor), { ok: true, id: "22222222-2222-4222-8222-222222222222" });
  assert.deepEqual(JSON.parse(db.prepare("SELECT healthSafetyJson FROM destination_health_safety WHERE destinationId = ?").get("22222222-2222-4222-8222-222222222222").healthSafetyJson), healthSafety);
  // A destination created outside a trip is its creator's: choosing a city never opens someone else's. Only the owner
  // deletes a destination, and only one no trip visits; its page offers Delete only then.
  const vienna = "22222222-2222-4222-8222-222222222222";
  assert.deepEqual(await mutation({ type: "destination.create", city: " vienna " }), { ok: true, id: vienna }, "The owner's saved city opens their destination");
  const outsiderVienna = await mutation({ type: "destination.create", city: "Vienna" }, outsider);
  assert.ok(outsiderVienna.ok && outsiderVienna.id !== vienna, "Another account's same city is a destination of its own");
  assert.deepEqual(await mutation({ type: "destination.delete", id: vienna }, outsider), notAvailable);
  assert.deepEqual(await mutation({ type: "destination.delete", id: vienna }, editor), { ok: false, error: "Only the destination's owner can delete it." });
  assert.deepEqual(await mutation({ type: "destination.delete", id: vienna }), { ok: false, error: "“Vienna” is in a trip, so it can't be deleted. Remove it from every trip that visits it first." });
  assert.ok(!(await (await get(destinationPages[0], owner)).text()).includes('aria-label="Delete destination"'), "A destination in a trip offers no Delete");
  assert.ok((await (await get("/destinations/" + outsiderVienna.id, outsider)).text()).includes('aria-label="Delete destination"'), "Its owner can delete a destination in no trip");
  assert.deepEqual(await mutation({ type: "destination.delete", id: outsiderVienna.id }, outsider), { ok: true });
  assert.deepEqual(db.prepare("SELECT id FROM destinations WHERE city = 'Vienna'").all().map((row) => row.id), [vienna], "Only the outsider's own destination was deleted");
  // Adding a city to a trip visits its owner's destination for it, whoever on the trip adds it, and a city the trip
  // already visits opens that stop. Someone the trip isn't shared with can't add one.
  const addStop = (city) => ({ type: "stop.add", tripId: saved.id, city });
  assert.deepEqual(await mutation(addStop("Vienna"), outsider), notAvailable);
  const viennaStop = await mutation(addStop(" VIENNA "), editor);
  assert.ok(viennaStop.ok && viennaStop.id !== vienna, "The editor adds the owner's Vienna as a new stop");
  assert.deepEqual({ ...db.prepare("SELECT tripId, destinationId, nights FROM trip_stops WHERE id = ?").get(viennaStop.id) }, { tripId: saved.id, destinationId: vienna, nights: null });
  assert.deepEqual(await mutation(addStop("Vienna")), viennaStop, "A city the trip visits opens its stop");
  assert.deepEqual(db.prepare("SELECT id FROM destinations WHERE city = 'Vienna'").all().map((row) => row.id), [vienna], "Adding a city copies no destination");
  assert.match(await (await get("/trips/" + saved.id, editor)).text(), /Edited from Destinations/, "The trip shows its new stop with the destination's saved notes");
  assert.deepEqual(await mutation({ type: "trip.unshare", tripId: saved.id, email: "editor@example.test" }), { ok: true, id: saved.id });
  assert.deepEqual(await mutation(edit("Editor, after removal"), editor), notAvailable, "Removing access ends it at once");
  const revoked = await (await get("/trips/" + saved.id, editor)).text();
  assert.ok(revoked.includes("This page has moved on.") && !revoked.includes("Edited by the editor"), "A removed editor's saved URL no longer opens the trip");
  assert.equal(notes(), "Edited by the editor", "Removing access keeps the trip as it was");
  assert.equal((await mutation({ type: "trip.delete", id: saved.id })).ok, true, "Server Action returned a delete error");
  assert.equal(db.prepare("SELECT id FROM trips WHERE id = ?").get(saved.id), undefined, "Temporary trip must be removed");

  // Over HTTPS the session cookie is __Host- prefixed, HttpOnly, Secure and Lax, and each visit renews it for thirty days.
  const renewed = (await get("/", { ...https, ...cookie("smoke-owner-session", "__Host-travel_session") })).headers.getSetCookie();
  const sessionCookie = renewed.find((value) => value.startsWith("__Host-travel_session=smoke-owner-session;"));
  assert.ok(sessionCookie, "Visiting must renew the session cookie");
  const flags = (value) => value.split("; ").slice(1).map((flag) => flag.toLowerCase());
  for (const flag of ["path=/", "max-age=2592000", "httponly", "secure", "samesite=lax"]) assert.ok(flags(sessionCookie).includes(flag), "Session cookie needs " + flag);

  // Sign in with Google starts at Google with PKCE and a ten-minute flow cookie of its own.
  const start = await get("/auth/google", https);
  assert.equal(start.status, 307);
  const google = new URL(start.headers.get("location"));
  assert.equal(google.origin + google.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(google.searchParams.get("client_id"), "smoke-test-client");
  assert.match(google.searchParams.get("redirect_uri"), /^https:\/\/[^/]+\/auth\/google\/callback$/);
  assert.equal(google.searchParams.get("code_challenge_method"), "S256");
  assert.equal(google.searchParams.get("prompt"), "select_account");
  const flowCookie = start.headers.getSetCookie().find((value) => value.startsWith("__Host-travel_google="));
  assert.ok(flowCookie, "The trip to Google needs its cookie");
  for (const flag of ["path=/", "max-age=600", "httponly", "secure", "samesite=lax"]) assert.ok(flags(flowCookie).includes(flag), "Google cookie needs " + flag);
  const flow = { ...https, Cookie: flowCookie.split(";")[0] };
  const sessionsBefore = db.prepare("SELECT count(*) AS count FROM sessions").get().count;
  // A callback that didn't start in this browser, or was canceled at Google, signs nobody in.
  for (const [query, location] of [["state=forged&code=forged", "/login?error=expired"], [`state=${google.searchParams.get("state")}&error=access_denied`, "/login"]]) {
    const callback = await get("/auth/google/callback?" + query, flow);
    assert.equal(callback.status, 307);
    assert.equal(new URL(callback.headers.get("location"), origin).pathname + new URL(callback.headers.get("location"), origin).search, location);
    assert.ok(!callback.headers.getSetCookie().some((value) => value.includes("travel_session=")), "A failed sign-in must not set a session");
    assert.ok(callback.headers.getSetCookie().some((value) => value.startsWith("__Host-travel_google=;") && flags(value).includes("max-age=0")), "The Google cookie is good for one trip");
  }
  assert.equal(db.prepare("SELECT count(*) AS count FROM sessions").get().count, sessionsBefore, "A failed sign-in must not create a session");

  // Sign out ends the session on the server, not only in this browser.
  const signOut = await action("signOutOfTravel", [], owner);
  assert.match(signOut.headers.get("x-action-redirect") ?? "", /^\/login;/);
  assert.ok(signOut.headers.getSetCookie().some((value) => value.startsWith("travel_session=;") && flags(value).includes("max-age=0")), "Sign out must clear the session cookie");
  assert.equal(db.prepare("SELECT count(*) AS count FROM sessions WHERE tokenHash = ?").get(tokenHash("smoke-owner-session")).count, 0, "Sign out must delete the session");
  await assertRefused("signedOut", owner);
} finally {
  db.close();
}
JS

# The unused Next optimizer must not retrieve or cache an existing saved photo.
optimizer_status="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3007/_next/image?url=%2Fapi%2Fdestination-images%2F22222222-2222-4222-8222-222222222222%3Fv%3D33333333-3333-4333-8333-333333333333&w=256&q=75')"
if [ "$optimizer_status" != "404" ]; then
  echo "The unused Next.js image optimizer returned HTTP $optimizer_status, expected 404." >&2
  exit 1
fi

# A container without the persistent mount, or without the sign-in settings, must refuse to start.
refuses() {
  local expected="$1"; shift
  set +e
  timeout 10s docker run --rm --name travel-check-refusal "$@" "$image" > startup-guard.log 2>&1
  local status=$?
  set -e
  if [ "$status" -ne 1 ] || ! grep -q "$expected" startup-guard.log; then
    cat startup-guard.log >&2
    echo "The app did not correctly refuse startup: expected \"$expected\"." >&2
    exit 1
  fi
}
refuses "Persistent travel storage is not ready"
refuses "Sign in with Google can't work without GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET" -v "$volume:/data"
refuses "TRAVEL_OWNER_EMAIL must be" -v "$volume:/data" -e GOOGLE_CLIENT_ID=smoke-test-client -e GOOGLE_CLIENT_SECRET=smoke-test-secret -e TRAVEL_OWNER_EMAIL=not-an-email
