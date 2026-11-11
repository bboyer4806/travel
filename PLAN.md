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

## Added scope: destination activities budgets, October 21, 2026 (TRA-29)
- Save a general activities amount and currency for the whole party's entire destination stay, independent of dates and traveler count.
- Explicitly choose General budget or Itemized activity costs. General mode counts the amount once; itemized mode uses included activity prices. Never count both sources.
- Preserve the general amount and activities through method changes. Activity changes never switch methods.
- Show the method and applicable contribution in destination and trip totals, with currencies kept separate and missing amounts distinct from zero.
- Upgrade to schema 10 with an itemized default for existing and new destinations; preserve prior budgets, ideas, selections, images, and routes.

## Added scope: daily food budgets, October 21, 2026 (TRA-38)
- Save a daily food amount and currency for the whole party, independently of restaurant entries.
- Explicitly choose Daily food budget or Itemized restaurant costs. Default existing and new destinations to itemized; never count both sources.
- Reuse explicit dates and miscellaneous half-day allowances: same-day ½ day, Monday–Tuesday 1 day, Monday–Thursday 3 days. Round half a minor unit up once per destination.
- Show daily amount, budget days, subtotal, and active food contribution. Recalculate when dates or amounts change; never multiply by traveler count or parse stay notes.
- Preserve daily settings, restaurant entries, and selections through method changes. Restaurant changes never switch methods.
- Keep currency totals separate without conversion and distinguish zero, missing amounts, and unknown duration. Upgrade to schema 11 while preserving all earlier data and budgets.

## Added scope: destination shopping budgets, October 26, 2026 (TRA-43)
- Save an optional shopping amount and currency per destination for the whole party’s entire stay, without shop or purchase records.
- Count the amount once in destination and trip totals as Shopping, separately from miscellaneous spending. Dates, stay notes, and traveler count never multiply or change it.
- Allow entering, editing, and clearing. Show an unset budget as Not set with no cost or required missing estimate; accept and display intentional zero, reject negative or invalid amounts.
- Keep currency totals separate without conversion. Persist amounts and currencies through saving and reopening.
- Upgrade to schema 12 with nullable fields, preserving earlier data and calculations; verify additive migration replay and container persistence.

## Added scope: destination typical weather, October 27, 2026 (TRA-13)
- Record optional typical high and low temperatures in Fahrenheit, rainfall notes, the applicable month or travel period, and a source name or link.
- Display typical weather or historical averages on destination detail pages, separate from the trip overview; provide a focused editor with save, edit, and clear behavior.
- Accept negative and decimal temperatures, require high to be at least low when both are supplied, and distinguish missing values (Not provided) from zero.
- Preserve weather and its recorded period across date changes, other destination edits, database reopening, and backups. No automatic lookup or Celsius conversion.
- Upgrade to schema 13 additively, preserve prior data and budgets, and verify migration replay and container persistence.

## Added scope: destination Church section, October 28, 2026 (TRA-12)
- Add an optional Church section after Restaurants on destination detail pages, excluded from the trip overview, idea counts, and budget calculations.
- Allow manual enabling for any destination, including undated stays. Automatically enable when the actual merged arrival/departure range changes to include a Sunday, counting both endpoints and multiple Sundays.
- Allow hiding without deleting data. Unrelated edits and unchanged date saves preserve manual hiding; a new Sunday-containing range enables the section again. Missing dates and ranges without Sunday preserve visibility and saved information.
- Create, edit, and remove multiple churches with name, location/address, optional denomination and website, and multiple Mass times associated with a day or date. Display unknown Mass times clearly and supplied websites as links.
- Reuse galleries with up to 10 photos, a selected main photo, existing upload limits and processing, and ownership validation. Preserve photos on ordinary edits, hiding, date changes, reopening, and backup.
- Upgrade to schema 14 with separate church and image records and destination visibility. Initialize Sunday visibility only when adding the column; migration replay retains saved choices. Preserve all previous budgets, weather, and other data and verify container persistence.

## Added scope: Travel 1.2, October 29, 2026 (TRA-57–TRA-65)
The current Jira sprint supersedes earlier date, currency, weather-placement, and Church-visibility rules above and the earlier refinement draft.

- TRA-57: global feedback sheet, 2,000-character message, server-side Jira Task creation in TRA with user-feedback label and page/browser context; preserve drafts on failure, prevent duplicate pending submissions, 10-second timeout, invisible abuse protection, and local stand-in testing only.
- TRA-58: What's new page with published version/date/bullets and browser-local unread status. Actual visits mark seen; prefetch does not. Do not advertise unshipped changes.
- TRA-59: USD throughout, exact cents, no currency selectors. Preserve USD data and fail safely on unexpected non-USD data without conversion or relabeling.
- TRA-60: general hotels use nights; daily food and miscellaneous use nights except zero nights uses one full day. Fixed budgets and selected source modes remain intact.
- TRA-61: one trip start date and ordered destination nights derive all destination ranges/weekdays and the trip end. Incomplete inputs leave affected dates incomplete. No manual destination date overrides, automatic gaps, or travel-leg date scheduling. Conservatively backfill consistent structured dates, preserve legacy values, and prompt on ambiguity; migration replay preserves edits.
- TRA-62: one destination Save in a sticky header, with errors and pending state kept visible.
- TRA-63: category links and counts beside corresponding budget headings; Shopping edit beside its own heading.
- TRA-64: Typical weather summaries on main trip destination cards only, retaining the editor and saved data.
- TRA-65: Church on main destination cards, eligible with unknown dates or an inclusive Sunday. Manual hiding persists through schedule changes. Known non-Sunday ranges cannot be overridden; shared Sunday transfers make both destinations eligible. Preserve existing direct URLs and data; remove Church category tabs.

Validate duration boundaries, missing inputs, source modes, migration/replay/backup, feedback failure and duplicate protection, browser behavior, and mobile editor saving. Review implementation separately from live deployment. Configure production Jira and rehearse schema 15 on a production backup before releasing; close the release with verified change-log entries.

## Added scope: Travel 1.3, October 29, 2026 (TRA-10, TRA-22, TRA-23, TRA-28, TRA-30, TRA-34, TRA-37, TRA-66)
- TRA-10: add a saved Must do priority to activities and restaurants, editable on cards and in the editor. Keep it independent of budget inclusion, source modes, prices, and ordering.
- TRA-22, TRA-28, TRA-34: put each category's Add button after its ideas, retaining the existing creation flow and an available button for empty lists on desktop and mobile.
- TRA-23, TRA-30, TRA-37: allow keyboard and touch accessible Up/Down ordering within each destination's Hotels, Activities, and Restaurants list. Persist order across reopening, append new ideas, and retain positions during edits.
- Schema 16 adds candidate positions and Must do flags. Initialize positions in the previous alphabetical order only when the column is first added; replay preserves choices. Preserve galleries, links, selections, budgets, and routes. Verify upgrade, replay, backup, and container persistence.
- TRA-66: the What's new page and unread indicator already shipped in Travel 1.2 (TRA-58). Reuse that implementation; publish 1.3 notes only after deployment is verified at release close.

Review this implementation separately from live deployment. Back up and rehearse schema 16 before release.

## Added scope: Travel 1.4, November 3, 2026 (TRA-15, TRA-52, TRA-67, TRA-71, TRA-72)
- TRA-15: manually maintain destination entry requirements, passport nationality, purpose and circumstances, visa/electronic authorizations, passport validity, entry/health documents, transit requirements, notes, official source links, and last checked date. Show current schedule for reference, distinguish missing information from no requirements, and remind travelers to verify official sources. Dedicated edits preserve unrelated data; no automatic lookup or eligibility decisions.
- TRA-52: destination galleries with up to 10 photos, thumbnails, a primary photo, removal, and accessible Move left/Move right ordering. Preserve existing destination images as primary, existing upload limits, versioned delivery, persistence, and other category galleries. Cancel discards draft changes; removing primary selects the first remaining photo.
- TRA-67: display every inclusive Sunday date in the existing Church section, updating with calculated schedules. Preserve eligibility, manual hiding, churches, and Mass times; unknown dates do not imply a Sunday or verified services.
- TRA-71: upgrade Next.js and matching ESLint configuration to exactly 16.4.5 (the approved ticket description supersedes its older 16.4.4 title). Verify frozen installation, audit, Server Actions, image handling, and existing quality gates.
- TRA-72: focused Weather, Shopping, Food, and Activities saves omit unrelated destination fields and preserve the latest database values and travel plans. Main-editor city renaming retains the existing connection-clearing behavior.
- Schema 17 upgrades destination images to ordered galleries; schema 18 adds destination-owned entry requirements. Preserve old data, replay safety, backups, and container persistence. Back up and rehearse on a copy before release; earlier builds reject the newer schema.

Review implementation separately from live deployment. Publish 1.4 change-log entries only after deployment and release verification.

## Added scope: November 4, 2026, Travel 1.5
- Improve page and save performance using scoped SQLite reads, compact mutation responses, trip-specific date refresh, and stable home budget summaries.
- Fix page metadata, misleading wording, long-name wrapping, and the What's New unread flash.
- Extend the production container smoke test to render a page, load an asset, and create/delete via the normal server action.
- Disable unused Next.js image optimization without changing the existing image APIs.
- Automate encrypted daily off-host backups to an always-on Windows 11 PC via Tailscale and SSH, retain 30 days, validate transferred backups, and block deployment if the required backup fails. Provisioning the server and computer is a separate administrator task.

## Added scope: November 9, 2026, Google Sign In (TRA-103)
This supersedes the v1 "No sign-in" access rule above. On November 9, 2026, Brian chose to sign in the same way as Budget and Meals instead of the ticket's Auth.js plan.
- Require Google Sign In before any trip information, photo, city suggestion, feedback, What's new entry or change is available. Only the sign-in page, the Google sign-in routes and the health check are public.
- Sign in as Budget and Meals do: a hand-written OpenID Connect code flow with PKCE, `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` set on the server, a startup refusal without them, and sessions in Travel's own SQLite database. Travel keeps its own sessions and cookies even when the Google OAuth client is shared, so signing in to one app never signs in to another.
- Authorize only explicitly approved Google accounts: the designated owner from `TRAVEL_OWNER_EMAIL`, and emails a trip owner shares a trip with (TRA-104). Authorization is never granted by signing in first and persists after shared access is revoked. No self-registration, other providers, administration screens or notifications.
- Use Google's verified email and bind each authorization to the stable Google account identifier at first sign-in. Store no Google passwords or OAuth tokens, and only a hash of each session token.
- Keep sessions for 30 days from last use across navigation and refreshes, with an HttpOnly, SameSite=Lax cookie that is Secure and `__Host-` prefixed over HTTPS. Sign out in the header shows the signed-in account and ends the session on the server. Reject missing, expired, unknown or altered sessions in pages, Server Actions and data routes; explain refused, unverified, expired and failed sign-ins.
- Schema 19 adds the accounts and sessions tables without changing existing trips; both are included in backups. TRA-103 deploys on its own, before TRA-104, once the Google settings and initial owner are configured.

## Added scope: November 10, 2026, trip sharing (TRA-104)
This narrows the TRA-103 access rule: an authorized account now sees only the trips it owns or that are shared with it.
- Every trip has one owner. New trips belong to the account that creates them. Schema 20 assigns every existing trip to the designated owner, `TRAVEL_OWNER_EMAIL`, inside the upgrade transaction, never to whoever signs in first; replays and later changes to that setting never move ownership.
- Owners share individual trips by Google email, including with people who have never signed in; sharing authorizes the email, and the trip appears in their list at sign-in. Each email is invited to a trip once. No invitation emails, links or reminders.
- Shared accounts get full editing access to the trip's content, including photos. Only the owner deletes the trip, shares it, or removes access, from an owner-only Share dialog that lists current access and reports each result. No view-only or custom roles, ownership transfers, public links, real-time collaboration, or sharing management by editors.
- Removing access takes effect on the next request without changing trip data or the account's authorization. Pages, metadata, Server Actions, nested items and photo routes enforce access on the server, resolving each item's trip from saved data; an inaccessible trip is indistinguishable from a missing one.
- Schema 20 adds trip ownership and a `trip_shares` table, with database triggers that keep every trip owned. Backup, rollback and the upgrade rehearsal are in [deployment](docs/DEPLOYMENT.md).

## Added scope: November 11, 2026, collapsible typical weather (TRA-111)
- Each destination card's Typical weather section starts collapsed on every page load and expands or collapses on its own from a keyboard and touch accessible heading control. The heading and Edit typical weather stay visible and working in both states.
- Expanding shows the existing temperatures, period, rainfall notes, source, and explanation. Toggling stays in the page: it never changes saved weather, makes no server request, and is not remembered between visits. No changes to weather data, the editor, or other destination sections.
