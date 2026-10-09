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
The estimate sums every travel leg, one selected hotel per destination, and activities/restaurants included in the plan.
Missing prices are unknown rather than zero. Alternatives stay saved without contributing to the budget.
Changing a destination, departing city, or effective return city clears only affected travel plans, including their links and itinerary. Reordering destinations keeps unchanged connections.

## City suggestions
The Departing city, optional Return city, and City or destination fields use the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with location data from [GeoNames](https://www.geonames.org/). Suggestions are optional; manually entered cities still work. Searches of at least two characters are sent through `/api/locations`; adding a state or country (for example `Wooster, OH`) narrows results.

Destinations display as city and country, or city and state for US locations. Suggestions retain region details to distinguish same-named cities. Full selected labels remain stored so this display change and unchanged edits preserve travel plans; recognized older city/region/country labels are shortened on screen, while custom text remains supported.

The provider needs no key for this personal, non-commercial app. Its [free-service terms](https://open-meteo.com/en/terms) currently allow fewer than 10,000 calls per day, 5,000 per hour, and 600 per minute; commercial use needs a suitable plan or another provider. Lookup uses a four-second timeout, shares simultaneous matching queries, and keeps up to 200 queries in memory for ten minutes. The provider and response mapping live in `src/lib/location-search.ts`; no coordinates or extra location metadata are stored with a trip.

## Routes, itineraries, and research links
Trips return to their departing city by default. Select **Return to a different city** to enter a separate endpoint. Existing trips retain their departure location and default return behavior.
Each travel connection supports up to 30 ordered layovers or stops, with a place, arrival/departure details, and notes. The connection's estimated price covers the whole itinerary and is counted once in the trip budget.
Connections and hotel/activity/restaurant ideas support up to 20 research links with optional short descriptions. Existing single links are retained during the additive database upgrade. Schema versions 1 and 2 upgrade to version 3 automatically inside a transaction; take an online backup before deploying this upgrade.
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
