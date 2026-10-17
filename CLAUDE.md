@AGENTS.md

# Travel

A shared travel planner: trips, ordered destinations, travel between them, hotel, activity and
restaurant ideas, at-home arrangements and an estimated budget. Next.js 16, React 19 and
TypeScript, with one SQLite database through Node 24's built-in `node:sqlite`. There are no
accounts: anyone with the link can view and edit every trip. [README.md](README.md) describes
behavior, [PLAN.md](PLAN.md) records agreed scope, [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)
covers hosting, backup, restore and rollback.

## Development

Use Node 24 and pnpm 10.32.1 (`package.json` pins both). Install with
`pnpm install --frozen-lockfile` and start with `pnpm dev`. Local data lives in
`data/travel.sqlite`; set `TRAVEL_DATABASE_PATH` to use another file.

## Checks before pushing

Run the checks from `.github/workflows/check.yml`:

`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. CI also runs `scripts/smoke-container.sh`, which needs Docker. Fix regressions caused by your
change; report unrelated baseline failures and checks you could not run.

## Code

- Every write goes through the one server action, `mutatePlanner` in `src/app/actions.ts`, into
  `applyMutation` in `src/lib/store.ts`. A new operation adds a `Mutation` variant in
  `src/lib/types.ts` and a case in both `validate` and `mutate` in the store.
- Only `src/lib/store.ts` touches the database. Pages and API routes read through its exported
  getters (`getSnapshot` and the image getters).
- Invalid input throws `ValidationError`; its message is shown to people as written.
- Money is integer USD cents for the whole party. `0` is a known free cost; `null` is not
  estimated, except a blank at-home price, which is optional. Budget math: `src/lib/budget.ts`.

## Database

The schema version is SQLite `user_version` (see `createStore` in `src/lib/store.ts`). A schema
change adds the next `if (version < N)` block inside the startup transaction, keeps older
databases upgrading, tolerates a block that already ran (as the `hasColumn` checks do), and
raises the newer-version guard. Add a rollback note for the new version to `docs/DEPLOYMENT.md`.

## Tests

- Tests are `tests/*.test.mjs` using `node:test`. They import `src/lib/*.ts` directly and use
  `createStore(":memory:")` (see `tests/store.test.mjs`).
- Node runs that TypeScript by stripping types, without path aliases. So code in `src/lib` uses
  relative imports for values (type-only `@/` imports are fine) and only erasable TypeScript: no
  enums or parameter properties. Breaking either fails `pnpm test` but not `pnpm typecheck`.

## Workflow

A behavior change updates README.md in the same change; new scope adds a dated "Added scope"
section to PLAN.md. A push to `main` runs the checks, then deploys to
travel.dev.boyersoftware.com; PRs run checks only.
