# Deploying Travel

The app uses Node 24, Next.js standalone output, and SQLite. One app instance serves a shared database. Anyone with the URL can view and edit data; no accounts in this version.

## One-time persistent storage setup

An administrator must run these commands on the Dokku host before deploying. The scoped GitHub deployment key cannot provision storage, so the deployment workflow deliberately does not attempt it.

```sh
sudo install -d -o 1001 -g 1001 -m 750 /var/lib/dokku/data/storage/travel
sudo install -o 1001 -g 1001 -m 640 /dev/null /var/lib/dokku/data/storage/travel/.travel-persistent-storage
sudo dokku storage:mount travel /var/lib/dokku/data/storage/travel:/data
sudo dokku storage:report travel
```

The existing travel app must exist before mounting (it already serves the placeholder). Verify the report contains the /data bind mount. The container runs as uid/gid 1001. The database path is /data/travel.sqlite.

The startup script requires the marker and writable storage. Without them startup fails, keeping a misconfigured deployment from silently writing disposable data. Do not bake the marker or a database into the image.

## Deployment and checks

- GitHub Actions checks lint, TypeScript, tests, and a production build.
- Main pushes run these checks before building/pushing the image and deploying through the existing workflow.
- Retain the existing DOKKU_SSH_KEY and DOKKU_HOST secrets.
- The image still exposes port 80, preserving the existing domain/proxy setup.
- Keep one web instance: shared SQLite on one server is the v1 deployment model.
- Confirm /api/health returns HTTP 200. Create a temporary trip, restart the app, and verify the trip remains before considering persistence verified.

The Docker image must be tested on a Docker-capable machine or CI; a local Next build alone does not prove the container or host mount works.

## Backup

The image contains the online SQLite backup helper. From the host:

```sh
sudo dokku run travel node scripts/backup.mjs /data/travel-backup-2026-10-07.sqlite
```

Use a unique filename every time. The helper refuses overwrite, reads the configured source without creating an empty database, and validates the snapshot.
Copy successful backups to separate storage; backups on the same disk are insufficient for disk loss.

## Restore

1. Stop the travel app to prevent new writes.
2. Preserve the current database and its SQLite sidecar files in a dated recovery directory. Do not discard them.
3. Validate the selected backup using SQLite integrity_check.
4. Restore the backup as /var/lib/dokku/data/storage/travel/travel.sqlite, with owner 1001:1001. Move old -wal/-shm sidecars aside while stopped so they cannot be applied to the restored database.
5. Start the app, check /api/health, and verify trips and prices.

Never restore over an actively running database. Test recovery before relying on the backup process.

## Rollback

Keep the persistent mount attached. Deploy the previous known-good image tag using the normal Dokku process. Back up data before any future schema migration; rolling back an image does not reverse database schema changes.

The route and research-link update upgrades the database to schema 3. Older images cannot show or edit the new return-city, itinerary, or multiple-link fields. If a rollback requires restoring the pre-upgrade backup, follow the stopped-app restore procedure above and preserve the current database first; restoring an earlier snapshot also removes later edits. Recheck the schema and saved trip details after any rollback or redeployment.

## References
- [Dokku persistent storage](https://dokku.com/docs/advanced-usage/persistent-storage/)
- [Node SQLite backup API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)
