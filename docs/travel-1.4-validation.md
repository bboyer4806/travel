# Travel 1.4 implementation validation

Validated locally on November 4, 2026, using Node 24.19.0 and pnpm 10.32.1. Implementation branch: `codex/travel-1.4`. This records implementation checks, not a deployed release.

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

## Remaining release checks

- `bash scripts/smoke-container.sh` could not run because Docker is not installed on this machine. Run it in Docker-capable CI before release; local build/browser checks do not verify container replacement or mounted storage.
- Full `pnpm audit` retains existing development-only findings: one high Zod 4.6.5 advisory (GHSA-mrhx-c7xc-m3w5) and two moderate minimatch findings (GHSA-g3hv-75wg-m249). The Next.js upgrade preserves unrelated dependency versions.
- Back up production and rehearse schemas 17–18 against a copy, following `docs/DEPLOYMENT.md`. No production database was used for these checks.
- Deployment, production verification, and 1.4 change-log publication remain separate release steps. Existing shipped release notes are unchanged.
