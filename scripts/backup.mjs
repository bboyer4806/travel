import {
  constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

if (process.argv.length !== 3) {
  console.error("Usage: node scripts/backup.mjs <new-backup-file.sqlite>");
  process.exitCode = 1;
} else {
  // Back up the database the app uses. As in Next.js, a variable already set in the
  // environment wins over .env.local, which wins over .env; loading never overrides.
  for (const file of [".env.local", ".env"]) if (existsSync(file)) process.loadEnvFile(file);
  const source = resolve(process.env.TRAVEL_DATABASE_PATH || "data/travel.sqlite");
  const destination = resolve(process.argv[2]);
  if (source === destination) {
    throw new Error("The backup destination must differ from the live database.");
  }

  // readOnly refuses to create a new, empty source if the path is wrong.
  const database = new DatabaseSync(source, { readOnly: true, timeout: 5000 });
  let temporaryDirectory;
  try {
    mkdirSync(dirname(destination), { recursive: true });
    temporaryDirectory = mkdtempSync(join(dirname(destination), ".travel-backup-"));
    const temporaryFile = join(temporaryDirectory, "snapshot.sqlite");
    await backup(database, temporaryFile);

    const snapshot = new DatabaseSync(temporaryFile, { readOnly: true });
    try {
      const result = snapshot.prepare("PRAGMA integrity_check").all();
      if (result.length !== 1 || result[0].integrity_check !== "ok") {
        throw new Error("Backup integrity check failed; no backup was published.");
      }
    } finally {
      snapshot.close();
    }

    // Refuse to overwrite an earlier backup, including with concurrent runs.
    copyFileSync(temporaryFile, destination, constants.COPYFILE_EXCL);
    console.log(`Backup saved: ${destination}`);
  } finally {
    database.close();
    // Remove the snapshot and whatever SQLite left beside it: the -wal and -shm of its check, or the
    // rollback journal a failed write leaves (a full disk, for one), so SQLite's error is what's reported.
    if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}
