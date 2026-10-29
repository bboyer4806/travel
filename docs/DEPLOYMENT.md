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
- Keep the proxy request-body limit at least 16 MiB. Next.js permits 16 MiB request bodies, allowing 15 MiB of new photo files per save plus form fields and multipart overhead. Individual files remain limited to 5 MiB. The travel host currently computes a 20 MiB Nginx limit (`client_max_body_size 20m`).
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

The destination-image update upgrades the database to schema 4 with a separate image BLOB table. The persistent database and online backups contain images; no additional storage mount is needed. Back up schema 3 before deploying. The previous app rejects newer database schemas, so image rollback requires a compatible app build or the documented stopped-app restore procedure; restoring a pre-upgrade backup loses later edits.

Hotel, activity, and restaurant photos upgrade the database to schema 5 with a separate candidate image table. Existing destination images and saved ideas are retained. Back up schema 4 before deployment; candidate images use the same persistent database, upload limits, and backup procedure. Schema 4 app images reject schema 5, so use a compatible build or follow the stopped-app restore procedure for rollback.

Photo galleries upgrade the database to schema 6. Each hotel, activity, and restaurant can store up to 10 photos with one main selection. The migration retains the bytes and version of each previous single image and makes it the main photo. Destination images remain unchanged. Back up schema 5 before deployment; all gallery photos and main selections are included in the same online backup. Schema 5 app images reject schema 6, so rollback requires a compatible build or the stopped-app restore procedure. Restore loses edits made since the backup; preserve the current database before restoring.

At-home planning upgrades the database to schema 7 with a separate trip-owned item table. Existing trips, travel plans, and photos are retained. At-home notes, prices, and completion states use the same persistent storage and online backups. Back up the current database before deploying (schema 5 deployments upgrade through schemas 6 and 7 in one transaction). Earlier builds reject schema 7; rollback requires a compatible build or the stopped-app restore procedure above.

Typical weather upgrades the database to schema 13 with nullable Fahrenheit temperatures and optional rainfall, period, and source text on destinations. Existing data and budget calculations remain unchanged. Back up schema 12 before deployment. All weather fields are included in the same database and online backups. Schema 12 builds reject schema 13; rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database first; restoring an older backup loses later edits.

## References
- [Dokku persistent storage](https://dokku.com/docs/advanced-usage/persistent-storage/)
- [Node SQLite backup API](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)

### Schema 8: destination dates and miscellaneous spending
Daily miscellaneous spending upgrades the database to schema 8, adding nullable arrival/departure dates, a daily amount in currency minor units, and a currency to destinations. Existing stay notes remain unchanged; their dates and amounts start unknown. All fields live in the existing persistent SQLite database and online backups. Take a backup before deploying. Schema 7 and earlier app builds reject schema 8, so rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database first; restoring a pre-upgrade backup loses later edits.

### Schema 9: nightly hotel estimates
Nightly hotel estimates upgrade the database to schema 9, adding nullable hotel nightly amounts in currency minor units and their currencies to destinations. Existing destinations begin without a general estimate; selected hotels, dates, miscellaneous settings, and all other data remain intact. Back up before deployment. These fields and hotel selections use the existing database and online backup. Schema 8 and earlier app builds reject schema 9; rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database before restoring a backup, which loses later edits.

### Schema 10: activities budgeting method and general amount
Activities budgeting upgrades the database to schema 10, adding an explicit method (defaulting to itemized), a nullable general amount in currency minor units, and a nullable currency per destination. Existing activity ideas and selections continue supplying the budget until a user chooses General budget. The upgrade preserves hotel estimates, dates, miscellaneous settings, and all existing data. These fields use the existing SQLite storage and online backups. Take a backup before deployment. Schema 9 and earlier builds reject schema 10; rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database first; restoring an earlier backup loses subsequent edits.

### Schema 11: daily food budgets and explicit restaurant costing
Food budgeting upgrades the database to schema 11, adding a method (defaulting to itemized), a nullable daily amount in currency minor units, and a nullable currency per destination. Existing destinations retain their itemized restaurant calculations, entries, and selections; switching methods does not remove entries or the saved daily estimate. Previous dates, budgets, routes, photos, and at-home items remain intact. The new fields use the existing SQLite storage and online backups. Back up before deployment. Schema 10 and earlier builds reject schema 11; rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database first because restoring an earlier backup loses later edits.

### Schema 12: destination shopping budgets
Shopping budgets upgrade the database to schema 12, adding a nullable amount in currency minor units and a nullable currency per destination. Existing destinations start with shopping unset, which contributes no cost and preserves their previous budget calculations. Dates, miscellaneous amounts, hotel estimates, activity and food methods, routes, photos, and at-home items remain intact. Shopping fields use the existing SQLite storage and online backups. Take a backup before deployment. Schema 11 and earlier builds reject schema 12; rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database first because restoring an earlier backup loses later edits.

### Schema 14: optional destination churches and photos
Church planning upgrades the database to schema 14, adding destination visibility and separate church and church-image tables. On first addition of the visibility column, existing complete date ranges containing Sunday enable the section; otherwise it starts hidden. Replaying the migration preserves saved visibility, churches, Mass times, photos, and main-photo selections. Existing dates, budgets, weather, ideas, routes, and at-home data remain unchanged. Deleting a church removes its photos, and deleting a destination removes its churches and photos.

Church details, visibility, and gallery images use the existing persistent SQLite storage and online backups; no additional mount is needed. Take a schema 13 backup before deployment. Schema 13 and earlier builds reject schema 14, so rollback requires a compatible build or the stopped-app restore procedure above. Preserve the current database first because restoring an older backup loses later edits. The container smoke check verifies saved church details, unknown Mass times, hidden visibility, image bytes and main selection after replacement, and image-route ownership.

### Schema 15: Travel 1.2 schedule inputs and USD validation
Take and verify an online backup before deployment. Rehearse the upgrade against a copy of production data, including galleries, weather, churches, routes, and all budget source modes. On October 29, 2026, schema 15 was rehearsed against a server-side copy of the verified schema 14 production backup. All nine tables retained their rows and existing fields (original dates retained in legacy columns), and integrity and foreign-key checks passed. Both existing trips had incomplete schedules requiring review; no dates were guessed. Production data stayed on the server.

Schema 15 adds trip startDate, destination nights, and preserved legacy arrival/departure columns. Only consistent complete chains supply a trip start; individually valid non-conflicting date pairs can supply nights. Conflicting or incomplete chains remain visibly incomplete until reviewed. Effective dates are recalculated from the new inputs. Original dates remain stored separately, stay notes are never parsed, and replay preserves subsequent edits. Existing Church visibility choices remain saved, including hidden sections; date eligibility now controls whether a section can appear.

All currencies must be USD. Startup checks stored currency fields inside the migration transaction and aborts on any unexpected non-USD value without conversion or relabeling. Investigate against the backup and resolve the source information deliberately before deploying; do not bulk relabel amounts. Existing USD cents are unchanged. General hotel rates multiply nights; daily food and miscellaneous use nights with a one-day minimum for zero-night stops. Selected hotel prices and fixed amounts remain whole-stay costs.

Earlier images reject schema 15. Rollback requires a compatible build or the stopped-app restore procedure above. Preserve the upgraded database and sidecars first; restoring the pre-upgrade backup loses later edits. The container smoke script checks schema 15, trip start/nights, USD amounts, and persistent galleries/Church data after container replacement.

### Feedback and release notes
Configure server-only JIRA_URL (HTTPS Jira base URL), JIRA_EMAIL, and JIRA_API_TOKEN with permission to create Tasks in TRA. Use the host's secret configuration; never put credentials in source, image layers, client variables, or logs. Preserve the browser Host and Origin headers through the proxy; the feedback endpoint compares them and ignores forwarded-host claims. The HttpOnly feedback cookie is Secure for HTTPS origins.

Feedback creates backlog Tasks with label user-feedback, message and page/browser context. Verify one explicitly authorized production submission after deployment and remove any temporary test task as appropriate. Local development and automated tests use the loopback stand-in only. Upstream timeout is 10 seconds, with no automatic retry; an uncertain response can mean the issue was created even though the user sees an error. One-use tokens prevent token replay, while a deliberate retry starts a new attempt.

Abuse guards are in-memory for the single web process: 3 sends per session per hour, 5 globally per minute, and 30 globally per hour; token issuance is limited separately. Tokens expire after 15 minutes and must mature for one second. Limits reset at process restart and are not a substitute for shared limits if the deployment model changes.

At release close, add only actually shipped changes and their actual release date to src/lib/change-log.ts. Version ordering drives the browser-local unread dot; no account or database migration is involved. An empty entry list is intentional until release evidence is available.
