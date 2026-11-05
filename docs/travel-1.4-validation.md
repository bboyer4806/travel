# Travel 1.4 release validation

Released on November 4, 2026. [PR #17](https://github.com/bboyer4806/travel/pull/17) merged implementation commit `1d74ae6` as `dffd89e`. Local validation used Node 24.19.0 and pnpm 10.32.1.

## Scope

- [TRA-15](https://webpyro.atlassian.net/browse/TRA-15): manual destination entry requirements, traveler context, separate transit notes, official-source links, last checked date, and clear behavior.
- [TRA-52](https://webpyro.atlassian.net/browse/TRA-52): destination photo galleries, saved order, primary selection, removal, and migration of existing images.
- [TRA-67](https://webpyro.atlassian.net/browse/TRA-67): all inclusive Sunday dates in the existing Church section.
- [TRA-71](https://webpyro.atlassian.net/browse/TRA-71): Next.js and ESLint configuration pinned to the approved 16.4.5 version.
- [TRA-72](https://webpyro.atlassian.net/browse/TRA-72): focused weather and budget saves preserve newer unrelated destination and travel details.

## Passed

- `pnpm install --frozen-lockfile`.
- `pnpm lint` and `pnpm typecheck`.
- `pnpm test`: 162 tests passed, including upgrade/replay/backup, photo ownership and rollback, upload validation, draft ordering, entry requirements, stale focused saves, and Sunday date boundaries.
- `pnpm build` with Next.js 16.4.5. Windows junction creation required execution outside the filesystem sandbox.
- `pnpm audit --prod`: no reported production dependency vulnerabilities.
- Standalone server health and actual Server Action saves against an isolated test database.
- Browser requirements save with traveler details, transit notes, source link, and explicit last checked date.
- Browser gallery primary selection, keyboard reordering, reload persistence, thumbnail viewing, and Cancel preserving the saved order.
- Mobile 390 × 844 viewport: photo controls, sticky destination Save, and uploading/saving a PNG as the primary photo.
- Sunday dates rendered for November 8 and 15, 2026 in one section; a known Monday zero-night destination did not display Church.
- Standalone Sharp image processing after explicitly including native platform libraries in output tracing. The initial standalone build omitted Windows DLLs and prevented Server Actions from loading; rebuilding with the tracing rule fixed the failure.
- Container smoke script Bash syntax and embedded JavaScript syntax. The smoke script now also processes an image with the packaged Sharp runtime.

## Release verification

- [PR CI](https://github.com/bboyer4806/travel/actions/runs/41885905845) passed frozen installation, lint, typecheck, all 162 tests, build, and `bash scripts/smoke-container.sh`, including native image processing and persistence through container replacement. Docker remains unavailable locally.
- Independent release review found no blockers in migrations, focused edits, gallery validation, or image ownership and version handling.
- Took an online production backup at `/data/travel-pre-1.4-20261104-1821.sqlite` before deployment. Rehearsed schemas 16 → 18 on a separate server-side copy: eight existing tables unchanged, all three destination photos and their bytes/versions retained, integrity and foreign keys clean, and replay preserved the snapshot. Production data stayed on the server.
- [Deployment](https://github.com/bboyer4806/travel/actions/runs/41886238202) passed every gate and deployed image `ghcr.io/bboyer4806/travel:dffd89e1028916a26fb671525a5c5ec3eb8d3722`.
- Read-only live checks confirmed schema 18, database integrity, foreign keys, all 16 existing records and three destination photos preserved, successful photo delivery, wrong-owner photo requests rejected, native Sharp processing, and HTTP 200 health.
- Live browser verification confirmed migrated primary photos, entry-requirement empty states and editor, Sunday messaging for unknown dates, and existing budgets and travel details. The editor was cancelled without saving. Automatic approval review declined creating a temporary production trip; no production fixture was created. Saves/uploads were verified locally, and container persistence was verified in CI.
- Published 1.4 change-log content only after the deployed implementation passed these checks.
- All five scope issues were transitioned to Done and Jira sprint 21 (Travel 1.4) was closed on November 4, 2026, America/New_York. Jira still classified it as future, so it was activated at closeout before completing it; those Jira timestamps describe administrative closure rather than the implementation duration.

## Known dependency findings

Full `pnpm audit` retains existing development-only findings: one high Zod 4.6.5 advisory (GHSA-mrhx-c7xc-m3w5) and two moderate minimatch findings (GHSA-g3hv-75wg-m249). The production audit is clean. The Next.js upgrade preserves unrelated dependency versions.
