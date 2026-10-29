# Travel
A shared notebook for travel ideas: trips, ordered destinations, transportation between departing city, destinations, and return city, hotel alternatives, activities, restaurants, and estimated budgets.

## Start locally
Requires Node 24 and pnpm 10.32.1.
```sh
pnpm install --frozen-lockfile
pnpm dev
```
Open http://localhost:3000. No account is required. Anyone with access to the app can view and edit every trip.
Local data is stored in `data/travel.sqlite`. It is excluded from Git. Set `TRAVEL_DATABASE_PATH` to choose another location.

## Checks
```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
For local production preview, set `TRAVEL_DATABASE_PATH` to an absolute database path before `pnpm start`. The Docker image uses a guarded startup script requiring mounted storage.

## Trip dates and nights
Set the trip's optional **Start date**, then enter each destination's nonnegative whole number of **Nights**. Arrival and departure dates, their weekdays, and the trip end date are calculated in destination order. A departure is the next destination's arrival; changing the start, nights, or order recalculates the route. A zero-night stop arrives and departs on the same day. Dates cannot be overridden individually. Travel-leg timing notes do not determine the schedule.

Missing start dates or night counts leave affected dates and the trip end incomplete. Earlier complete destinations retain their calculated ranges. Nights still drive budget estimates even when the trip start is unknown. Stay notes and the trip's flexible date label remain descriptive text and are never parsed.

Schema 15 preserves original arrival/departure values separately. It backfills only valid, consistent structured dates; gaps, overlaps, invalid dates, and incomplete chains require review. Preserved dates appear beside incomplete schedules so you can set the start and nights deliberately. Migration replay retains later edits. See [deployment and rollback](docs/DEPLOYMENT.md) before upgrading.

## Budget rules
Every price is in **USD**, for the entire traveling party, with at most two decimal places. Currency selectors have been removed. Existing USD amounts retain their exact cents. Startup stops on unexpected non-USD records without converting or relabeling them; review those records before deployment.

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

## Typical weather
Each destination card on the main trip page shows **Typical weather** with **Edit typical weather**. Category detail pages do not repeat it. Enter optional high and low temperatures in °F, rainfall notes, the month or period described, and a source name or link. These are manually recorded typical conditions; there is no automatic lookup or Celsius conversion.

Negative and decimal Fahrenheit values are accepted; high must be at least low when both are supplied. Missing values show **Not provided** and zero shows **0 °F**. Clear individual fields or use **Clear all weather fields** and save. Weather and its recorded period persist independently of schedule and budget changes.

## Church
Each main destination card can show **Church**. New destinations show it while dates are unknown. With a complete date range it is eligible only when that inclusive range contains a Sunday, including Sunday arrivals, departures, and same-day stops. Both destinations sharing a Sunday transfer are eligible. Manual showing cannot override a known range without Sunday.

Hide Church without deleting entries or photos. Hiding persists through date changes; eligible hidden destinations offer **Show Church**. Upgrades preserve existing visibility choices, including previously disabled sections. Church is absent from category navigation; existing direct Church URLs still work and respect date eligibility and hiding.

Add, edit, or remove multiple churches with name, address, optional denomination and website, and up to 30 Mass times with a day or date. Missing times show **Mass times unknown**. Church galleries use the photo controls below. Entries, visibility, Mass times, and photos persist in the same database and backups, and do not change idea counts or budgets.

## Feedback
**Send feedback** is available across the app, including inside editors without losing their drafts. Messages allow 2,000 characters. Submission shows a pending state, prevents duplicate clicks, and reports success only after Jira confirms creation. Failures preserve the draft for retry; opening again after success starts a fresh message.

The server creates a Task in the TRA backlog with label `user-feedback`. Its summary uses the first 80 characters of the first message line; its description includes the full message, page path/query, browser user agent, and viewport. Jira calls time out after 10 seconds and are never automatically retried. A delivery that times out may have reached Jira, so a manual retry can create another task.

Set server-only `JIRA_URL`, `JIRA_EMAIL`, and `JIRA_API_TOKEN` in production. They are never sent to the browser. No CAPTCHA or account is required. Same-origin checks, a hidden bot field, short-lived one-use tokens, and in-memory session/global rate limits protect the endpoint. Limits apply to this app's single process and reset on restart.

Local testing must use the loopback stand-in, never real Jira:

```sh
node scripts/jira-feedback-stub.mjs
# In another terminal, set these server environment variables, then pnpm dev:
# JIRA_URL=http://127.0.0.1:3010
# JIRA_EMAIL=stub@example.test
# JIRA_API_TOKEN=local-stand-in
```

Development refuses non-loopback Jira URLs. The stand-in validates the issue envelope and returns a synthetic issue ID without sending anything externally. Production configuration and a real Jira delivery still require deployment verification.

## What's new
The shared header links to **What's new**. Published entries live in `src/lib/change-log.ts`, newest version first, with release date and concise changes. Travel 1.2 was deployed and verified on October 29, 2026. Add only verified shipped changes and actual release dates at release close; an empty entry list displays **No releases yet**.

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
Connections and hotel/activity/restaurant ideas support up to 20 research links with optional short descriptions. Existing single links are retained during the additive database upgrade. Older schema versions upgrade to version 15 automatically inside a transaction; take an online backup before deploying this upgrade.
## Images
Each destination can have one optional uploaded image. Each hotel, activity, restaurant, and church can have up to 10 photos, with one selected as the main photo on its card. Click the thumbnails to view the other photos. Add photos, choose the main photo, or remove individual photos in the editor; removing the main photo selects another remaining photo. Cancel discards photo changes. Existing single idea images become the main photo automatically.
JPEG, PNG, and WebP uploads up to 5 MiB each and 20 megapixels are supported, with at most 15 MiB of new files in one save. Images are oriented, resized to fit 1600 × 1200, stripped of metadata, and saved as WebP (up to 2 MiB each). All selected uploads must be valid before any changes are saved.
Images live in the same persistent SQLite database and are included in online backups. Snapshots carry only photo IDs, versions, and the main selection; image routes serve separate, versioned responses. Image-only edits preserve travel plans, prices, research links, and budget selections.

## Hosting
The existing GitHub Actions deployment builds a Node container and deploys it to Dokku at travel.dev.boyersoftware.com after checks pass.
**Provision persistent storage before the first app deployment.** See [deployment and recovery instructions](docs/DEPLOYMENT.md).
This first version runs one application instance with SQLite; accounts and live collaboration conflict resolution are future work.

## Backups
```sh
pnpm backup ./backups/travel-2026-10-07.sqlite
```
The backup uses SQLite's online backup API, checks integrity, and refuses to overwrite an existing backup.
Store backups outside the repository and keep a copy off the server.

See [PLAN.md](PLAN.md) for the agreed scope and acceptance checks.
