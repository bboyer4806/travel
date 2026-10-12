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
Prices are entered in USD for the entire traveling party. Hotel prices cover the whole stay; restaurant prices cover one meal.
The estimate sums every travel leg, one selected hotel per destination, activities/restaurants included in the plan, and entered at-home expenses.
Missing travel and selected-idea prices are unknown rather than zero. Alternatives stay saved without contributing to the budget. At-home items have optional prices: a blank price does not contribute to the total or mark the estimate incomplete; an explicit zero is a known free expense. Completing an at-home item keeps its expense in the budget.
Changing a destination, departing city, or effective return city clears only affected travel plans, including their links and itinerary. Reordering destinations keeps unchanged connections.

## At home
Each trip has an **At home** section below **Between the places**, even before destinations are added. Add, edit, or delete arrangements such as house sitting, child care, pet care, or pausing mail. Each item has a name, notes, an optional total price in USD, and a completion checkbox. Completed items can be reopened and remain visible. Items and expenses belong only to their trip and are included in backups.

## City suggestions
The Departing city, optional Return city, and City or destination fields use the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with location data from [GeoNames](https://www.geonames.org/). Suggestions are optional; manually entered cities still work. Searches of at least two characters are sent through `/api/locations`; adding a state or country (for example `Wooster, OH`) narrows results.

Destinations display as city and country, or city and state for US locations. Suggestions retain region details to distinguish same-named cities. Full selected labels remain stored so this display change and unchanged edits preserve travel plans; recognized older city/region/country labels are shortened on screen, while custom text remains supported.

The provider needs no key for this personal, non-commercial app. Its [free-service terms](https://open-meteo.com/en/terms) currently allow fewer than 10,000 calls per day, 5,000 per hour, and 600 per minute; commercial use needs a suitable plan or another provider. Lookup uses a four-second timeout, shares simultaneous matching queries, and keeps up to 200 queries in memory for ten minutes. The provider and response mapping live in `src/lib/location-search.ts`; no coordinates or extra location metadata are stored with a trip.

## Routes, itineraries, and research links
Trips return to their departing city by default. Select **Return to a different city** to enter a separate endpoint. Existing trips retain their departure location and default return behavior.
Each travel connection supports up to 30 ordered layovers or stops, with a place, arrival/departure details, and notes. The connection's estimated price covers the whole itinerary and is counted once in the trip budget.
Connections and hotel/activity/restaurant ideas support up to 20 research links with optional short descriptions. Existing single links are retained during the additive database upgrade. Older schema versions upgrade to version 7 automatically inside a transaction; take an online backup before deploying this upgrade.
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
