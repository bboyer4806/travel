import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "travel-backup-test-"));
  const source = join(directory, "source.sqlite");
  const db = new DatabaseSync(source);
  db.exec("PRAGMA journal_mode = WAL; CREATE TABLE notes(value TEXT); INSERT INTO notes VALUES('saved idea');");
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

test("online backup preserves live WAL data and cleans temporary SQLite sidecars", (t) => {
  const { directory, backup } = fixture(t);
  const target = join(directory, "backup.sqlite");
  const result = backup(target);
  assert.equal(result.status, 0, result.stderr);
  const snapshot = new DatabaseSync(target, { readOnly: true });
  try {
    assert.equal(snapshot.prepare("SELECT value FROM notes").get().value, "saved idea");
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
