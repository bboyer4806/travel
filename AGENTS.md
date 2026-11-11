<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Travel

A shared travel planner: trips, ordered destinations, travel between them, hotel, activity and
restaurant ideas, at-home arrangements and an estimated budget. Next.js 16, React 19 and
TypeScript, with one SQLite database through Node 24's built-in `node:sqlite`. Signing in with
Google is required, as in Budget and Meals: only explicitly authorized Google accounts can view
and edit trips.

Consult the relevant sections of [README.md](README.md) for setup and behavior,
[PLAN.md](PLAN.md) for agreed scope, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for hosting,
backup, restore and rollback. Planned features are not necessarily implemented; verify current
behavior and commands against the source and configuration.

## Development

Use Node 24 and pnpm 10.32.1, matching `package.json` and CI. Install with
`pnpm install --frozen-lockfile` and start with `pnpm dev`. Local data lives in
`data/travel.sqlite`; set `TRAVEL_DATABASE_PATH` to use another file. The server refuses to
start without `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` and `TRAVEL_OWNER_EMAIL` in `.env.local`,
from an OAuth client allowing `http://localhost:3000/auth/google/callback` (see README.md). There
is no stand-in for Google. Never commit or log their values.

## Checks

Use targeted checks while iterating. Before pushing, run the checks from
`.github/workflows/check.yml`: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
CI also runs `bash scripts/smoke-container.sh`, which needs Docker and Bash and checks the
container, persistent storage, sign-in enforcement and trip isolation. A Next.js build alone does
not verify those.
Fix regressions caused by your change; report unrelated baseline failures and blocked checks.
Repeat passing checks when subsequent changes affect their coverage or required gates demand it.

## Code

- Signing in follows Budget and Meals. `src/lib/google.ts` is the hand-written Google code flow,
  `src/auth.ts` the session checks, and `src/instrumentation.ts` refuses to start without the
  settings. Every page and its `generateMetadata` call `requireAccount()` first; every Server Action
  and route handler checks `currentAccount()` before using input. `src/proxy.ts` only checks that a
  session cookie exists, so it protects nothing on its own. Only `/login`, `/auth/google/*` and
  `/api/health` are public. Only the Google callback route may start a session, never an action.
- Authorized accounts and sessions are the store's `accounts` and `sessions` tables: emails, each
  bound to Google's stable subject at first sign-in, and hashed session tokens.
- Each trip has one owner (`trips.ownerId`) and is shared through `trip_shares` (TRA-104). The
  store decides access: every read and `applyMutation` take the signed-in account's ID from
  `requireAccount()` or `currentAccount()`, never from input, and a trip the account can't open
  looks the same as a missing one. Only owners delete, share or unshare a trip.
- Application writes go through `mutatePlanner` in `src/app/actions.ts`, into `applyMutation`
  in `src/lib/store.ts`. A new operation adds a `Mutation` variant in `src/lib/types.ts` and
  a case in `validate`, `mutationTrip` and `mutate` in the store. `mutationTrip` finds the trip
  a change applies to from saved rows; a change it doesn't place in a trip is refused.
- `src/lib/store.ts` is the application's database boundary. Home pages read `getHomeOverview`,
  trip and category pages read `getTripSnapshot`, and saves return only an ID or error.
  The store's `getSnapshot` reads every trip, for checks and tests only. Backup utilities and tests
  also access SQLite directly.
- Store validation throws `ValidationError`; upload validation throws `ImageValidationError`.
  Their messages are shown to people as written. Recognize the store's with `isValidationError`,
  not `instanceof`: a production build can bundle the store more than once.
- Every amount is integer USD cents for the whole party. Destination money retains explicit
  USD currency fields for storage compatibility; never convert or relabel unexpected non-USD data.
  `0` is known; `null` is not estimated, except optional at-home and shopping amounts.
  Budget math lives in `src/lib/budget.ts` and money parsing in `src/lib/money.ts`.
- Trip startDate and destination nights are schedule inputs. Use `src/lib/trip-dates.ts`
  for ordered read-only destination dates and trip end; retain legacy date columns for migration review.
  Hotels use nights; daily food/miscellaneous use `nightsToBudgetDays` (zero nights = one day).
  Never parse free-text stay notes. Church eligibility is separate from persistent manual visibility.
- Feedback uses `/api/feedback` and server-only Jira configuration. Local testing must use
  `scripts/jira-feedback-stub.mjs`, never real Jira. Do not expose credentials or log messages.
- Client components create new IDs with `randomUuid()` from `src/lib/uuid.ts`, never
  `crypto.randomUUID()`, which browsers leave out of plain-HTTP pages opened from another device.
- Publish `src/lib/change-log.ts` entries only for verified shipped changes at release close.

## Database

The schema version is SQLite `user_version` (see `createStore` in `src/lib/store.ts`, which also
authorizes the designated owner it is given at every start). A schema
change adds the next `if (version < N)` block inside the startup transaction, keeps older
databases upgrading, tolerates a block that already ran (as the `hasColumn` checks do), and
raises the newer-version guard. Add a rollback note for the new version to `docs/DEPLOYMENT.md`.

## Tests

- Tests are `tests/*.test.mjs` using `node:test`. They import TypeScript libraries directly and
  use in-memory or temporary on-disk databases (see `fileDatabase` in `tests/store.test.mjs`).
  Planning tests use `createOwnedStore` from `tests/owned-store.mjs`, which reads and writes as the
  designated owner; access tests call `createStore(path, ownerEmail)` with several accounts, as
  `tests/sharing.test.mjs` does.
- Node runs that TypeScript by stripping types, without path aliases. Code in `src/lib` uses
  relative imports for values (type-only `@/` imports are fine) and only erasable TypeScript: no
  enums or parameter properties. Passing type checks alone does not verify these runtime rules.

## Workflow

A behavior change updates README.md in the same change; new scope adds a dated "Added scope"
section to PLAN.md. A push to `main`, including documentation-only changes, runs the checks,
then requires a verified off-host encrypted backup before deploying to travel.dev.boyersoftware.com; PRs run checks only.
Update these instructions alongside changes to the commands or conventions they describe.
`CLAUDE.md` imports this shared guidance.
