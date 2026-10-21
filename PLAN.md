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

## Added scope: destination images, October 9, 2026
- Add one optional image per destination, displayed on its destination card in the trip.
- Upload, preview, replace, or remove images in the destination editor; Cancel discards the draft.
- Keep images in persistent storage and backups; adding or changing an image preserves existing travel plans and prices.

## Added scope: idea images, October 10, 2026
- Give each hotel, activity, and restaurant one optional image displayed on its idea card.
- Reuse destination upload, preview, replacement, removal, and cancellation behavior.
- Persist these images in the shared database and backups while preserving prices, budget selections, research links, and existing destination images.

## Added scope: idea photo galleries, October 11, 2026
- Allow up to 10 photos for each hotel, activity, and restaurant; keep one optional photo for destinations.
- Show the selected main photo on the idea card, with thumbnails to view the other photos.
- Add multiple photos, select a main photo, and remove individual photos in the editor. Removing the main photo selects another remaining photo; Cancel discards the draft.
- Accept JPEG, PNG, and WebP files up to 5 MiB each, with up to 15 MiB of new files per save. Validate the whole upload batch before saving changes.
- Retain existing single idea images as the main photo during the schema 6 migration. Persist all photos and their main selections through backups and container replacement.
- Preserve prices, research links, budget selections, and destination images. Changes to an idea without photo changes preserve its gallery.

## Added scope: at-home planning, October 12, 2026
- Add an At home section beneath Between the places on each trip, including trips with no destinations.
- Create, edit, delete, complete, and reopen household arrangements such as house sitting and child care. Store a name, notes, and an optional total price in USD.
- Include entered prices in an At home budget subtotal and the trip estimate. Blank prices are optional tasks, not missing estimates; completion preserves expenses.
- Keep these items with their trip, preserve them across restarts and backups, and remove them when the trip is deleted.
- Upgrade existing data to schema 7 without changing travel plans or photo galleries.

## Added scope: daily miscellaneous spending, October 20, 2026 (TRA-25)
- Add optional explicit arrival and departure dates per destination; preserve existing stay notes without parsing them as dates.
- Enter, edit, or clear a daily miscellaneous amount and currency for the whole party. Zero is valid; negative amounts are rejected.
- Count arrival and departure as half days, intervening days as full days, and a same-day visit as half a day total.
- Preview daily amounts, budget days, and subtotals; include miscellaneous as a separate category in destination and trip estimates.
- Store integer currency minor units and round half a minor unit up per destination. Group totals by currency; no exchange-rate conversion is introduced.
- Keep missing amounts or unknown durations visibly incomplete. Changing dates or amounts recalculates totals; changing traveler count does not multiply spending.
- Upgrade databases to schema 8 with nullable destination fields, preserving previous trips, ideas, travel plans, images, and at-home items.

## Added scope: nightly hotel estimates, October 20, 2026 (TRA-24)
- Save a general nightly hotel amount and currency per destination for all rooms and travelers.
- Reuse explicit arrival/departure dates to calculate calendar nights; same-day visits have zero nights. Show unknown duration without parsing stay notes.
- Show the nightly estimate, nights, stay total, and the source of the accommodation budget in the destination and Hotels page.
- Use the general estimate until a hotel is selected, then use that hotel's whole-stay price once. Unchecking or deleting the chosen hotel restores the saved estimate using current dates.
- Preserve the general estimate through hotel selection changes. Keep zero distinct from missing, reject negative values, and group currency totals without conversion.
- Upgrade to schema 9 with nullable hotel amount and currency fields; retain previous dates, miscellaneous amounts, selections, and other saved data.
