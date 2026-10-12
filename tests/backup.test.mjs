import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

const imageBytes = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAfQtSZVrP+BiOh/AAA=', 'base64');
const alternateBytes = Buffer.from('UklGRh4AAABXRUJQVlA4TBEAAAAvAUAAAAdQwjaXpf+BiOh/AAA=', 'base64');
const imageVersion = "33333333-3333-4333-8333-333333333333";
const candidates = [
  { id: "66666666-6666-4666-8666-666666666666", category: "hotels", version: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
  { id: "77777777-7777-4777-8777-777777777777", category: "activities", version: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
  { id: "88888888-8888-4888-8888-888888888888", category: "restaurants", version: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
].map((candidate, index) => ({
  ...candidate,
  photos: [imageBytes, alternateBytes].map((data, position) => ({
    id: `90000000-0000-4000-8000-${String(index * 2 + position + 1).padStart(12, "0")}`,
    version: position === 1 ? candidate.version : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    data, position, isMain: position === 1 ? 1 : 0,
  })),
}));

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "travel-backup-test-"));
  const source = join(directory, "source.sqlite");
  const db = new DatabaseSync(source);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA user_version = 7;
    CREATE TABLE trips(id TEXT PRIMARY KEY) STRICT;
    INSERT INTO trips VALUES('trip-with-home-items');
    CREATE TABLE home_items(id TEXT PRIMARY KEY, tripId TEXT NOT NULL REFERENCES trips(id) ON DELETE CASCADE, name TEXT NOT NULL, priceCents INTEGER, notes TEXT NOT NULL, completed INTEGER NOT NULL, createdAt TEXT NOT NULL) STRICT;
    INSERT INTO home_items VALUES('paid-item','trip-with-home-items','House sitting',23950,'Give sitter a key',1,'2026-10-12T12:00:00.000Z');
    INSERT INTO home_items VALUES('free-item','trip-with-home-items','Pause mail',NULL,'Arrange before leaving',0,'2026-10-12T12:01:00.000Z');
    CREATE TABLE notes(value TEXT);
    INSERT INTO notes VALUES('saved idea');
    CREATE TABLE destination_images(destinationId TEXT PRIMARY KEY, version TEXT NOT NULL, data BLOB NOT NULL) STRICT;
    CREATE TABLE candidates(id TEXT PRIMARY KEY, category TEXT NOT NULL) STRICT;
    CREATE TABLE candidate_images(
      id TEXT PRIMARY KEY,
      candidateId TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      version TEXT NOT NULL,
      data BLOB NOT NULL,
      position INTEGER NOT NULL CHECK(position >= 0),
      isMain INTEGER NOT NULL CHECK(isMain IN (0,1))
    ) STRICT;
    CREATE UNIQUE INDEX candidate_images_main ON candidate_images(candidateId) WHERE isMain = 1;
  `);
  db.prepare("INSERT INTO destination_images(destinationId,version,data) VALUES(?,?,?)").run("22222222-2222-4222-8222-222222222222", imageVersion, imageBytes);
  for (const candidate of candidates) {
    db.prepare("INSERT INTO candidates(id,category) VALUES(?,?)").run(candidate.id, candidate.category);
    for (const photo of candidate.photos) {
      db.prepare("INSERT INTO candidate_images(id,candidateId,version,data,position,isMain) VALUES(?,?,?,?,?,?)")
        .run(photo.id, candidate.id, photo.version, photo.data, photo.position, photo.isMain);
    }
  }
  t.after(() => {
    db.close();
    const target = resolve(directory);
    assert.ok(target.startsWith(resolve(tmpdir()) + sep) && basename(target).startsWith("travel-backup-test-"));
    rmSync(target, { recursive: true, force: true });
  });
  const backup = (destination, sourceOverride = source) => spawnSync(process.execPath, ["scripts/backup.mjs", destination], {
    cwd: process.cwd(), env: { ...process.env, TRAVEL_DATABASE_PATH: sourceOverride }, encoding: "utf8",
  });
  return { directory, source, backup };
}

test("online backup preserves WAL data, destination photos, complete galleries, and at-home tasks", (t) => {
  const { directory, backup } = fixture(t);
  const target = join(directory, "backup.sqlite");
  const result = backup(target);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(snapshot.prepare("SELECT value FROM notes").get().value, "saved idea");
    assert.equal(snapshot.prepare("PRAGMA user_version").get().user_version, 7);
    const homeItems = snapshot.prepare("SELECT id,name,priceCents,notes,completed,createdAt FROM home_items ORDER BY id").all().map(row => ({...row}));
    assert.deepEqual(homeItems, [
      {id:'free-item',name:'Pause mail',priceCents:null,notes:'Arrange before leaving',completed:0,createdAt:'2026-10-12T12:01:00.000Z'},
      {id:'paid-item',name:'House sitting',priceCents:23950,notes:'Give sitter a key',completed:1,createdAt:'2026-10-12T12:00:00.000Z'},
    ]);
    const image = snapshot.prepare("SELECT version, data FROM destination_images WHERE destinationId = ?").get("22222222-2222-4222-8222-222222222222");
    assert.equal(image.version, imageVersion);
    assert.deepEqual(Buffer.from(image.data), imageBytes);
    assert.equal(snapshot.prepare("SELECT count(*) AS count FROM candidate_images").get().count, candidates.length * 2);
    for (const candidate of candidates) {
      const saved = snapshot.prepare("SELECT category FROM candidates WHERE id = ?").get(candidate.id);
      assert.equal(saved?.category, candidate.category);
      const savedImages = snapshot.prepare("SELECT id,version,data,position,isMain FROM candidate_images WHERE candidateId = ? ORDER BY position").all(candidate.id);
      assert.equal(savedImages.length, 2, candidate.category + " must retain both photos");
      for (const [index, savedImage] of savedImages.entries()) {
        const expected = candidate.photos[index];
        assert.equal(savedImage.id, expected.id);
        assert.equal(savedImage.version, expected.version);
        assert.equal(savedImage.position, expected.position);
        assert.equal(savedImage.isMain, expected.isMain);
        assert.deepEqual(Buffer.from(savedImage.data), expected.data, candidate.category + " photo bytes must be backed up");
      }
    }
    assert.deepEqual(snapshot.prepare("PRAGMA foreign_key_check").all(), []);
    assert.equal(snapshot.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  } finally { snapshot.close(); }
  assert.deepEqual(readdirSync(directory).filter((name) => name.startsWith(".travel-backup-")), []);
});

test("backup refuses overwrite, source replacement, and nonexistent source", (t) => {
  const { directory, source, backup } = fixture(t);
  const target = join(directory, "backup.sqlite");
  assert.equal(backup(target).status, 0);
  assert.notEqual(backup(target).status, 0);
  assert.notEqual(backup(source).status, 0);
  const missing = join(directory, "missing.sqlite");
  assert.notEqual(backup(join(directory, "empty.sqlite"), missing).status, 0);
  assert.equal(existsSync(missing), false);
  assert.deepEqual(readdirSync(directory).filter((name) => name.startsWith(".travel-backup-")), []);
});
