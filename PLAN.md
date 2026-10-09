# Travel planner: first-version plan

Approved direction: a shared travel-ideas planner with manually entered prices in USD for the entire traveling party.

## Pages and navigation
- Home lists potential trips: user-created name, ordered cities, general date, and estimated budget. Create, edit, and delete trips.
- A trip landing page shows notes, home location, ordered destinations, transportation, and budget breakdown. Add, edit, remove, and reorder destinations.
- Each destination links directly to separate Hotels, Activities, and Restaurants pages.
- Each category supports create, edit, and delete, with names, estimated prices, optional addresses, website links, and notes.

## Data
- Trip: name, general date (for example Spring 2027), home city, traveler count, notes.
- Destination: city, position, optional dates or length of stay, notes.
- Travel leg: origin and destination, transportation method, estimated total cost, optional departure/arrival details, research link, notes.
- Candidate: hotel/activity/restaurant, name, estimated total cost, optional address, link, notes, and inclusion in budget.
- Exact dates and prices may remain undecided.

## Route
Generate Home -> first destination -> subsequent destinations -> Home.
Each connection has editable travel details, which can also be cleared.
Preserve details for unchanged connections when destinations change; new connections need review.
Deleting a destination removes its candidates and obsolete connections after confirmation.

## Budget
Sum all travel legs, one selected hotel per destination, and activities/restaurants marked Include in budget.
Do not sum competing hotel alternatives or unselected ideas.
Every price covers the entire party: the whole hotel stay, one activity, one meal, or one travel segment.
Missing prices are unknown, not zero; show Not estimated or an incomplete estimate as appropriate.
Reject negative or invalid prices; store money as integer cents.

## Access and persistence
No sign-in in v1. Anyone with the app link can view, create, edit, and delete.
Use a shared, server-side persistent database, accessible across devices and preserved across deployments.
Keep the existing Docker/Dokku hosting. Persistent database storage must be configured before production deployment.
Responsive interface, useful empty states, deletion confirmations, visible save errors and pending states.

## Implementation
1. Set up the application and persistent storage.
2. Build home/trip pages, destinations, and travel plans.
3. Add hotel, activity, and restaurant management.
4. Connect budget calculations and polish the interface.
5. Test a two-destination trip, three travel legs, all CRUD flows, totals, reordering, and persistence.
Build on a separate branch and review the working app before merging into automatically deployed main.

## Acceptance checks
- Create a trip and two destinations; see home-to-first, first-to-second, second-to-home travel.
- Adding an unselected hotel does not increase the estimate; selecting another replaces the previous hotel.
- Included items and travel update the trip and home-page totals.
- Unknown prices remain visibly incomplete; entered zero is a valid known cost.
- Reordering/removing stops never attaches a travel plan to the wrong connection.
- All entity types support creation, editing, and deletion/clearing.
- Data survives refresh and process restart; production storage survives replacement containers.
- Forms support keyboard interaction, mobile widths, and meaningful errors.

## Later iterations
Live price search, booking integrations, maps, detailed daily itineraries, currency conversion, accounts and access controls.

## Implementation choices
Next.js with TypeScript and a single SQLite database using Node 24's built-in SQLite support.
SQLite lives outside the application image on a Dokku storage mount.
Use one application instance for v1. Live deployment remains a separate review step.

## Added scope: October 8, 2026
- Use location suggestions for departing city, return city, and destinations; allow manual entry.
- Rename Home city to Departing city. Return there by default; a checkbox enables a separate return city.
- Each connection can have an ordered itinerary of layovers and points of interest, with place, timing, notes, and controls to add, edit, remove, and reorder stops.
- Keep one total estimated price per connection, including its itinerary stops.
- Support multiple research links with short descriptions on travel connections and all destination idea categories; retain existing saved links.
- Upgrade stored trips without changing their routes or losing details. Clear only the affected connection when an endpoint changes.
