<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Travel

A shared travel planner: trips, ordered destinations, travel between them, hotel, activity and
restaurant ideas, at-home arrangements and an estimated budget. Next.js 16, React 19 and
TypeScript, with one SQLite database through Node 24's built-in `node:sqlite`. There are no
accounts: anyone with the link can view and edit every trip.

Consult the relevant sections of [README.md](README.md) for setup and behavior,
[PLAN.md](PLAN.md) for agreed scope, and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for hosting,
backup, restore and rollback. Planned features are not necessarily implemented; verify current
behavior and commands against the source and configuration.

## Development

Use Node 24 and pnpm 10.32.1, matching `package.json` and CI. Install with
`pnpm install --frozen-lockfile` and start with `pnpm dev`. Local data lives in
`data/travel.sqlite`; set `TRAVEL_DATABASE_PATH` to use another file.

## Checks

Use targeted checks while iterating. Before pushing, run the checks from
`.github/workflows/check.yml`: `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
CI also runs `bash scripts/smoke-container.sh`, which needs Docker and Bash and checks the
container and persistent storage. A Next.js build alone does not verify those.
Fix regressions caused by your change; report unrelated baseline failures and blocked checks.
Repeat passing checks when subsequent changes affect their coverage or required gates demand it.

## Code

- Application writes go through `mutatePlanner` in `src/app/actions.ts`, into `applyMutation`
  in `src/lib/store.ts`. A new operation adds a `Mutation` variant in `src/lib/types.ts` and
  a case in both `validate` and `mutate` in the store.
- `src/lib/store.ts` is the application's database boundary. Pages and API routes read through
  its exported getters (`getSnapshot` and the image getters). Backup utilities and tests also
  access SQLite directly.
- Store validation throws `ValidationError`; upload validation throws `ImageValidationError`.
  Their messages are shown to people as written.
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
- Publish `src/lib/change-log.ts` entries only for verified shipped changes at release close.

## Database

The schema version is SQLite `user_version` (see `createStore` in `src/lib/store.ts`). A schema
change adds the next `if (version < N)` block inside the startup transaction, keeps older
databases upgrading, tolerates a block that already ran (as the `hasColumn` checks do), and
raises the newer-version guard. Add a rollback note for the new version to `docs/DEPLOYMENT.md`.

## Tests

- Tests are `tests/*.test.mjs` using `node:test`. They import TypeScript libraries directly and
  use in-memory or temporary on-disk databases (see `createStore(":memory:")` and `fileDatabase`
  in `tests/store.test.mjs`).
- Node runs that TypeScript by stripping types, without path aliases. Code in `src/lib` uses
  relative imports for values (type-only `@/` imports are fine) and only erasable TypeScript: no
  enums or parameter properties. Passing type checks alone does not verify these runtime rules.

## Workflow

A behavior change updates README.md in the same change; new scope adds a dated "Added scope"
section to PLAN.md. A push to `main`, including documentation-only changes, runs the checks,
then deploys to travel.dev.boyersoftware.com; PRs run checks only.
Update these instructions alongside changes to the commands or conventions they describe.
`CLAUDE.md` imports this shared guidance.
