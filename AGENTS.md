<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

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
container, persistent storage, sign-in enforcement, refusing a database it can't open, the health
check Dokku runs, trip and destination isolation, and AI access limits. A Next.js build alone does
not verify those.
After building, CI runs `node scripts/review-errors-smoke.mjs` against disposable databases and
fixture sessions to check production HTTP errors, recovery, cross-bundle save validation,
connecting Claude through OAuth, MCP and the owner's Server Actions, proposing, showing,
approving and rejecting photo changes, proposing, showing and approving trips' headline images (TRA-174), serving trips' headline images and their large versions only to accounts that can open them, and
Add image by URL's refusals.
Fix regressions caused by your change; report unrelated baseline failures and blocked checks.
Repeat passing checks when subsequent changes affect their coverage or required gates demand it.

## Code

- Signing in follows Budget and Meals. `src/lib/google.ts` is the hand-written Google code flow,
  `src/auth.ts` the session checks, and `src/instrumentation.ts` refuses to start without the
  settings, through `requireServerSettings` in `src/lib/server-settings.ts`. Every page and its
  `generateMetadata` call `requireAccount()` first; every Server Action and route handler checks
  `currentAccount()` before using input. `src/proxy.ts` only checks that a session cookie exists,
  so it protects nothing on its own. Only `/login`, `/auth/google/*` and
  `/api/health` are public, with what ChatGPT and Claude need to connect: OAuth metadata under
  `/.well-known` and `/api/oauth/register` and `/api/oauth/token`. `/api/mcp` takes only an AI
  connection's access token. Only the Google callback route may start a session, never an action.
- Authorized accounts and sessions are the store's `accounts` and `sessions` tables: emails, each
  bound to Google's stable subject at first sign-in, and hashed session tokens.
- Each trip has one owner (`trips.ownerId`) and is shared through `trip_shares` (TRA-104). The
  store decides access: every read and `applyMutation` take the signed-in account's ID from
  `requireAccount()` or `currentAccount()`, never from input, and a trip the account can't open
  looks the same as a missing one. Only owners delete, share or unshare a trip.
- Access (TRA-162), `src/app/access/page.tsx` with `src/components/access-chart.tsx`, is read-only: `getAccessOverview`
  lists every trip and destination the account can open, with its owner and who else can open it, from the same rules
  as every other read. Only an owner sees who else has access, so for anyone else's it lists the owner and the account.
- Each account keeps its own order of the trips it can open on All trips in `trip_order` (TRA-16), which
  `getHomeOverview` follows. `trip.order` saves an account's whole order and is refused unless it names every trip the
  account can open, once each. A trip it hasn't placed, as one created or shared since, comes last, in the order the
  account got it; unsharing removes the trip's place in that account's order.
- Destinations are shared by their owner's trips (TRA-105). Each owner has one per city
  (`destinations.cityKey`, from `destinationKey` in `src/lib/destination-label.ts`), and trips visit
  them through `trip_stops`, which keep each trip's order, stay notes, nights and dates. A destination
  added to a trip belongs to the trip's owner, and one created in Destinations (TRA-106) to its creator;
  an account opens one it owns or that a trip it can open visits. Adding a city to a trip (`stop.add`,
  TRA-107) visits the trip owner's destination for it, or adds one, as a stop without nights, and
  returns the trip's existing stop there instead of adding another. Add destination also lists the trip owner's
  destinations the account can open (`library` from `getTripSnapshot`, TRA-142), matched to what is typed and to city
  suggestions only by `searchLibrary` in `src/lib/destination-library.ts`, and `stop.visit` adds the one chosen by its ID,
  refusing one the account can't open or that isn't the trip owner's. Either adds the stop last, or with `before`, one of
  the trip's stops, directly before it, from the + between the trip's cards (TRA-153). Removing a stop or deleting a trip
  never deletes a destination or what is saved with it. Only its owner deletes a destination, and only
  while no trip visits it.
- A destination's city shows exactly as saved unless `destinations.cityFromSuggestion` records it as
  the label of a city suggestion chosen for it (TRA-76). Show it with `formatSavedDestinationLabel` given
  the destination, never by guessing from the text.
- ChatGPT and Claude (TRA-115) use the MCP endpoint in `src/lib/mcp.ts`, with tools in
  `src/lib/mcp-tools.ts` and OAuth in `src/lib/ai-auth.ts` and `src/lib/oauth-handlers.ts`. Only the
  designated owner (`isAiOwner`) connects them, on `/ai/authorize`, and decides their proposals. They
  read every trip through the store's `ai*` reads, never credentials, and change Travel only by
  proposing `Mutation`s: `proposeAiChanges` rehearses them and records each one's preview and effect
  rows (`src/lib/ai-preview.ts`); `decideAiProposal` makes them through `execute`, without
  `authorize`, in one transaction, only when they make exactly the rows previewed. Rows a change adds
  take their IDs and time from the `Make` it is given, so a proposal replays exactly. A new table or
  column needs a label in `PREVIEW_COLUMNS`, or in `EDITABLE_FIELDS` for an editable field, or a place among the
  integration's own tables; tests check. `aiChange` refuses any property a change's schema doesn't list (`CHANGE_FIELDS`
  in `src/lib/mcp-tools.ts`).
- Editable fields (TRA-174): each record's ordinary fields, single values a save checks on its own and writes to one
  column, are declared once in `EDITABLE_FIELDS` in `src/lib/editable-fields.ts`, with their kind, limits, label and
  description. `validate` reads them with `readFields`, `propose_changes` describes each save's fields from them, previews
  label their columns from them, and the save types in `src/lib/types.ts` follow from them. A new ordinary field goes there,
  with its column, the read that gives it and the save that writes it, and needs no code for assistants;
  `tests/editable-fields.test.mjs` proposes, previews, approves and reads back every field. Lists, records of their own,
  IDs and photos keep explicit validation and schemas.
- Photo changes (`destination.photos`, `candidate.photos`, `church.photos`, TRA-122) are only
  proposals': `validate` refuses them, so people change photos only through each item's save with
  uploaded files. Before a proposal is checked against Travel's data, `checkAiProposal` lists the photos
  it adds and `prepareAiPhotos` in `src/lib/ai-photos.ts` downloads them through
  `src/lib/image-download.ts`, HTTPS to public addresses only, and prepares them with `prepareImage`;
  `aiChange` then takes each change's photos from those, never from what the assistant sent. A
  proposal's photos wait in `ai_proposal_photos`, never in `changesJson`, until it is decided or expires,
  and the owner sees them through `/api/ai-proposal-images`. `trip.image` (TRA-174), a trip's headline image, works the
  same way, and a destination's headline image is its primary photo, which `destination.photos` changes.
- Add image by URL (TRA-139) is `src/components/image-by-url.tsx`, in the destination, idea, church and trip image
  editors. `/api/image-url` downloads the image with `downloadImageByUrl` in `src/lib/image-url.ts`, through
  `src/lib/image-download.ts` over HTTP or HTTPS (proposals' photos stay HTTPS only), checks it with `prepareImage` and
  answers with it as its server sent it. The editor adds it as a chosen file, so saves upload it unchanged. Component
  tests give editors a stand-in for it and test it in `tests/image-by-url.test.mjs`.
- The trip map (TRA-44) is `src/components/trip-map.tsx`, with Leaflet in `trip-map-canvas.tsx`, loaded only in the
  browser. `tripJourney` and `mapLayout` in `src/lib/trip-map.ts` decide what it shows, and `/api/trip-map/[tripId]` looks
  the trip's saved names up with `locatePlaces` in `src/lib/location-search.ts`, within the city suggestions' Open-Meteo
  limits. The trip map stores no coordinates and never guesses one: a place it can't find is listed below it.
- The destination map (TRA-130) is `src/components/destination-map.tsx`, with Leaflet in `destination-map-canvas.tsx`,
  loaded only in the browser, on each trip destination card and destination page. `destinationPlaces` and
  `destinationMapLayout` in `src/lib/destination-map.ts` decide what it shows, and `/api/destination-map/[destinationId]`
  finds the destination with `locatePlaces` and its saved ideas and churches around it with `locateNear` in
  `src/lib/place-search.ts`. That is the only code that asks Nominatim, whose usage policy it keeps: one request at a
  time, more than a second apart, named `TravelPlanner/1.0`, with answers kept for a day. A place is found only when
  exactly one place matches its address, or else its name, within 50 km; tests use a stand-in, never Nominatim.
- Coordinates (TRA-150) are each idea's and church's `latitude`, `longitude`, `coordinatesAccuracy` (`exact` or
  `approximate`) and `coordinatesReview` columns, all set or none, read as `coordinates` and checked by
  `normalizeCoordinates` in `src/lib/coordinates.ts`. People change them only with `candidate.save` and `church.save`,
  from `PlaceLocationFields` in each place's editor, read by `coordinatesFromForm`; left out they are kept, and a save
  that changes the address leaves them waiting for review until a save gives them again or removes them. Only proposals
  make `candidate.coordinates` and `church.coordinates`, which change nothing else, and `aiChange` refuses coordinates in
  a proposal's save. The address comes first (TRA-163): `lookupText` in `src/lib/destination-map.ts` decides what the
  route looks up, a place's address alone when it has coordinates the map can use (`mapCoordinates`) and nothing without
  an address, and `destinationMapLayout` shows each place where its lookup found it, or else at those coordinates,
  however far away. Travel never looks coordinates up, checks them or saves what a lookup finds.
- Airports (TRA-132) are OurAirports' public-domain list in `src/lib/airports.json`, written only by
  `node scripts/update-airports.mjs` and found only by `airportByCode` in `src/lib/airports.ts`. City suggestions
  offer the airport for a three-letter IATA code in any letter case, except in destination fields, and the trip map
  shows a departure, return or layover written as a code in capitals at the airport, from `journeyAirportNames`. The
  list stays on the server: client components import location search types only.
- Monthly climate averages (TRA-135) are a destination's one row of `destination_climate`, apart from its typical weather
  columns, changed only by `destination.climate` with a whole record or null, and checked by `normalizeMonthlyClimate` in
  `src/lib/typical-weather.ts`: every month once, named in full (TRA-158), with its high and low in °F and precipitation
  in inches, a source and reference years, all required, and no other field, since the fields' names carry the units.
  The row keeps the months in calendar order without their names, written by `climateJson` and read, named again, by
  `climateFromJson`. A save whose months have no names comes from a page opened before TRA-158 and is refused with
  `PLANNER_UPDATED`; `aiChange` refuses an assistant's first, with `NAME_EACH_MONTH`. A proposal's page shows a record as
  its source, years and every month, each beside the saved one. Travel never looks them up, estimates them or fills in a
  month. `src/components/climate-chart.tsx` charts them for every destination; in a trip it first chooses the month of the
  stay's `arrivalDate`, and choosing a month changes only what it shows.
- A destination's U.S. travel advisory level (TRA-171) is `usAdvisoryLevel` in its health and safety record, one of
  `US_ADVISORY_LEVELS` in `src/lib/health-safety.ts` or null for none, shown with `usAdvisoryLabel` beside its color. Every
  record gives it: a save without it comes from a page opened before TRA-171 and is refused with `PLANNER_UPDATED`, and
  `aiChange` refuses an assistant's with `GIVE_US_ADVISORY_LEVEL`. It is apart from the typed `advisoryLevel`, and Travel
  never reads a level from research or looks one up.
- A destination's doctors and clinics for non-emergency care (TRA-172) are `medicalProviders` in its health and safety
  record, apart from `emergencyContacts`: `MedicalProvider`s in `src/lib/health-safety.ts`, with no limit on how many,
  checked by `normalizeHealthSafety`. Each check is `verified` or `unconfirmed` (`PROVIDER_CHECKS`) and the soonest visit
  one of `SHORT_NOTICE_CARE`, always given and never inferred; a map location is a latitude and longitude, checked by
  `normalizeLatLng` in `src/lib/coordinates.ts`. Every record gives the list: a save without it comes from a page opened
  before TRA-172 and is refused with `PLANNER_UPDATED`, and `aiChange` refuses an assistant's with
  `GIVE_MEDICAL_PROVIDERS`. The editor holds `MedicalProviderDraft`s, their degrees as typed; the section lists them with
  `providersInOrder`, verified English first, and links with `telephoneHref` and `mapHref`. Travel never finds, checks,
  ranks or books providers.
- Layover plans (TRA-45) are `layover_plans`, at most one per layover in a connection's `itineraryJson`, keyed by
  `legId` and `layoverId`, read as each leg's `layoverPlans` and changed only by `leg.layoverPlan` with a whole plan or
  null. `normalizeLayoverPlan` and `layoverSchedule` in `src/lib/layover-plan.ts` check a plan and work out its schedule:
  both flights' times are the airport's wall-clock times in one IANA time zone, and every minute is the traveler's own
  estimate, starting at 0. Travel suggests no activities and supplies no estimates. A `leg.save` whose itinerary drops a
  layover or makes it a stop, and `clearLeg`, delete its plan, and deleting the leg cascades.
- Application writes go through `mutatePlanner` in `src/app/actions.ts`, into `applyMutation`
  in `src/lib/store.ts`, or come from an approved AI proposal. A new ordinary field of an existing save goes in
  `EDITABLE_FIELDS` instead (TRA-174). A new operation adds a `Mutation`
  variant in `src/lib/types.ts`, a case in `validate` (or, for a change only proposals make, in
  `aiChange`), `mutationScope` and `mutate` in the store, a schema in `src/lib/mcp-tools.ts` and a
  title in `operationTitle`. `mutationScope` finds the trip or
  destination a change applies to from saved rows; a change it doesn't place is refused. Only `trip.order`, each
  account's own trip order, is for people alone: `aiChange` refuses it and it has no schema.
- A save that adds a trip, an idea, a church or an At home item sends the
  ID its editor gave it when it opened, with `create: true` (TRA-75). The store adds the item when no
  item has that ID, and the same save sent again after a lost response changes that item instead of
  adding another. Without `create`, a save changes a saved item and is refused when it no longer
  exists. A save without an ID comes from a page opened before this and is refused with
  `PLANNER_UPDATED` from `src/lib/planner-updated.ts`, the message `perform()` also shows for an
  unrecognized action, as is a `destination.save` that adds a destination to a trip, from a page
  opened before `stop.add`. `destination.create` and `stop.add` instead open the saved destination,
  or the trip's stop, for their city, or add one with an ID the store gives it.
- `src/lib/store.ts` is the application's database boundary. Home pages read `getHomeOverview`,
  trip and category pages read `getTripSnapshot`, Destinations pages read
  `getDestinationsOverview` and `getDestinationSnapshot`, Access reads `getAccessOverview`, and saves return
  only an ID or error.
  The store's `getSnapshot` reads every trip, for checks and tests only. Backup utilities and tests
  also access SQLite directly.
- Store validation throws `ValidationError`; upload validation throws `ImageValidationError`.
  Their messages are shown to people as written. Recognize the store's with `isValidationError`,
  not `instanceof`: a production build can bundle the store more than once.
- Every amount is integer USD cents for the whole party. Destination money retains explicit
  USD currency fields for storage compatibility; never convert or relabel unexpected non-USD data.
  `0` is known; `null` is not estimated, except optional at-home, shopping and transit miscellaneous amounts.
  Budget math lives in `src/lib/budget.ts`. Parsing, validation messages, formatting, input values
  and the $100,000,000 limit for every amount, prices included, live in `src/lib/money.ts`.
- Image upload types and size and gallery limits live in `src/lib/image-limits.ts`, as do the limits
  on the photos one AI proposal downloads and the sizes photos and their large versions are saved at. The photo
  editors, upload decoding, the store and the MCP tools use them, and messages state them from there.
- Each photo is saved with its thumbnail (TRA-89), and with its large version when its upload is larger than the
  photo, up to 2560 × 1920 with its width and the photo's (TRA-154): `prepareImage` returns them as a `PreparedImage`,
  and every save of a photo, an AI proposal's included, carries them, `large` null for none. A trip's headline image
  keeps the photo and its large version, without a thumbnail, since it shows only cropped in its card and banner.
  Gallery thumbnails, editor previews, and the maps' previews and popups (TRA-143, TRA-152) load each photo's
  `/thumbnail` route; every frame that shows the photo itself offers its `/large` route too, with `photoSizes` from
  `src/lib/photo-sizes.ts` and the frame's widths there, which follow `globals.css`: a layout change updates them. A
  photo saved before schema 32 has a NULL thumbnail, so `storedThumbnailResponse` makes one with `makeThumbnail` for
  each request and saves nothing: image routes never write. One saved before schema 40 has no large version and loads
  as before.
- A trip's optional headline image (TRA-133) is its one row of `trip_images`, deleted with the trip, with its own
  crop for the trip's card on All trips and for its page's banner: a `PhotoCrop`, a focal point and a zoom, shown with
  `cropStyle` and dragged with `draggedFocus` from `src/lib/photo-focus.ts`. People change it only with `trip.save`'s
  `image`, which `mutatePlanner` always builds from the trip editor's form with `prepareTripImage` in
  `src/lib/trip-image-upload.ts`, so no mutation supplies it, and `aiChange` refuses it there. ChatGPT and Claude propose it
  only with `trip.image` (TRA-174), whose new image starts uncropped; the proposal's page shows the current and proposed
  images from `PreviewRecord.headline`. New crops name the version of the image they were chosen for.
  `src/components/trip-image.tsx` shows it only when a trip has one, and edits it.
- A trip's page has its own spacing on phones (TRA-156): the planner marks its main content `trip-page`, and rules under
  it, in `globals.css` and in components' styles as `:global(.trip-page)`, change only spacing, up to 540px wide. What
  depends on a padding follows it: a card's photo takes it back, a carousel's arrows stay within it, and a destination's
  name keeps its room beside its buttons. Pages sharing its styles, such as a destination's page, keep theirs; tests check.
- Trip startDate and each stop's nights are schedule inputs. Use `src/lib/trip-dates.ts`
  for ordered read-only destination dates and trip end; retain legacy date columns for migration review.
  Hotels use nights; daily food/miscellaneous use `nightsToBudgetDays` (zero nights = one day).
  Never parse free-text stay notes. Church eligibility is separate from persistent manual visibility.
- Feedback uses `/api/feedback` and server-only Jira configuration. Local testing must use
  `scripts/jira-feedback-stub.mjs`, never real Jira. Do not expose credentials or log messages.
  Its limits count per signed-in account, which the route passes to the handler (TRA-92).
- Help (TRA-3) is static text in `src/lib/help.ts`: each signed-in page's title and at most six
  points, keyed by its route in the `AppRoutes` Next.js generates, so a page added without help
  fails `pnpm typecheck`. `src/components/help.tsx` opens it from the header and from the heading
  of every planner dialog, always for the page's route, never the editor. The not-found page
  renders `NotFoundHelp`, so Help there describes it rather than its address's route.
- Client components create new IDs with `randomUuid()` from `src/lib/uuid.ts`, never
  `crypto.randomUUID()`, which browsers leave out of plain-HTTP pages opened from another device.
- Publish `src/lib/change-log.ts` entries only for verified shipped changes at release close.

## Database

The schema version is SQLite `user_version` (see `createStore` in `src/lib/store.ts`, which also
authorizes the designated owner it is given at every start). A schema
change adds the next `if (version < N)` block inside the startup transaction, keeps older
databases upgrading, tolerates a block that already ran (as the `hasColumn` checks do), and
raises `SCHEMA_VERSION` to N. The newer-version guard, tests and the container smoke test read
that constant; older blocks keep their own numbers. Upgrades run with foreign keys off, so a block
can rebuild a table others refer to, and `foreign_key_check` must pass before they commit. In the schema history of `docs/DEPLOYMENT.md`, update the current
schema and add a note for the new version, with only what its rollback adds to the shared procedure.

## Tests

- Tests are `tests/*.test.mjs` using `node:test`. They import TypeScript libraries directly and
  use in-memory or temporary on-disk databases from the shared `setup` and `fileDatabase` in
  `tests/budget-fixtures.mjs`; import those rather than copying them into a test file. A save that
  adds an item spreads `newItem()` from there for its ID and `create`, as its editor sends them, and
  `addDestination` or `addCity` from there add a city to a trip with `stop.add`, then save its details.
  Planning tests use `createOwnedStore` from `tests/owned-store.mjs`, which reads and writes as the
  designated owner; access tests call `createStore(path, ownerEmail)` with several accounts, as
  `tests/sharing.test.mjs` does. Tests of older databases turn a new one back with
  `UNDO_SCHEMA_21` (then `UNDO_SCHEMA_20`) from `tests/owned-store.mjs`. AI integration tests use
  `aiSetup` from `tests/ai-fixtures.mjs`: an owner, a guest with an unshared trip, and a Claude connection,
  whose `propose` takes the photos a proposal adds as Travel prepared them. Downloads are tested with a
  stand-in `PhotoFetch`, never a real website.
- Node runs that TypeScript by stripping types, without path aliases, as does the container's
  `scripts/start.mjs`, which checks the settings and opens and upgrades the database from `src/lib`
  before the server starts (TRA-78). Code in `src/lib` uses relative imports for values (type-only
  `@/` imports are fine) and only erasable TypeScript: no enums or parameter properties. Passing
  type checks alone does not verify these runtime rules.

## Workflow

A behavior change updates README.md, and the help of each page it changes in `src/lib/help.ts`, in
the same change; new scope adds a dated "Added scope" section to PLAN.md. A push to `main`,
including documentation-only changes, runs the checks,
then requires a verified off-host encrypted backup before deploying to travel.dev.boyersoftware.com; PRs run checks only.
Update these instructions alongside changes to the commands or conventions they describe.
`CLAUDE.md` imports this shared guidance.
