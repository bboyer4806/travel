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

## Budget rules
Travel, hotel, activity, restaurant, and at-home prices are entered in USD for the entire traveling party. Daily miscellaneous spending, the general nightly hotel estimate, and the general activities budget each have their own currency per destination. Hotel prices cover the whole stay; restaurant prices cover one meal.
The estimate sums every travel leg, one selected hotel or the general nightly hotel estimate per destination, the selected activities budgeting method, restaurants included in the plan, daily miscellaneous spending, and entered at-home expenses.
Missing travel and selected-idea prices are unknown rather than zero. Alternatives stay saved without contributing to the budget. At-home items have optional prices: a blank price does not contribute to the total or mark the estimate incomplete; an explicit zero is a known free expense. Completing an at-home item keeps its expense in the budget.
Changing a destination, departing city, or effective return city clears only affected travel plans, including their links and itinerary. Reordering destinations keeps unchanged connections.

## Daily miscellaneous spending
Edit a destination to enter optional arrival and departure dates, a daily miscellaneous amount, and its currency. The amount covers the whole party; changing the traveler count does not multiply it. Existing free-text stay notes remain available and are never interpreted as precise dates.

Arrival and departure each count as half a day, with full intervening days: a same-day visit is ½ day total, Monday–Tuesday is 1 day, and Monday–Thursday is 3 days. The editor previews the daily amount, budget days, and subtotal as you change the fields. Each destination card shows those values and its estimate; miscellaneous spending also has its own trip budget category.

Amounts use the currency's minor units (for example USD cents, whole JPY, or KWD thousandths). Half a minor unit is rounded up once per destination. Zero is a known amount; negative amounts are rejected. Clear the amount to mark it unknown; clear both amount and currency to remove both. A saved amount requires a currency. Missing amounts or incomplete dates keep the estimate partial, including when a zero amount has unknown duration.

Trip and destination totals group known amounts by currency. USD miscellaneous spending joins existing USD costs; other currencies remain separate. There is no currency conversion. Exact dates and miscellaneous settings persist in the same database and backups. Older databases upgrade to schema 10 without inferring dates from stay notes.

## Nightly hotel estimate
Edit a destination (or use **Edit estimate & dates** on its Hotels page) to enter a general nightly hotel amount and currency for all rooms and travelers. Exact arrival and departure dates determine nights: May 12–15 is 3 nights; a same-day visit is 0 nights. The general stay estimate is the nightly amount × nights. Changing dates or the nightly amount updates the preview, destination estimate, and trip totals. Free-text stay notes are never parsed as a night count.

With no hotel selected, the general stay estimate contributes to the budget. Selecting a hotel replaces it with that hotel's existing whole-stay USD price, counted once. Selecting, editing, unchecking, or deleting a hotel never overwrites the general estimate. Unchecking or deleting the selected hotel restores the saved estimate using the current dates. A selected hotel with an unknown price keeps accommodation unknown, even if a general estimate is saved.

The destination and Hotels page show the nightly amount, nights, general stay estimate, and which source supplies the accommodation total. Currency totals remain separate without conversion. Zero is intentional; negative amounts are rejected. An unknown night count or missing amount is shown as unknown, including a zero nightly amount without dates. Clear the amount to mark the estimate unknown; clear both amount and currency to remove both. General estimates and selections persist in the same database and backups.

## Activities budget
Each destination offers an explicit choice between **General budget** and **Itemized activity costs**. Use **Edit activities budget** on the Activities page, or edit the destination. New and existing destinations use itemized costs until you explicitly change the method.

The general amount and currency cover the whole party for the entire stay, counted once. Dates, stay notes, and traveler count never multiply or alter it. You can enter, edit, or clear it without creating activities. Zero is a known amount; negative amounts are rejected. A missing general amount is shown as **Not estimated** and keeps totals partial only while General budget is selected.

General budget mode excludes individual activity costs, including missing prices. Itemized mode uses only included activities and their existing whole-party USD prices; an included activity with no price keeps the estimate partial, while no included activities contributes zero. The saved general amount is excluded in itemized mode. Adding, selecting, editing, and removing activities never switches methods. Switching in either direction preserves the general amount, currency, activities, and their selections.

Destination cards, the Activities page, and trip totals show the active contribution. Different currencies stay separate without conversion. Method, general amount, and currency persist in the same database and backups. Schema 10 defaults older destinations to itemized without changing their calculations or saved ideas.

## At home
Each trip has an **At home** section below **Between the places**, even before destinations are added. Add, edit, or delete arrangements such as house sitting, child care, pet care, or pausing mail. Each item has a name, notes, an optional total price in USD, and a completion checkbox. Completed items can be reopened and remain visible. Items and expenses belong only to their trip and are included in backups.

## City suggestions
The Departing city, optional Return city, and City or destination fields use the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with location data from [GeoNames](https://www.geonames.org/). Suggestions are optional; manually entered cities still work. Searches of at least two characters are sent through `/api/locations`; adding a state or country (for example `Wooster, OH`) narrows results.

Destinations display as city and country, or city and state for US locations. Suggestions retain region details to distinguish same-named cities. Full selected labels remain stored so this display change and unchanged edits preserve travel plans; recognized older city/region/country labels are shortened on screen, while custom text remains supported.

The provider needs no key for this personal, non-commercial app. Its [free-service terms](https://open-meteo.com/en/terms) currently allow fewer than 10,000 calls per day, 5,000 per hour, and 600 per minute; commercial use needs a suitable plan or another provider. Lookup uses a four-second timeout, shares simultaneous matching queries, and keeps up to 200 queries in memory for ten minutes. The provider and response mapping live in `src/lib/location-search.ts`; no coordinates or extra location metadata are stored with a trip.

## Routes, itineraries, and research links
Trips return to their departing city by default. Select **Return to a different city** to enter a separate endpoint. Existing trips retain their departure location and default return behavior.
Each travel connection supports up to 30 ordered layovers or stops, with a place, arrival/departure details, and notes. The connection's estimated price covers the whole itinerary and is counted once in the trip budget.
Connections and hotel/activity/restaurant ideas support up to 20 research links with optional short descriptions. Existing single links are retained during the additive database upgrade. Older schema versions upgrade to version 10 automatically inside a transaction; take an online backup before deploying this upgrade.
## Images
Each destination can have one optional uploaded image. Each hotel, activity, and restaurant can have up to 10 photos, with one selected as the main photo on its card. Click the thumbnails to view the other photos. Add photos, choose the main photo, or remove individual photos in the editor; removing the main photo selects another remaining photo. Cancel discards photo changes. Existing single idea images become the main photo automatically.
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
