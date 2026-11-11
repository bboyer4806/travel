# Deploying Travel

The app uses Node 24, Next.js standalone output, and SQLite. One app instance serves a shared database. Only authorized Google accounts can sign in and use it; configure [Google Sign In](#google-sign-in-tra-103) before deploying.

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
- Keep the proxy request-body limit at least 16 MiB. Next.js permits 16 MiB request bodies, allowing 15 MiB of new photo files per save plus form fields and multipart overhead. Individual files remain limited to 5 MiB. The deployment workflow sets a 20 MiB Nginx limit (`client-max-body-size 20m`) before every deploy; see [Deployment safeguards](#deployment-safeguards-tra-98).
- Keep one web instance: shared SQLite on one server is the v1 deployment model.
- Confirm /api/health returns HTTP 200. Create a temporary trip, restart the app, and verify the trip remains before considering persistence verified.
- The container refuses to start without the Google Sign In settings below, so a deployment without them fails instead of running unprotected.

The Docker image must be tested on a Docker-capable machine or CI; a local Next build alone does not prove the container or host mount works.

## Google Sign In (TRA-103)

Travel signs in with Google the same way as Budget and Meals: a hand-written OpenID Connect code flow with PKCE and sessions in Travel's own SQLite database. Only authorized accounts can sign in: the designated initial owner, and people a trip owner shares a trip with ([TRA-104](#trip-sharing-tra-104)). Authorizations and sessions live in the `accounts` and `sessions` tables, so backups include them.

**Deployment order.** TRA-103 merged and deployed on its own; TRA-104 follows. Until TRA-104 ships, only the owner can sign in. Brian is currently Travel's only user, so that window is acceptable.

1. **Identify the initial owner.** Choose the Google account that will own existing trips. Its email is the only authorization created by configuration; nobody gains access by signing in first.

2. **Set up the Google OAuth client.** Travel can use the same Web application client as Budget and Meals or one of its own. In Google Cloud Console (Google Auth Platform → Clients), add this authorized redirect URI to the client:

   ```text
   https://travel.dev.boyersoftware.com/auth/google/callback
   ```

   For local development, add `http://localhost:3000/auth/google/callback`. The consent screen asks only for `openid`, `email` and `profile`; while it is in testing, only its listed test users can sign in. Sharing a client never shares a sign-in: each app has its own sessions and its own host-only cookies, so signing in to one does not sign you in to another.

3. **Configure the server before deploying.** From a root shell on the Dokku host, set the server-only settings. Never put these values in source, image layers, client variables, tickets or logs:

   ```sh
   sudo dokku config:set --no-restart travel \
     GOOGLE_CLIENT_ID='<OAuth client ID>' \
     GOOGLE_CLIENT_SECRET='<OAuth client secret>' \
     TRAVEL_OWNER_EMAIL='<owner Google email>'
   ```

   The server refuses to start, naming what is missing, without both Google settings or with an invalid `TRAVEL_OWNER_EMAIL`, so a deployment without them fails instead of running. Travel builds Google's redirect URI from each request's `Host` and `X-Forwarded-Proto`, so there is no URL setting, but Google refuses one that isn't on the client exactly. Keep the proxy passing both headers; the HTTPS scheme also makes the cookies Secure and `__Host-` prefixed.

4. **Verify after deployment.** Confirm `/api/health` returns HTTP 200 and opening the site goes to the sign-in page. Sign in as the owner and confirm existing trips, prices and photos are intact. Sign in with an unauthorized Google account and confirm the access-denied message and that no session starts. Cancel at Google's account chooser and confirm you return to the sign-in page. Sign out and confirm trips and photo URLs are no longer reachable.

Sessions last 30 days from last use. Signing out deletes that browser's session on the server, and deleting rows from the `sessions` table ends those sessions on their next request. Sign-in failures are logged with their cause only; codes, tokens, secrets and session values are never logged.

## Trip sharing (TRA-104)

Each trip has one owner, and owners share trips with other Google accounts from the trip's **Share** dialog. No new settings are needed, and nothing is emailed. The upgrade to [schema 20](#schema-20-trip-ownership-and-sharing-tra-104) gives every existing trip to the account named by `TRAVEL_OWNER_EMAIL`.

1. **Confirm the designated owner.** Before deploying, confirm that `TRAVEL_OWNER_EMAIL` on the host (`sudo dokku config:get travel TRAVEL_OWNER_EMAIL`) is the Google account that should own every existing trip. The upgrade assigns them once, inside its startup transaction, and never by who signs in first. Ownership can't be transferred afterwards, and changing the setting later authorizes the new email without moving any trip.

2. **Back up.** The deployment workflow takes and verifies its encrypted off-host backup before deploying. Also take an on-host online backup with a unique name (see [Backup](#backup)) as the schema 19 rollback point, and keep it until the upgrade is verified.

3. **Verify after deployment.** Confirm `/api/health` returns HTTP 200. Sign in as the owner and confirm every existing trip, price and photo is intact, with **Share** and the delete button on each trip page. Share one trip with a second Google account you control, sign in as it in another browser, and confirm only that trip is listed, marked **Shared by**, that you can edit it, and that its page has neither **Share** nor delete. As the owner, remove that account in the Share dialog, then confirm the second browser's next reload of the trip's URL shows "This page has moved on." and its list no longer has the trip. Nothing in the trip should have changed.

## Deployment safeguards (TRA-98)

The deployment workflow (`.github/workflows/deploy.yml`) deploys only from `main`, connects only to the verified Dokku host, and sets the request-body limit that photo uploads need.

- **Only `main` deploys.** The job that builds, publishes and deploys the image runs only when the workflow runs from `refs/heads/main`: a push to `main`, or **Run workflow** with `main` selected. Run from any other branch, the workflow runs the checks and skips that job. Runs from other branches also queue separately, so they can't replace a deploy from `main` that is waiting to start.
- **Only the verified host key is trusted.** Both SSH connections to `DOKKU_HOST`, the off-host backup and the Dokku deploy, write the `TRAVEL_BACKUP_KNOWN_HOSTS` secret to `known_hosts` and connect with `StrictHostKeyChecking=yes`. That secret holds the host's own ed25519 key, verified out of band ([off-host backups, step 4](#travel-15-encrypted-off-host-backups-to-windows-11)). The workflow no longer trusts whatever key `ssh-keyscan` returns at deploy time. A missing secret, or a server presenting any other key, stops the deployment before Dokku changes anything. If the host key is ever replaced, read the new key from `/etc/ssh/ssh_host_ed25519_key.pub` on the host itself, verify it, and update the secret; never trust the key a scan returns.
- **Uploads up to 20 MiB.** Before deploying, the workflow runs `dokku nginx:set travel client-max-body-size 20m`, above the 16 MiB a photo save can send and Dokku's 1 MiB default. Each deploy rebuilds the nginx configuration, so new and existing apps both get the limit. Re-running the workflow for an image that's already deployed rebuilds nothing ("No changes detected"); after changing the limit by hand, run `sudo dokku proxy:build-config travel`.

## Backup

The image contains the online SQLite backup helper. From the host:

```sh
sudo dokku run travel node scripts/backup.mjs /data/travel-backup-2026-10-07.sqlite
```

Use a unique filename every time. The helper refuses overwrite, reads the configured source without creating an empty database, and validates the snapshot.
Copy successful backups to separate storage; backups on the same disk are insufficient for disk loss.

## Travel 1.5: encrypted off-host backups to Windows 11

GitHub deployment fails closed when a fresh off-host backup cannot be verified. Installing the code does not by itself configure the server, the Windows 11 receiver, or an automatic schedule; repeat these steps for a replacement server or receiver.

The production database, including all gallery photos stored as SQLite BLOBs, is backed up online using the existing validated `scripts/backup.mjs`. The server encrypts each snapshot with [age](https://age-encryption.org/), sends only the encrypted file to an always-on Windows 11 computer over Tailscale and OpenSSH, and asks the receiver to independently verify its SHA-256 hash. Temporary plaintext snapshots are removed from the host, and the Windows receiver retains backups from the most recent 30 days.

1. **Windows receiver.** Set up Tailscale on Windows 11 and the Dokku server, and verify they can reach one another over the private tailnet. Disable Tailscale key expiry for both machines; an expired key stops backups and blocks every deployment. Create a dedicated non-administrator Windows account for the backups, install and enable Windows OpenSSH Server, restrict inbound SSH to Tailscale, and configure key-only SSH access. Add the server's key to that account's `authorized_keys` as an ASCII line prefixed with `restrict,from="<server tailnet IP>"`, so it works only from the server and cannot open terminals or tunnels; Windows PowerShell's `>` writes UTF-16, which the SSH server cannot read. While signed in as this account, create `$env:USERPROFILE\travel-backups`, restrict its NTFS permissions, and put `scripts/verify-retain.ps1` there. Windows SSH logins must start in that account's profile directory for the relative path `travel-backups\verify-retain.ps1` to resolve. Install age on Windows and create a recipient/identity key pair with `age-keygen`. Store the **private identity only on Windows** in a protected separate directory and retain an offline recovery copy. Record its public `age1...` recipient for the server; do not copy the private key to Linux or GitHub.

2. **Production host.** Install `age`, `openssh-client`, `openssl`, and `cron`; retain the existing working Dokku app and persistent mount. Join the host to the tailnet with `tailscale up --accept-dns=false --shields-up`, which leaves its DNS settings unchanged and refuses inbound tailnet connections; the host only connects out to Windows. Install `scripts/offhost-backup.sh` as `/usr/local/sbin/travel-offhost-backup` owned by root with mode `700`, and confirm its SHA-256 matches the repository copy. Create a dedicated server-to-Windows SSH private key and its Windows account authorized-key entry. Save that key in a root-only file. Create `/etc/travel-backup.env` owned by root with mode `600`, with exactly these variables:

   ```sh
   TRAVEL_BACKUP_RECIPIENT=age1...your-public-recipient
   TRAVEL_BACKUP_WINDOWS_USER=your-dedicated-windows-user
   TRAVEL_BACKUP_TAILSCALE_IP=100.x.y.z
   TRAVEL_BACKUP_SSH_KEY=/root/.ssh/travel-windows-backup
   ```

   Pin the verified Windows SSH server host key in root-only `/etc/travel-backup-known-hosts`; do not depend on automatically accepting a newly presented host key. Validate the host key out of band, then test SSH and SCP to the Windows backup account. Confirm free disk space and that the Windows system remains online.

3. **Daily scheduling.** Run a manual `sudo /usr/local/sbin/travel-offhost-backup` first, then install `/etc/cron.d/travel-backup` with this UTC schedule:

   ```cron
   0 3 * * * root /usr/local/sbin/travel-offhost-backup >> /var/log/travel-backup.log 2>&1
   ```

   The script fails on a missing database, corrupt snapshot, failed encryption, transfer, checksum, or retention operation. Check `/var/log/travel-backup.log` and cron logs daily, and configure administrator notification from the host's normal monitoring system. The script never modifies the live database and removes its temporary host files on exit.

4. **Pre-deployment backup identity.** Create a dedicated `backup-runner` SSH account on the Dokku host, with no password. Restrict its passwordless sudo permission to exactly `/usr/local/sbin/travel-offhost-backup` with no arguments (`backup-runner ALL=(root) NOPASSWD: /usr/local/sbin/travel-offhost-backup ""` in `/etc/sudoers.d/travel-backup-runner`); do not grant broader administrative commands. Give it a new key, separate from the Dokku deployment key, in a root-owned `authorized_keys` entry prefixed with `restrict,command="sudo -n /usr/local/sbin/travel-offhost-backup"`, so the key can only start this backup. Add its SSH private key as the GitHub Actions secret `TRAVEL_BACKUP_HOST_SSH_KEY`, then delete the host's copy. Add the **verified, pinned** Dokku host SSH public key line, read from the host's own `/etc/ssh/ssh_host_ed25519_key.pub`, to `TRAVEL_BACKUP_KNOWN_HOSTS`. GitHub never reveals the `DOKKU_HOST` value that a host name in that line would have to match, so production uses the host pattern `*` (`* ssh-ed25519 AAAA…`); the runner still refuses any server that does not present that key. The Dokku deploy step trusts the same key ([Deployment safeguards](#deployment-safeguards-tra-98)). The deployment workflow uses the existing `DOKKU_HOST` secret and calls the same backup script before deploying. Missing secrets or any backup error stop deployment.

5. **Independent recovery rehearsal.** On Windows, signed in as the backup account so the `$env:USERPROFILE` paths below resolve, select an encrypted backup and decrypt it to an **isolated test file**, never onto a running production database:

   ```powershell
   age -d -i "$env:USERPROFILE\.config\age\travel-identity.txt" -o "$env:TEMP\travel-restore-test.sqlite" "$env:USERPROFILE\travel-backups\<backup-file>.sqlite.age"
   ```

   Open the isolated file read-only with SQLite and verify `PRAGMA integrity_check` returns `ok`, `PRAGMA foreign_key_check` has no rows, and that expected trips, destinations, prices, and photo BLOB rows exist. Delete the isolated test file afterward. For a real restore, use the **stopped-app** restore procedure below; never copy it over an active SQLite database.

Before activating automatic deployment, test a successful transfer, checksum verification, deliberate Windows-disconnected failure (must block deployment), 30-day pruning, and a successful isolated restore. Deployment is not considered enabled until these tests pass. The host and the Windows receiver remain responsible for retaining the root-only configuration and Windows private decryption identity outside source control.

**Production verification, November 9, 2026.** Production (Ubuntu 24.04, Dokku 0.38.27) sends backups over Tailscale to the Windows 11 receiver. Each of these runs produced an encrypted backup that Windows verified by SHA-256: a manual run, a run with cron's minimal environment and no terminal, the scheduled 03:00 UTC run, and the deployment workflow's exact `backup-runner` SSH call, made from the host to itself. Backup files begin with `age-encryption.org/v1`, the Windows identity's public key equals the configured recipient, and no unencrypted snapshot remained on the host. A dummy backup dated 31 days old was pruned and one dated 29 days old was kept. With the host taken off the tailnet, the backup command run as `backup-runner` through its sudo rule exited with status 255 once the connection timed out, which fails the workflow step before Dokku deploys. An isolated restore decrypted the newest backup on Windows into a temporary folder: `PRAGMA integrity_check` returned `ok`, `PRAGMA foreign_key_check` returned no rows, and the schema 18 copy held the expected 2 trips, 3 destinations, 4 travel legs, 6 ideas, 11 priced rows and 3 destination photos before the folder was deleted. The Windows age identity did not yet have its offline recovery copy; until it does, losing that computer's disk makes every backup unreadable.

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

### Schema 16: Travel 1.3 idea order and Must do
Back up before deployment and rehearse against a copy of the current database. Schema 16 adds candidate position and Must do fields. Each destination/category list starts in its previous alphabetical order (case-insensitive name, then ID); existing ideas start unmarked. Initialization runs only when each column is first added, so migration replay preserves later changes. New ideas append to their list; priority and ordering never change prices, inclusion, budget methods, galleries, research links, routes, or other trip data.

On November 1, 2026, the upgrade was rehearsed against a copy of the verified schema 15 production backup. All nine tables retained their rows and original values, initial alphabetical ordering was preserved, and replay retained subsequent order and Must do edits. Integrity and foreign-key checks passed. The verified backup is retained on the server and, with explicit approval, in the ignored local backups folder. On November 2, the live schema 16 database passed integrity and foreign-key checks, and all three idea pages rendered saved ordering, applicable Must do flags, and Add actions below the list.

The same SQLite database and online backups preserve both fields. The container smoke check verifies stored positions and Must do flags after container replacement alongside existing data and images. Earlier builds reject schema 16; rollback requires a compatible build or the stopped-app restore procedure above. Preserve the upgraded database and sidecars first; restoring a pre-upgrade backup loses subsequent edits.

### Schemas 17–18: Travel 1.4 destination galleries and entry requirements

Take and verify an online backup, then rehearse against a copy of the current database before deployment. Schema 17 replaces the single destination-image table with an ordered gallery table. Each old photo retains its bytes and version and becomes its destination's primary photo at position zero. The table-shape check makes replay preserve later photo additions, ordering, and primary choices. Individual photo IDs and the legacy primary-photo route both enforce destination ownership and requested versions.

Schema 18 creates a destination-owned entry-requirements table. Existing destinations start without a record. Manual research, sources, and last checked dates are included in the same SQLite backup; destination and trip deletion cascade to these records. Replaying this migration preserves existing records. Neither migration changes budgets, schedules, routes, candidate/church galleries, or other trip information.

The container smoke script verifies schema 18, destination photo bytes/order/primary selection, individual image routes and ownership, and entry-requirements persistence across container replacement, alongside the existing checks. Docker is required to run it; a Next.js build does not validate the container. Next.js and its ESLint configuration are pinned to 16.4.5 for this implementation. Explicit output tracing includes Sharp's platform libraries from pnpm's package layout, including the DLLs needed by local Windows standalone previews. Recheck the dependency audit at release time and report any remaining unrelated tooling advisories.

Schema 16 and earlier builds reject the newer database. Rollback requires a compatible build or the stopped-app restore procedure above. Preserve the upgraded database and sidecars first; restoring a pre-upgrade backup loses later edits. Production migration rehearsal and deployment verification are still required before closing Travel 1.4 and publishing its release notes.

### Schema 19: Google Sign In accounts and sessions
Google Sign In upgrades the database to schema 19 with two tables. `accounts` holds each authorized email, the stable Google account identifier bound at that person's first sign-in, their Google display name, and when the email was authorized. `sessions` holds a SHA-256 hash of each browser's session token, its account and its expiry, never the token itself. Trips and all other data are unchanged. Both tables are included in the same online backups, and replaying the migration keeps existing authorizations, bindings and sessions. Take and verify a backup before deployment; the startup authorization of `TRAVEL_OWNER_EMAIL` is the only change at upgrade.

Schema 18 and earlier builds reject schema 19. Rollback requires a compatible build or the stopped-app restore procedure above; preserve the upgraded database and sidecars first, because restoring an older backup loses later edits and authorizations. **A build from before Google Sign In has no sign-in at all: anyone with the URL could again view and edit every trip.** Prefer fixing forward. If a rollback is unavoidable, keep the app stopped until access is otherwise restricted.

### Schema 20: trip ownership and sharing (TRA-104)
Trip sharing upgrades the database to schema 20 in the startup transaction. `trips` gains an `ownerId` referencing `accounts`, and triggers refuse any trip without an owner, because SQLite can't add a required column that references another table. Every existing trip is assigned to the account of `TRAVEL_OWNER_EMAIL`, which startup authorizes first; who signed in first plays no part. A new `trip_shares` table holds one row per trip and account it is shared with, keyed by both, so an email can't be invited twice. Deleting a trip removes its shares. Removing a share deletes only that row: the account stays authorized and the trip is unchanged. Both tables are in the same online backups. A replay finds every trip owned and changes nothing, even if `TRAVEL_OWNER_EMAIL` has changed since.

**Rehearsal, November 10, 2026.** In an isolated environment, the schema 19 build from `main` wrote a production-like database: 2 trips, 3 destinations, 5 connections, 9 ideas, 3 churches, 18 photos, entry requirements, At home items, and the owner's bound account and session. `scripts/backup.mjs` backed it up, and the backup matched the live file. The TRA-104 build then upgraded the live file: every existing table kept its row count, the full snapshot and every photo's bytes and version were unchanged, home budgets were unchanged, every trip belonged to the designated owner, the owner stayed signed in, and `integrity_check` and `foreign_key_check` passed. Replaying the upgrade changed nothing. The schema 19 build refused the upgraded file without modifying it, and after the stopped-app restore of the backup it opened the schema 19 data unchanged, with the owner's session. A rehearsal against a copy of the verified production backup is still required before deployment, as for earlier schemas.

Schema 19 builds reject schema 20. Rollback requires a compatible build or the stopped-app restore of the pre-upgrade backup above. Preserve the upgraded database and sidecars first: restoring loses ownership, shares, accounts authorized by sharing, and every later edit. **Never lower `user_version` to run an older build on a schema 20 database: schema 19 builds have no trip isolation, so every account a trip was shared with could see and change every trip.** Prefer fixing forward.

### Feedback and release notes
Configure server-only JIRA_URL (HTTPS Jira base URL), JIRA_EMAIL, and JIRA_API_TOKEN with permission to create Tasks in TRA. Use the host's secret configuration; never put credentials in source, image layers, client variables, or logs. Preserve the browser Host and Origin headers through the proxy; the feedback endpoint compares them and ignores forwarded-host claims. The HttpOnly feedback cookie is Secure for HTTPS origins.

Feedback creates backlog Tasks with label user-feedback, message and page/browser context. Verify one explicitly authorized production submission after deployment and remove any temporary test task as appropriate. Local development and automated tests use the loopback stand-in only. Upstream timeout is 10 seconds, with no automatic retry; an uncertain response can mean the issue was created even though the user sees an error. One-use tokens prevent token replay, while a deliberate retry starts a new attempt.

Abuse guards are in-memory for the single web process: 3 sends per session per hour, 5 globally per minute, and 30 globally per hour; token issuance is limited separately. Tokens expire after 15 minutes and must mature for one second. Limits reset at process restart and are not a substitute for shared limits if the deployment model changes.

At release close, add only actually shipped changes and their actual release date to src/lib/change-log.ts. Version ordering drives the browser-local unread dot; no account or database migration is involved. An empty entry list is intentional until release evidence is available.
