#!/usr/bin/env bash
set -euo pipefail

# Used only on an ephemeral GitHub Actions runner, with a dedicated test volume.
image="travel-check"
container="travel-check"
volume="travel-check-storage"
cleanup() {
  if [ "$?" -ne 0 ]; then docker logs "$container" || true; fi
  docker rm -f "$container" travel-check-refusal >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# Test-only sign-in settings. The HTTPS AUTH_URL gives the production cookie names and flags; Google is never called.
random_secret() { node -e 'process.stdout.write(require("node:crypto").randomBytes(33).toString("base64"))'; }
auth_secret="$(random_secret)"
auth_env=(-e "AUTH_SECRET=$auth_secret" -e AUTH_GOOGLE_ID=smoke-test-client -e AUTH_GOOGLE_SECRET=smoke-test-secret -e TRAVEL_OWNER_EMAIL=owner@example.test)
# Mint session cookies with Auth.js itself (from the installed dependencies), as a completed Google sign-in would.
session() {
  AUTH_SECRET="${3:-$auth_secret}" node --input-type=module -e '
    import { encode } from "next-auth/jwt";
    const [subject, maxAge] = process.argv.slice(1);
    process.stdout.write(await encode({ token: { sub: subject, name: "Smoke Owner" }, secret: process.env.AUTH_SECRET, salt: "__Secure-authjs.session-token", maxAge: Number(maxAge) }));
  ' "$1" "$2"
}
owner_session="$(session smoke-owner-subject 3600)"
sessions=(-e "OWNER_SESSION=$owner_session" -e "EXPIRED_SESSION=$(session smoke-owner-subject -120)"
  -e "UNKNOWN_SESSION=$(session smoke-unknown-subject 3600)" -e "FOREIGN_SESSION=$(session smoke-owner-subject 3600 "$(random_secret)")")

docker build -t "$image" .
docker volume create "$volume" >/dev/null
docker run --rm --user 0 --entrypoint sh -v "$volume:/data" "$image" -c 'touch /data/.travel-persistent-storage && chown -R 1001:1001 /data'

start() {
  docker run -d --name "$container" -p 127.0.0.1:3007:80 -v "$volume:/data" "${auth_env[@]}" -e AUTH_URL=https://travel.example.test "$image" >/dev/null
  curl --fail --silent --show-error --connect-timeout 2 --max-time 5 --retry-max-time 45 --retry 20 --retry-delay 1 --retry-connrefused --retry-all-errors http://127.0.0.1:3007/api/health
}

start
docker exec -i "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';
// Image uploads and Server Actions must be able to load the packaged native runtime.
const processed = await sharp({ create: { width: 2, height: 2, channels: 3, background: 'red' } }).webp().toBuffer();
assert.ok(processed.length > 0);
const db = new DatabaseSync('/data/travel.sqlite');
const destinationId = '22222222-2222-4222-8222-222222222222';
const imageVersion = '33333333-3333-4333-8333-333333333333';
const requirements = { passportNationality: 'United States', travelPurpose: 'Tourism', travelerCircumstances: 'Whole party', visaRequirements: 'Review authorization rules', passportValidity: 'Review passport rules', requiredDocuments: 'Review health and entry documents', transitRequirements: 'Review transit rules separately', notes: 'Manually maintained', sources: [{ id: 'c1000000-0000-4000-8000-000000000001', url: 'https://example.gov/entry', description: 'Official source' }], lastCheckedDate: '2026-11-03' };
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
assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
// TRAVEL_OWNER_EMAIL is authorized at startup, before anyone signs in.
assert.deepEqual(db.prepare('SELECT email, googleSubject FROM accounts').all().map(row => ({...row})), [{ email: 'owner@example.test', googleSubject: null }]);
db.exec('PRAGMA foreign_keys = ON; BEGIN IMMEDIATE;');
// The owner's first Google sign-in binds their stable subject.
db.prepare("UPDATE accounts SET googleSubject = 'smoke-owner-subject' WHERE email = 'owner@example.test'").run();
db.prepare('INSERT INTO trips(id,name,dateLabel,homeCity,travelers,notes,createdAt) VALUES(?,?,?,?,?,?,?)').run('container-smoke','Persistence test','','',2,'',new Date().toISOString());
db.prepare("UPDATE trips SET startDate = '2027-05-10' WHERE id = 'container-smoke'").run();
db.prepare('INSERT INTO home_items(id,tripId,name,priceCents,notes,completed,createdAt) VALUES(?,?,?,?,?,?,?)').run('a1000000-0000-4000-8000-000000000001','container-smoke','House sitting',23950,'Give sitter a key',1,'2026-10-12T12:00:00.000Z');
db.prepare('INSERT INTO home_items(id,tripId,name,priceCents,notes,completed,createdAt) VALUES(?,?,?,?,?,?,?)').run('a1000000-0000-4000-8000-000000000002','container-smoke','Pause mail',null,'Arrange before leaving',0,'2026-10-12T12:01:00.000Z');
db.prepare('INSERT INTO destinations(id,tripId,city,stay,notes,position,arrivalDate,departureDate,miscDailyMinor,miscCurrency,hotelNightlyMinor,hotelCurrency) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(destinationId, 'container-smoke', 'Vienna', 'Spring visit', '', 0, '2027-05-10', '2027-05-13', 3250, 'USD', 17525, 'USD');
db.prepare('UPDATE destinations SET nights = 3 WHERE id = ?').run(destinationId);
db.prepare("UPDATE destinations SET activitiesBudgetMode = 'general', activitiesGeneralMinor = 22550, activitiesCurrency = 'USD' WHERE id = ?").run(destinationId);
db.prepare("UPDATE destinations SET foodBudgetMode = 'daily', foodDailyMinor = 8025, foodCurrency = 'USD' WHERE id = ?").run(destinationId);
db.prepare("UPDATE destinations SET shoppingMinor = 12550, shoppingCurrency = 'USD' WHERE id = ?").run(destinationId);
db.prepare('UPDATE destinations SET weatherHighF=?,weatherLowF=?,weatherRainfall=?,weatherPeriod=?,weatherSource=? WHERE id=?').run(0,-12.5,'Light winter precipitation','January','Historical climate notes',destinationId);
for (const [index, data] of images.entries()) {
  db.prepare('INSERT INTO destination_images(id,destinationId,version,data,position,isMain) VALUES(?,?,?,?,?,?)').run(`a2000000-0000-4000-8000-00000000000${index + 1}`, destinationId, index === 0 ? imageVersion : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', data, 1 - index, index === 0 ? 1 : 0);
}
db.prepare('INSERT INTO destination_entry_requirements(destinationId,requirementsJson) VALUES(?,?)').run(destinationId, JSON.stringify(requirements));
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
docker exec -i "${sessions[@]}" "$container" node --input-type=module <<'JS'
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
const destinationId = '22222222-2222-4222-8222-222222222222';
const imageVersion = '33333333-3333-4333-8333-333333333333';
const requirements = { passportNationality: 'United States', travelPurpose: 'Tourism', travelerCircumstances: 'Whole party', visaRequirements: 'Review authorization rules', passportValidity: 'Review passport rules', requiredDocuments: 'Review health and entry documents', transitRequirements: 'Review transit rules separately', notes: 'Manually maintained', sources: [{ id: 'c1000000-0000-4000-8000-000000000001', url: 'https://example.gov/entry', description: 'Official source' }], lastCheckedDate: '2026-11-03' };
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
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 19);
  assert.deepEqual(db.prepare('SELECT email, googleSubject FROM accounts').all().map(row => ({...row})), [{ email: 'owner@example.test', googleSubject: 'smoke-owner-subject' }], 'Authorization must persist');
  assert.equal(db.prepare('SELECT startDate FROM trips WHERE id = ?').get('container-smoke').startDate, '2027-05-10');
  assert.equal(db.prepare('SELECT nights FROM destinations WHERE id = ?').get(destinationId).nights, 3);
  const homeItems = db.prepare('SELECT name,priceCents,notes,completed,createdAt FROM home_items WHERE tripId = ? ORDER BY createdAt').all('container-smoke').map(row => ({...row}));
  assert.deepEqual(homeItems, [
    {name:'House sitting',priceCents:23950,notes:'Give sitter a key',completed:1,createdAt:'2026-10-12T12:00:00.000Z'},
    {name:'Pause mail',priceCents:null,notes:'Arrange before leaving',completed:0,createdAt:'2026-10-12T12:01:00.000Z'},
  ]);
  assert.deepEqual({ ...db.prepare('SELECT stay,arrivalDate,departureDate,miscDailyMinor,miscCurrency,hotelNightlyMinor,hotelCurrency FROM destinations WHERE id = ?').get(destinationId) }, { stay: 'Spring visit', arrivalDate: '2027-05-10', departureDate: '2027-05-13', miscDailyMinor: 3250, miscCurrency: 'USD', hotelNightlyMinor: 17525, hotelCurrency: 'USD' });
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
const options = () => ({ headers: { cookie: '__Secure-authjs.session-token=' + process.env.OWNER_SESSION }, signal: AbortSignal.timeout(5000) });
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
  await verifyImage('candidate-images/' + candidate.id, candidate.version, images[1]);
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
  const wrongMainRoute = await fetch(base + 'candidate-images/' + churches[0].id + '?v=' + version, options());
  assert.equal(wrongMainRoute.status, 404, 'Church main photos must not be returned by candidate routes');
}
const wrongChurchRoute = await fetch(base + 'church-images/' + candidates[0].id + '/90000000-0000-4000-8000-000000000001?v=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', options());
assert.equal(wrongChurchRoute.status, 404, 'Candidate photos must not be returned by church routes');
const missingChurchPhoto = await fetch(base + 'church-images/' + churches[0].id + '/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
assert.equal(missingChurchPhoto.status, 404);
const wrongRoute = await fetch(base + 'candidate-images/' + destinationId + '?v=' + imageVersion, options());
assert.equal(wrongRoute.status, 404, 'Destination photos must not be returned by the candidate route');
for (const route of ['destination-images', 'candidate-images']) {
  const missingImage = await fetch(base + route + '/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
  assert.equal(missingImage.status, 404);
}
const missingPhoto = await fetch(base + 'candidate-images/' + candidates[0].id + '/55555555-5555-4555-8555-555555555555?v=' + imageVersion, options());
assert.equal(missingPhoto.status, 404);
JS

# A live page, static script, and actual Server Action are required for a usable build,
# and only an authorized session may read or change trips.
docker exec -i "${sessions[@]}" "$container" node --input-type=module <<'JS'
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const origin = "http://127.0.0.1:80";
const signal = () => AbortSignal.timeout(10000);
const cookie = (session) => session === undefined ? {} : { Cookie: "__Secure-authjs.session-token=" + session };
const owner = cookie(process.env.OWNER_SESSION);
const get = (path, headers = {}) => fetch(origin + path, { headers, redirect: "manual", signal: signal() });

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
const signIn = await get("/signin");
assert.equal(signIn.status, 200, "The sign-in page must render for signed-out visitors");
assert.match(await signIn.text(), /Sign in with Google/);

const manifest = JSON.parse(readFileSync("/app/.next/server/server-reference-manifest.json", "utf8"));
const actions = Object.fromEntries(Object.entries(manifest.node ?? {}).map(([id, entry]) => [entry.exportedName, id]));
assert.deepEqual(Object.keys(actions).sort(), ["mutatePlanner", "signInWithGoogle", "signOutOfTravel"], "Only the planner and sign-in Server Actions may be exposed");
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

const db = new DatabaseSync("/data/travel.sqlite", { readOnly: true });
try {
  const trip = { type: "trip.save", name: "Container action smoke", startDate: null, dateLabel: "", homeCity: "Test", returnCity: null, travelers: 2, notes: "" };
  // Missing, expired, unauthorized, forged and tampered sessions are all rejected.
  const parts = process.env.OWNER_SESSION.split(".");
  parts[3] = (parts[3][0] === "A" ? "B" : "A") + parts[3].slice(1);
  const rejected = { none: undefined, expired: process.env.EXPIRED_SESSION, unauthorized: process.env.UNKNOWN_SESSION, otherSecret: process.env.FOREIGN_SESSION, tampered: parts.join("."), malformed: "not-a-session" };
  for (const [label, session] of Object.entries(rejected)) {
    const headers = cookie(session);
    for (const path of ["/", "/trips/container-smoke", "/trips/container-smoke/destinations/22222222-2222-4222-8222-222222222222/hotels", "/whats-new"]) {
      const body = await (await get(path, headers)).text();
      assert.ok(body.includes("NEXT_REDIRECT;replace;/signin?callbackUrl=" + encodeURIComponent(path) + ";"), `${label} ${path} must redirect to sign in`);
      assert.ok(!body.includes("Persistence test") && !body.includes("Vienna"), `${label} ${path} must not include trip data`);
    }
    for (const path of ["/api/destination-images/22222222-2222-4222-8222-222222222222?v=33333333-3333-4333-8333-333333333333",
      "/api/destination-images/22222222-2222-4222-8222-222222222222/a2000000-0000-4000-8000-000000000001?v=33333333-3333-4333-8333-333333333333",
      "/api/candidate-images/66666666-6666-4666-8666-666666666666?v=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "/api/candidate-images/66666666-6666-4666-8666-666666666666/90000000-0000-4000-8000-000000000002?v=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "/api/church-images/b1000000-0000-4000-8000-000000000001/b3000000-0000-4000-8000-000000000002?v=b4000000-0000-4000-8000-000000000001",
      "/api/locations?q=Vienna"]) {
      const response = await get(path, headers);
      assert.equal(response.status, 401, `${label} ${path} must be refused`);
      assert.ok(!response.headers.get("content-type")?.startsWith("image/"), `${label} ${path} must not return image bytes`);
    }
    const feedback = await fetch(origin + "/api/feedback", { method: "POST", headers: { ...headers, "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ action: "open" }), signal: signal() });
    assert.equal(feedback.status, 401, `${label} feedback must be refused`);
    assert.deepEqual(await mutation(trip, headers), { ok: false, error: "Your session has ended. Sign in again in another tab, then save again." }, `${label} must not save`);
    assert.equal(db.prepare("SELECT count(*) AS count FROM trips WHERE name = ?").get(trip.name).count, 0, `${label} must not create a trip`);
  }

  const saved = await mutation(trip);
  assert.equal(saved.ok, true, "Server Action returned a save error");
  assert.match(saved.id, /^[a-f0-9-]{36}$/i);
  assert.equal(db.prepare("SELECT name FROM trips WHERE id = ?").get(saved.id)?.name, "Container action smoke");
  assert.equal((await mutation({ type: "trip.delete", id: saved.id })).ok, true, "Server Action returned a delete error");
  assert.equal(db.prepare("SELECT id FROM trips WHERE id = ?").get(saved.id), undefined, "Temporary trip must be removed");
} finally {
  db.close();
}

// The session cookie is HttpOnly, Secure and SameSite=Lax, and exposes no OAuth tokens.
const session = await get("/api/auth/session", owner);
assert.equal(session.status, 200);
assert.deepEqual(await session.json().then(({ user }) => user), { id: "smoke-owner-subject", name: "Smoke Owner" });
const renewed = session.headers.getSetCookie().find((value) => value.startsWith("__Secure-authjs.session-token="));
assert.ok(renewed, "The session cookie must use the __Secure- prefix");
for (const attribute of ["Path=/", "HttpOnly", "Secure", "SameSite=Lax"]) assert.ok(renewed.split("; ").includes(attribute), "Session cookie needs " + attribute);

// Sign out removes the session cookie and returns to sign in.
const signOut = await action("signOutOfTravel", [], owner);
assert.equal(signOut.headers.get("x-action-redirect"), "https://travel.example.test/signin;push");
assert.ok(signOut.headers.getSetCookie().some((value) => value.startsWith("__Secure-authjs.session-token=;") && value.includes("Max-Age=0")), "Sign out must clear the session cookie");
JS

# The unused Next optimizer must not retrieve or cache an existing saved photo.
optimizer_status="$(curl -sS -o /dev/null -w '%{http_code}' 'http://127.0.0.1:3007/_next/image?url=%2Fapi%2Fdestination-images%2F22222222-2222-4222-8222-222222222222%3Fv%3D33333333-3333-4333-8333-333333333333&w=256&q=75')"
if [ "$optimizer_status" != "404" ]; then
  echo "The unused Next.js image optimizer returned HTTP $optimizer_status, expected 404." >&2
  exit 1
fi

# A container without the persistent mount, or without complete HTTPS sign-in settings, must refuse to start.
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
refuses "Missing sign-in settings: AUTH_SECRET, AUTH_URL, AUTH_GOOGLE_ID, AUTH_GOOGLE_SECRET, TRAVEL_OWNER_EMAIL" -v "$volume:/data"
refuses "AUTH_URL must be the public HTTPS address" -v "$volume:/data" "${auth_env[@]}" -e AUTH_URL=http://travel.example.test
