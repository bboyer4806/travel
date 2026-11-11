# Travel
A shared notebook for travel ideas: trips, ordered destinations, transportation between departing city, destinations, and return city, hotel alternatives, activities, restaurants, and estimated budgets.

## Start locally
Requires Node 24 and pnpm 10.32.1.
```sh
pnpm install --frozen-lockfile
pnpm dev
```
Open http://localhost:3000 and sign in with Google. The server refuses to start, in `pnpm dev` and in production, until these server-only settings are in `.env.local` (excluded from Git); see [Google Sign In](#google-sign-in):

```sh
# From a Google OAuth web client whose redirect URIs include http://localhost:3000/auth/google/callback
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
# The Google account authorized to use Travel
TRAVEL_OWNER_EMAIL=
```

There is no stand-in for Google, so signing in locally needs that real client.

Local data is stored in `data/travel.sqlite`. It is excluded from Git. Set `TRAVEL_DATABASE_PATH` to choose another location.

## Google Sign In
Sign in with Google is the only way in, and Travel signs in the same way as Budget and Meals: the OpenID Connect code flow with PKCE, written by hand in `src/lib/google.ts`, with sessions kept in Travel's own database. Every page, saved change, photo, city suggestion, feedback message and What's new entry requires signing in. Only the sign-in page (`/login`), the Google routes under `/auth/google`, and `/api/health` are public.

- **Who can sign in.** The Google account named by `TRAVEL_OWNER_EMAIL` is authorized when the app starts; access never depends on who signs in first, and nobody can register themselves. An email is also authorized when a trip owner shares a trip with it (TRA-104), even before that person has ever signed in. Authorization is permanent, even if every shared trip is later revoked. Authorized people can create their own trips.
- **Identity.** Travel uses only what Google's ID token says. The email must be verified by Google, and the first sign-in binds the authorization to Google's stable account identifier, so a reassigned email address cannot take over the account, and an account keeps access if its email changes. Google passwords and OAuth tokens are never stored.
- **Sessions.** Signing in starts a session that lasts 30 days from last use, across navigation and refreshes. The browser holds a random token in an HttpOnly, SameSite=Lax cookie, Secure and `__Host-` prefixed over HTTPS, and the database keeps only a hash of it. Every request checks the session against the database; an expired, unknown or altered token is refused. **Sign out** in the header ends the session on the server and removes the cookie.
- **Turned away.** Signed-out visitors go to the sign-in page, and after signing in start from All trips. The sign-in page says why when Google sign-in is refused:

| Google came back with | The sign-in page says |
| --- | --- |
| An account that hasn't been given access | This Google account doesn't have access to Travel, with a reminder to choose another account or ask a trip owner to share a trip |
| An email Google hasn't verified | Google hasn't verified this account's email address |
| A sign-in that didn't start in this browser, or started over ten minutes ago | That sign-in expired |
| A failure exchanging Google's code | Google sign in didn't finish |
| Cancel, on Google's screen | Nothing |

None of these creates a session. A save attempted after the session ends keeps the editor open and asks you to sign in again in another tab. Saved photos are served with private caching, so shared caches never store them.

## Sharing trips
Each trip has one owner and is private to its owner until shared (TRA-104).

- **Owners.** A new trip belongs to the account that creates it. Trips from before sharing belong to the designated owner, `TRAVEL_OWNER_EMAIL`, assigned once by the schema 20 upgrade and never by who signs in first. Ownership can't be transferred.
- **Sharing.** On the trip's page, the owner chooses **Share** and enters a Google account's email address, including someone who has never signed in to Travel. That email becomes authorized to sign in, and the trip appears in their list once they sign in with that Google account. Travel sends no invitation, email or link, so tell them yourself. An email can be added to a trip once; adding it again, or the owner's own email, is refused.
- **What shared people can do.** Everything in the trip: its details and dates, destinations, travel, hotels, activities, restaurants, churches, entry requirements, budgets, At home items and photos. Only the owner can delete the trip, share it, or remove someone, and the Share and Delete controls appear only for the owner. There are no view-only or custom roles.
- **Who has access.** The Share dialog lists the owner and everyone the trip is shared with, each with **Remove**. Trip lists show both your own trips and trips shared with you, marked **Shared by** their owner.
- **Removing access.** Takes effect on that person's next request: the trip leaves their list, its pages and saved links show "This page has moved on.", saves are refused and photos are no longer served. Nothing in the trip changes. Their email stays authorized, so they keep their own trips and any others shared with them. Photos their browser already downloaded can stay in that browser's cache.
- **Working together.** Everyone with access works on the same saved trip, and changes appear when the page reloads, including after each save. There are no live updates or edit conflict checks: the last save wins.
- **Enforcement.** The server checks the signed-in account against the trip on every page, Server Action and photo request, finding each item's trip from what is saved rather than from what the browser sends. A trip you can't open looks the same as one that doesn't exist.

## Checks
CI runs these on every pull request and before every deployment (`.github/workflows/check.yml`):
```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
bash scripts/smoke-container.sh
```
The container smoke script needs Docker and Bash. It builds the image and checks the container, persistent storage, sign-in enforcement and trip isolation, which a Next.js build alone does not verify.

## Local production preview
`pnpm build` produces Next.js standalone output, the same server the Docker image runs. Next.js warns that `next start`, which `pnpm start` runs, does not work with standalone output. To preview a build, copy in the files the standalone server leaves out, then start it with your `.env.local` settings:
```sh
pnpm build
cp -r public .next/standalone/
cp -r .next/static .next/standalone/.next/
TRAVEL_DATABASE_PATH="$PWD/data/travel.sqlite" node --env-file=.env.local .next/standalone/server.js
```
Repeat the copies after every build. The standalone server doesn't read `.env.local` itself, so `--env-file` passes your sign-in settings. It runs from `.next/standalone`, so `TRAVEL_DATABASE_PATH` must be absolute; a relative path would create a new, empty database inside the build output. The value on the command line takes precedence over the one in `.env.local`. The Docker image instead starts through `scripts/start.mjs`, which refuses to start without mounted persistent storage.

## Travel 1.5 responsiveness and backups
Trip and destination pages fetch only the relevant trip's data. Home-page budgets are computed on the server and reused while searching, and saves refresh the displayed page without returning the entire database to the browser. The unused Next.js image optimizer is disabled; existing photo routes and galleries are unchanged.

Production deployments require a verified, encrypted off-host backup before replacing the running application, and the server also sends one to the Windows receiver daily at 03:00 UTC. The one-time administrator setup, its November 9, 2026 verification and the isolated restore rehearsal are described in [deployment](docs/DEPLOYMENT.md).

## Trip dates and nights
Set the trip's optional **Start date**, then enter each destination's nonnegative whole number of **Nights**. Arrival and departure dates, their weekdays, and the trip end date are calculated in destination order. A departure is the next destination's arrival; changing the start, nights, or order recalculates the route. A zero-night stop arrives and departs on the same day. Dates cannot be overridden individually. Travel-leg timing notes do not determine the schedule.

Missing start dates or night counts leave affected dates and the trip end incomplete. Earlier complete destinations retain their calculated ranges. Nights still drive budget estimates even when the trip start is unknown. Stay notes and the trip's flexible date label remain descriptive text and are never parsed.

Schema 15 preserves original arrival/departure values separately. It backfills only valid, consistent structured dates; gaps, overlaps, invalid dates, and incomplete chains require review. Preserved dates appear beside incomplete schedules so you can set the start and nights deliberately. Migration replay retains later edits. See [deployment and rollback](docs/DEPLOYMENT.md) before upgrading.

## Budget rules
Every price is in **USD**, for the entire traveling party, with at most two decimal places. Currency selectors have been removed. Existing USD amounts retain their exact cents. Startup stops on unexpected non-USD records without converting or relabeling them; review those records before deployment.

Every amount follows the same rules, from destination budgets to the estimated prices of ideas, travel connections and at-home tasks: zero or more, at most two decimal places, and no more than $100,000,000. An amount outside them is refused with the same message in every field, naming that field. A subtotal too large to calculate exactly shows as not estimated, never as an inexact amount.

The estimate sums every travel leg, one selected hotel or the general nightly estimate per destination, the selected activities and food methods, miscellaneous spending, shopping, and entered at-home expenses. Alternatives stay saved without contributing. Missing required amounts remain visibly unknown; zero is known. At-home and shopping amounts are optional: blank adds no cost and does not make a complete estimate partial.

Changing a destination, departing city, or effective return city clears only affected travel plans, including links and itinerary. Reordering destinations keeps unchanged connections.

## Daily miscellaneous spending
Enter a daily miscellaneous amount in the destination editor. The subtotal is daily amount × nights, except a **zero-night stop uses one full budget day**. For example, three nights uses three days, one night uses one day, and zero nights also uses one day. The preview updates as nights and the amount change. Missing nights or amounts keep the estimate partial, including a zero amount with unknown nights. Clearing the amount marks it unknown.

## Nightly hotel estimate
Enter a general nightly amount in the destination editor or from Hotels. Its subtotal is nightly amount × nights; a zero-night stay costs zero when its rate is known. Unknown nights or a missing rate remain unestimated.

With no hotel selected, the general estimate supplies accommodation. Selecting a hotel replaces it with that hotel's whole-stay price, counted once. A selected hotel with an unknown price keeps accommodation unknown. Selecting, editing, unchecking, or deleting hotels preserves the general estimate; removing the selection restores it using the current nights.

## Activities budget
Choose **General budget** or **Itemized activity costs** in the destination editor or Activities page. Itemized is the default. A general amount covers the whole stay once; nights and travelers never multiply it. Missing amounts keep totals partial only in General budget mode.

Itemized mode uses only included activities, with included missing prices keeping the estimate partial; no included activities contributes zero. Switching methods preserves the general amount, saved ideas, and selections. Editing ideas never switches the method.

## Food budget
Choose **Daily food budget** or **Itemized restaurant costs** in the destination editor or Restaurants page. Itemized is the default. The daily amount uses the same duration as miscellaneous spending: nights, with **one full day for a zero-night stop**. Missing rates or nights are unknown, even for a zero rate, and make totals partial only in daily mode.

Daily mode excludes restaurant costs. Itemized mode counts only included restaurants' whole-party meal prices, with included missing prices keeping the estimate partial. No included restaurants contributes zero. Switching methods preserves entries, selections, and the daily estimate. Traveler count never multiplies amounts.

## Shopping budget
Use the edit control beside **Shopping**, or edit the destination, to enter an optional whole-stay amount. It is counted once, separately from miscellaneous spending. **Not set** adds no cost and is not a missing estimate. Zero is an intentional known amount. Clear the amount to remove its contribution.

## Destination controls
Hotels, Activities, and Restaurants links sit beside their budget headings and show saved-idea counts. The destination editor has one **Save** in its sticky header, with pending state and save errors kept in view; Cancel discards the draft.

The focused Typical Weather, Shopping, Food, and Activities editors save only their own fields. If someone changes the city, stay notes, schedule, or other destination details while one is open, those newer details and saved travel connections are preserved. Intentionally renaming a city in the main destination editor still clears its affected connections.

## Entry requirements
Each destination card has an **Entry requirements** section for manually maintained research. Add or edit passport nationality, purpose of travel, traveler circumstances, visa or electronic authorization requirements, passport validity, entry or health documents, separate transit requirements, and notes. Save official government or immigration links with descriptions and the date you last checked the information. All fields are optional; unrecorded information does not mean no requirements apply.

The section starts collapsed each time the page loads, showing only its **Entry requirements** heading, **Add entry requirements** or **Edit entry requirements**, and **Clear** once requirements are recorded. Select the heading by mouse, touch, or keyboard to show or hide the current stay, recorded requirements, sources, last checked date, and explanatory notes. Each destination's section opens and closes on its own, and adding, editing, and clearing work either way. Showing or hiding changes nothing saved, makes no server request, and is not remembered between visits.

Current calculated arrival, departure, and nights are shown for reference. Schedule changes preserve the research and its last checked date; saving does not automatically mark it checked. Verify requirements with official sources before traveling. Travel does not retrieve requirements, verify eligibility or documents, or monitor changes. **Clear** removes the record after confirmation; Cancel discards an editor draft. Requirements are stored with the destination in schema 18, included in backups, and deleted with their destination or trip.

## Idea priorities and ordering
Each destination's Hotels, Activities, and Restaurants list has **Up** and **Down** controls on each idea. Use them by mouse, touch, or keyboard to save your preferred order. Each destination and category keeps its own order; newly added ideas appear at the end, and editing a name leaves its position unchanged. The **Add hotel**, **Add activity**, or **Add restaurant** button appears below the list and remains available when the list is empty.

Mark activities and restaurants as **Must do** from their cards or editor; select the control again to remove the marker. This priority is independent of budget inclusion and does not change list order, prices, or budgeting methods. Hotels retain their separate chosen-stay selection.

Schema 16 preserves each existing list's alphabetical order on its first upgrade, with no ideas initially marked Must do. Order and priority survive reopening, backups, and migration replay. See [deployment and rollback](docs/DEPLOYMENT.md) before upgrading.

## Typical weather
Each destination card on the main trip page shows **Typical weather** with **Edit typical weather**. Category detail pages do not repeat it. Enter optional high and low temperatures in °F, rainfall notes, the month or period described, and a source name or link. These are manually recorded typical conditions; there is no automatic lookup or Celsius conversion.

The section starts collapsed each time the page loads, showing only its **Typical weather** heading and **Edit typical weather**. Select the heading by mouse, touch, or keyboard to show or hide the temperatures, period, rainfall notes, source, and explanation. Each destination's section opens and closes on its own, and **Edit typical weather** works either way. Showing or hiding changes nothing saved, makes no server request, and is not remembered between visits.

Negative and decimal Fahrenheit values are accepted; high must be at least low when both are supplied. Missing values show **Not provided** and zero shows **0 °F**. Clear individual fields or use **Clear all weather fields** and save. Weather and its recorded period persist independently of schedule and budget changes.

## Church
Each main destination card can show **Church**. New destinations show it while dates are unknown. With a complete date range it is eligible only when that inclusive range contains a Sunday, including Sunday arrivals, departures, and same-day stops. Both destinations sharing a Sunday transfer are eligible. Manual showing cannot override a known range without Sunday.

Hide Church without deleting entries or photos. Hiding persists through date changes; eligible hidden destinations offer **Show Church**. Upgrades preserve existing visibility choices, including previously disabled sections. Church is absent from category navigation; existing direct Church URLs still work and respect date eligibility and hiding.

Visible Church sections list every Sunday in the calculated stay, including arrival/departure Sundays, shared transfer days, and zero-night Sunday visits. The dates update when the trip start, destination order, or nights change. Unknown schedules show no assumed Sunday. These dates do not verify the recorded Mass times; confirm them with the church.

Add, edit, or remove multiple churches with name, address, optional denomination and website, and up to 30 Mass times with a day or date. Missing times show **Mass times unknown**. Church galleries use the photo controls below. Entries, visibility, Mass times, and photos persist in the same database and backups, and do not change idea counts or budgets.

## Feedback
**Send feedback** is available across the app, including inside editors without losing their drafts. Messages allow 2,000 characters. Submission shows a pending state, prevents duplicate clicks, and reports success only after Jira confirms creation. Failures preserve the draft for retry; opening again after success starts a fresh message.

The server creates a Task in the TRA backlog with label `user-feedback`. Its summary uses the first 80 characters of the first message line; its description includes the full message, page path/query, browser user agent, and viewport. Jira calls time out after 10 seconds and are never automatically retried. A delivery that times out may have reached Jira, so a manual retry can create another task.

Set server-only `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in production. They are never sent to the browser. Sending feedback requires signing in; there is no CAPTCHA. Same-origin checks, a hidden bot field, short-lived one-use tokens, and in-memory session/global rate limits protect the endpoint. Limits apply to this app's single process and reset on restart.

Local testing must use the loopback stand-in, never real Jira:

```sh
node scripts/jira-feedback-stub.mjs
# In another terminal, set these server environment variables, then pnpm dev:
# JIRA_URL=http://127.0.0.1:3010
# JIRA_EMAIL=stub@example.test
# JIRA_API_TOKEN=local-stand-in
```

Development refuses non-loopback Jira URLs. The stand-in validates the issue envelope and returns a synthetic issue ID without sending anything externally. It accepts any issue the app can send, including messages of 1,000 lines, and counts request size in bytes: a request over 256 KiB gets HTTP 413, and malformed JSON or an invalid issue gets 400. Production configuration and a real Jira delivery still require deployment verification.

## What's new
The shared header links to **What's new**. Published entries live in `src/lib/change-log.ts`, newest version first, with release date and concise changes. Travel 1.3 was deployed on November 1, 2026, and verified on November 2, 2026. Add only verified shipped changes and actual release dates at release close; an empty entry list displays **No releases yet**.

When entries exist, a browser that has not visited the latest version sees an unread dot. Visiting the page marks that version seen in local storage; link prefetch does not. Newer versions trigger it again, including releases on the same date. This is browser-local, independent of other people and devices. If storage is unavailable, the current session remembers the visit.

## At home
Each trip has an **At home** section below **Between the places**, even before destinations are added. Add, edit, or delete arrangements such as house sitting, child care, pet care, or pausing mail. Each item has a name, notes, an optional total price in USD, and a completion checkbox. Completed items can be reopened and remain visible. Items and expenses belong only to their trip and are included in backups.

## City suggestions
The Departing city, optional Return city, and City or destination fields use the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with location data from [GeoNames](https://www.geonames.org/). Suggestions are optional; manually entered cities still work. Searches of at least two characters are sent through `/api/locations`; adding a state or country (for example `Wooster, OH`) narrows results.

Destinations display as city and country, or city and state for US locations. Suggestions retain region details to distinguish same-named cities. Full selected labels remain stored so this display change and unchanged edits preserve travel plans; recognized older city/region/country labels are shortened on screen, while custom text remains supported.

The provider needs no key for this personal, non-commercial app. Its [free-service terms](https://open-meteo.com/en/terms) currently allow fewer than 10,000 calls per day, 5,000 per hour, and 600 per minute; commercial use needs a suitable plan or another provider. Lookup uses a four-second timeout, shares simultaneous matching queries, and keeps up to 200 queries in memory for ten minutes. The provider and response mapping live in `src/lib/location-search.ts`; no coordinates or extra location metadata are stored with a trip.

## Routes, itineraries, and research links
Trips return to their departing city by default. Select **Return to a different city** to enter a separate endpoint. Existing trips retain their departure location and default return behavior.
Each travel connection supports up to 30 ordered layovers or stops, with a place, arrival/departure details, and notes. The connection's estimated price covers the whole itinerary and is counted once in the trip budget.
Connections and hotel/activity/restaurant ideas support up to 20 research links with optional short descriptions. Existing single links are retained during the additive database upgrade. Older schema versions upgrade to the current version automatically inside a transaction; take an online backup before deploying this upgrade.
## Images
Each destination, hotel, activity, restaurant, and church can have up to 10 photos, with one selected as the main photo on its card. Click the thumbnails to view the other photos. Add photos, choose the main photo, or remove individual photos in the editor; removing the main photo selects another remaining photo. Cancel discards photo changes. Existing single idea images become the main photo automatically.

Destination galleries also have **Move left** and **Move right** controls in the editor to save photo order. The primary photo opens first, independently of its position in the thumbnail order. Removing it chooses the first remaining photo. Schema 17 preserves each existing destination image, including its bytes and version, as that destination's primary photo. Existing single-image URLs continue to serve the current primary photo; individual photo URLs retain ownership and version checks. Ordinary destination edits preserve the gallery.
JPEG, PNG, and WebP uploads up to 5 MiB each and 20 megapixels are supported, with at most 15 MiB of new files in one save. Images are oriented, resized to fit 1600 × 1200, stripped of metadata, and saved as WebP (up to 2 MiB each). All selected uploads must be valid before any changes are saved.
Images live in the same persistent SQLite database and are included in online backups. Snapshots carry only photo IDs, versions, and the main selection; image routes serve separate, versioned responses. Image-only edits preserve travel plans, prices, research links, and budget selections.

## Hosting
The existing GitHub Actions deployment builds a Node container and deploys it to Dokku at travel.dev.boyersoftware.com after checks pass. Only `main` deploys, only to the server with the verified SSH host key, and with the 20 MiB request limit photo uploads need; see [deployment safeguards](docs/DEPLOYMENT.md#deployment-safeguards-tra-98).
**Provision persistent storage before the first app deployment.** See [deployment and recovery instructions](docs/DEPLOYMENT.md).
This version runs one application instance with SQLite. Google Sign In requires the production settings in [deployment](docs/DEPLOYMENT.md#google-sign-in-tra-103); trip ownership and sharing need no further settings, but the schema 20 upgrade assigns existing trips to `TRAVEL_OWNER_EMAIL` (see [deployment](docs/DEPLOYMENT.md#schema-20-trip-ownership-and-sharing-tra-104)). Live collaboration and conflict resolution are future work.

## Backups
```sh
pnpm backup ./backups/travel-2026-10-07.sqlite
```
The backup uses SQLite's online backup API, checks integrity, and refuses to overwrite an existing backup.
It reads `TRAVEL_DATABASE_PATH` from the environment, then `.env.local`, then `.env`, and otherwise backs up `data/travel.sqlite`.
Store backups outside the repository and keep a copy off the server.

See [PLAN.md](PLAN.md) for the agreed scope and acceptance checks.
