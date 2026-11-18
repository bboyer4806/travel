# Travel planner: first-version plan

Approved direction: a shared travel-ideas planner with manually entered prices in USD for the entire traveling party.

## Added scope: Travel 1.8 review tickets, November 11, 2026 (TRA-73, TRA-80, TRA-91, TRA-94)
- TRA-73: verify the existing cross-bundle store validation recognition through `isValidationError`, preserving specific messages, image-upload validation, and generic handling of unexpected errors. Keep database behavior unchanged.
- TRA-80: enforce rolling process-wide city-search budgets of 300/minute, 2,500/hour, and 8,000/day; anonymous-cookie client limits of 20/minute and two concurrent requests; eight concurrent requests globally; and a 60-second cooldown after an upstream HTTP 429. Preserve cached results, shared requests, existing authentication, and manual city entry.
- TRA-91: hide empty feedback errors, translate invalid/non-JSON responses into the existing friendly failure message, and allow manual Send retries after token preparation fails while retaining drafts and submission protections.
- TRA-94: use Next.js retry to re-fetch failed server data and remove the root streaming loading boundary so missing pages return 404 and server-rendering failures return 500. Preserve existing messages and health endpoint behavior.

Only these four sprint tickets whose titles start with **Review:** are included. No other Travel 1.8 features, schema changes, or dependency upgrades are part of this implementation.

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

## Added scope: November 11, 2026, collapsible entry requirements (TRA-110)
- Each destination card's Entry requirements section starts collapsed on every page load and expands or collapses on its own from a keyboard and touch accessible heading control. The heading, Add or Edit entry requirements, and Clear when requirements are recorded stay visible and working in both states.
- Expanding shows the existing current stay, recorded requirements, sources, last checked date, and explanatory notes. Toggling stays in the page: it never changes saved requirements, makes no server request, and is not remembered between visits. No changes to entry requirements data, fields, validation, adding, editing, clearing, or other destination sections.

## Added scope: November 11, 2026, shared destinations (TRA-105)
- A **Destinations** link in the header lists every destination the account owns or that a trip it can open visits, including destinations no longer in any trip, with search, idea counts and the trips that visit each. Each destination has its own page and Hotels, Activities, Restaurants and Church pages with its photos, notes, budget amounts, entry requirements, typical weather and churches.
- Each trip owner has one shared destination per city, matched on the full saved city name, so same-named cities in different states, regions or countries stay separate. Notes, photos, ideas and their selections (hotel choice, inclusion, Must do), churches and Church visibility, entry requirements, weather, and every budget amount, rate and method belong to the destination: an edit from Destinations or from any trip appears in every trip that visits it. A destination belongs to its trip's owner, and people a trip is shared with can see and change the destinations it visits.
- Each trip keeps its own order, stay notes, nights, calculated dates and travel connections for a destination, and each trip's estimate uses its own nights. Removing a destination from a trip, or deleting the trip, removes only that trip's stay; the destination and everything saved for it remain.
- Schema 21 combines each owner's existing destinations for the same city into one without losing research. Every idea, photo, church and note is kept. Amounts, methods and Church visibility are kept when the destinations agree or only one set them, and cleared when they differ. A list's idea selections are cleared when more than one of the destinations had selections in it. Additional weather and entry requirements are kept in the notes. Backup, rollback and the upgrade rehearsal are in [deployment](docs/DEPLOYMENT.md).
- Not included: creating a destination outside a trip (TRA-106), adding a saved destination to a trip (TRA-107; until then, adding a city the trip's owner already has is refused with a message), and deleting a destination.

## Added scope: November 11, 2026, collapsible destination budget (TRA-109)
- Each destination's Budget section starts collapsed on every page load and expands or collapses on its own from a keyboard and touch accessible Budget heading control. Both states show Accommodation, Activities, Food, Shopping, and Miscellaneous with their amounts, the Hotels, Activities, and Restaurants links, Shopping's editor, and the destination editor for Miscellaneous. On a trip's page, the stay's dates and the destination estimate also stay visible.
- Expanding shows the existing calculations, breakdowns, and explanatory notes. Amounts come from the existing budget calculations, including partial and missing estimates. Toggling stays in the page: it never changes saved data or calculations, makes no server request, and is not remembered between visits. No changes to budget calculations, the trip estimate, the Hotels, Activities, or Restaurants pages, or other destination sections.

## Added scope: November 12, 2026, destination health and safety (TRA-14)
- Each destination has a Health and safety section, separate from Entry requirements, on its trip destination cards and its page in Destinations. It holds manually maintained research: the government travel advisory level and warnings; health precautions, such as recommended vaccinations and medical precautions; local safety concerns, common scams, areas to avoid, and general safety guidance; up to 20 emergency contacts, each with a name, phone number, and optional notes; up to 20 official source links with descriptions; and a last checked date.
- Add, Edit, Save, Cancel, and Clear work as in Entry requirements, and Clear asks for confirmation. The section starts collapsed, as Entry requirements does. Unrecorded fields show as not recorded, without implying that a destination is safe or that no precautions are needed, beside a reminder to verify with official sources before travel.
- The last checked date is entered by hand: saving never sets or changes it, and research is never flagged as outdated because of its age.
- Research belongs to the destination and is shared by every trip that visits it, like entry requirements. It is kept through schedule and other destination changes, when the destination leaves a trip or its trip is deleted, and in backups. Schema 22 adds its destination-owned table.
- Not included: retrieving advisories, health information, or contacts from any service; monitoring, notifications, or alerts; age-based warnings; medical advice, vaccination eligibility, or risk assessments; and changes to Entry requirements, budgets, or scheduling.

## Added scope: November 12, 2026, destinations outside a trip (TRA-106)
- **New destination** in Destinations saves a city to research before planning a trip, without adding it to any trip. It uses the existing city search unchanged, requires only a city, and opens the destination's page, where hotels, activities, restaurants, churches, photos, notes, budget amounts and research are added and edited as for any destination.
- Choosing a city the account already has a destination for, in a trip or not, opens that destination instead of saving a duplicate. Cities match as in TRA-105, so same-named cities in different regions stay distinct. A destination created this way belongs to the account that creates it, never to another account whose destination for the city it can see through a shared trip.
- The owner of a destination that no trip visits can permanently delete it, with everything saved for it, after confirming. A destination any trip visits can't be deleted: the server refuses it, and its page offers no delete. People a trip is shared with can't delete destinations.
- Not included: adding a saved destination to a trip (TRA-107; until then, adding a city the trip's owner already has, including one created in Destinations, is refused with a message), schema changes, changes to the shared destination model or location search, and retrieving research from other services.

## Added scope: November 12, 2026, transportation icons (TRA-112)
- Each connection in Between the places shows an icon for each kind of transportation its saved Transportation text names, instead of always an airplane: once per kind, in the order entered. Terms match as complete words or phrases in any capitalization: airplane (flight, airplane, flying, air, jet), train (train, rail, subway, tram), car (car, driving, rental car, taxi, rideshare, road, Uber, Lyft), bus (bus, coach, shuttle), boat (boat, ferry, cruise, ship, sea, water), walking (walking, on foot), and bicycle (bike, bicycle, cycling).
- Blank or unrecognized text shows a generic route icon. The icons stay in the connection's existing layout on phones, have an accessible description naming each kind shown, and follow the saved value after each edit.
- Not included: changes to the free-text Transportation field, stored data or the schema, detecting transportation from maps or other services, other icons, and travel costs, schedules or itineraries.

## Added scope: November 12, 2026, section-specific destination editors (TRA-113)
- Each Edit control inside a destination section opens an editor titled for that section with only its fields. Hotels' **Edit estimate & nights** opens the trip stay's nights and the general nightly hotel estimate, with previews of the stay's dates and estimate; in Destinations, **Edit nightly estimate** opens the nightly estimate alone. **Edit miscellaneous budget** opens the daily miscellaneous amount with its subtotal preview, and a trip Restaurants page's **Edit destination nights** opens the stay's nights with a preview of its dates. Activities, Food, and Shopping keep their editors, and **Edit destination** and each trip destination card's edit control still open the complete destination editor.
- Saving a section's editor changes only its fields, as the existing focused editors do, with their Save, Cancel, validation, and error handling. Changed nights recalculate dates and budget totals with the existing rules.
- Not included: redesigning the complete destination editor, budget calculation changes, schema or stored data changes, and changes to trip, transportation, idea, or other forms outside destination budget editing.

## Added scope: November 12, 2026, edit modal buttons (TRA-114)
This replaces TRA-62's destination Save in a sticky header.

- Every edit modal keeps its X in the top-right corner of the header, and **Cancel** on the left and its one Save or confirming action on the right in a footer that stays at the bottom while the fields scroll. Pending state and save errors stay in view above those buttons. The header has no Save or Send feedback.
- The standard **Send feedback** button stays in the bottom-right corner above an open editor's backdrop, and the editor ends above it on every screen size so neither covers the other. Feedback opens over the editor without closing it; closing or sending it returns to the editor with its entries and focus.
- Not included: changes to feedback submission, form fields, validation rules, saving, or dialogs other than the edit modals.

## Added scope: November 12, 2026, editor first-field focus (TRA-116)
- Opening any editor focuses its first field instead of the X: for example the trip name, **City or destination**, Passport nationality, Travel advisory level, Typical high, a budget amount or method, Nights, or an idea's Name. Closing it still returns focus to the control that opened it.
- City suggestions open when the person types in a city field or presses the Down or Up arrow, not when the field gets focus. A destination editor that opens on a saved city shows no list, and one Escape closes it.
- Confirmations without fields, such as removing a destination, are unchanged.
- Not included: changes to fields or their order, how cities are searched or chosen, validation, saving, or the Send feedback dialog.

## Added scope: November 13, 2026, trip tags (TRA-17)
- People can add custom text tags, such as Europe, Beach or Family vacation, to a trip directly on its page without opening Edit trip, give a trip any number of tags, and remove one tag at a time without changing the trip. A tag is up to 40 characters, and names that differ only in letter case or spacing are the same tag, so a trip has each tag once.
- Tags are reusable: a trip's page suggests the tags on every trip the account can open, and a tag added there takes the spelling the same tag already has on such a trip. Tags only on trips the account can't open are never suggested, filtered by, or used for a spelling.
- Tags follow trip sharing: everyone with access to a trip sees and changes its tags, and the server authorizes tag changes as it does every other trip change. Tags persist, appear on trip cards and the trip's page, and deleting a trip deletes its tags without affecting other trips' tags.
- The trip list filters by any number of selected tags, showing only trips with every selected tag, combined with the existing search so both must match. Each filter can be removed on its own, and Clear tag filters removes them all while keeping the search.
- Schema 23 adds a `trip_tags` table, one row per trip and tag, deleted with its trip. Existing trips start without tags. Backup and rollback are in [deployment](docs/DEPLOYMENT.md).
- Not included: a screen for renaming or deleting tags across trips, tag colors, icons or hierarchies, searching by tag text, and separate tag permissions or other changes to sharing.

## Added scope: November 13, 2026, saving after a deploy (TRA-74)
- Every image is built with the same Server Actions key, the `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` deploy secret, so the save action keeps its ID across deploys and a page opened before a deploy can still save. A deploy without the secret stops before building.
- When a save reaches a server that doesn't recognize its action, because the key or the action itself changed, the save error says the planner was updated and asks for a reload, instead of the connection error that retrying never cleared. An open editor keeps its entries until the page reloads.
- Not included: keeping unsaved changes across a reload, announcing a new version before saving, reloading automatically, and changes to other save errors.

## Added scope: November 13, 2026, saving again after a lost response (TRA-75)
- Each editor that adds a trip, destination, idea, church or At home item gives the new item its ID once, when it opens, and sends it with every save. The server adds the item when no item has that ID and treats the same ID sent again as the same item, saving the details sent last, so saving again after a lost response never adds a second one. Photos a save already added to an item are kept once when it is sent again.
- A change to an item that no longer exists is still refused, never recreated, and a new item's ID can't save over another item.
- A save whose response doesn't arrive says the changes couldn't be confirmed, instead of saying they weren't saved.
- A page opened before this change adds items without IDs. Adding from it saves nothing and shows TRA-74's message asking for a reload, while its changes to saved items keep working.
- **New destination** in Destinations already opens the saved destination for a city it has, so it is unchanged.

## Added scope: November 13, 2026, inline action errors (TRA-82)
- When a change made without an editor fails, such as moving a destination or an idea, Include, Must do, Mark complete, Show or Hide Church, or adding or removing a tag, its error appears in an alert fixed at the bottom of the screen at every screen size, wherever the page is scrolled, instead of after the page's last section. It sits above **Send feedback** so neither covers the other, and stays until it is dismissed or another change starts.
- Editors still show their errors above their Save and Cancel buttons.
- Not included: changes to error messages, the success message, or saving.

## Added scope: November 13, 2026, reporting database errors (TRA-93)
- A save that SQLite has already rolled back, as when the disk is full, reports and logs SQLite's own error, such as `database or disk is full`, instead of the error from rolling back a second time. It saves nothing, and saving works again once there is room.
- Opening the database closes its connection whenever the open fails: before the upgrade begins, as for a file that isn't a database or a write lock another process holds past the 5-second wait, or during the upgrade. Failed opens no longer leave connections open.
- Not included: shortening the 5-second wait for another process's write lock, so each try to open the database still waits that long while the lock is held; remembering a failed open between requests; and changes to the save errors people see.

## Added scope: November 13, 2026, adding saved destinations to a trip (TRA-107)
- **Add destination** on a trip's page uses the existing city search and asks only for the city. When the trip's owner already has a destination for the city, created in Destinations, researched for another trip, or removed from this trip, the trip visits that shared destination without copying it: its hotels, restaurants, activities, research, photos, selections and budgets stay shared by every trip that visits it. Any other city becomes a new destination of the trip's owner. Cities match as in TRA-105, and a destination added by someone the trip is shared with is the owner's, as in TRA-105.
- The new stop joins the end of the route with nights and stay notes unset, to be entered or edited later. Dates, nights, order and travel connections stay each trip's own, and the route reconnects as it does when any destination is added at the end.
- A city the trip already visits isn't added again: the page shows its existing stop instead, so adding a city again after a lost response adds it once. A trip the schema 21 upgrade left visiting a city twice shows its first stay there.
- Removing a destination from a trip keeps its shared research and the other trips' stays; adding the city again brings it back as a new stay.
- A page opened before this change adds destinations with the full destination editor. Adding from it saves nothing and shows TRA-74's message asking for a reload.
- Not included: schema or shared destination model changes, copying research into separate trip records, more than one visit to a city within a trip, and setting nights, dates or travel arrangements automatically. Nights, stay notes, budget amounts, photos and notes are entered after a destination is added, with its existing editors.

## Added scope: November 13, 2026, ChatGPT and Claude access to production data (TRA-115)
- An MCP endpoint, `/api/mcp`, for ChatGPT and Claude, each connected separately through OAuth 2.1 as the MCP specification describes: dynamic client registration, PKCE, Travel as its own authorization server, and access tokens tied to one revocable connection. Only Claude's and ChatGPT's own OAuth callbacks can be registered, and only the designated owner (`TRAVEL_OWNER_EMAIL`), signed in with Google, can allow a connection.
- Assistants read every trip, destination and account, whoever owns them, through allowlisted tools, never SQL, and never Google account identifiers, sessions, codes or tokens.
- Assistants propose changes, as the planner's own changes checked by its own rules, to any trip or destination, including deleting trips and changing sharing. Nothing changes until the designated owner approves the proposal on Travel's proposal page, which lists every record each change adds, changes or deletes, before and after. Approving makes every change and records the approval in one transaction, exactly as previewed or not at all; proposals can't be altered, expire after 24 hours, and are decided once. Ordinary accounts' permissions are unchanged.
- Owner-only pages: AI assistants (connections, with revoke, and proposals), the connection consent page and each proposal's page. Schema 24 adds the integration's own tables.
- Not included: other assistants, development or staging integrations, photo changes through an assistant, arbitrary SQL or schema changes, returning to the consent page after signing in, and connections for anyone but the designated owner.

## Added scope: November 14, 2026, At home price without arrows (TRA-46)
- The Estimated price field in the At home editor has no increment and decrement arrows, when adding an item or editing one. People type the price, with cents if needed, such as 12.50, and change or clear it as before.
- Only the arrows go: the field keeps its validation, from $0 to $100,000,000 in whole cents, the Up and Down keys still step it, and saving and saved prices are unchanged.
- Not included: other price fields, including connections (TRA-49), changes to validation, precision, stored data or budget totals, and other changes to the At home editor.

## Added scope: November 14, 2026, save messages clear of Send feedback (TRA-84)
- A save's message appears above **Send feedback** at every screen size, where the errors of changes made without an editor appear, so neither covers the other and its X closes it. Before, on phones and narrow windows, Send feedback covered the message's X and selecting it opened the feedback form.
- The message closes itself after five seconds. Errors still stay until they are dismissed or another change starts (TRA-82).
- Not included: changes to the messages or errors themselves, the errors' timing, or Send feedback.

## Added scope: November 14, 2026, keyboard focus after changes (TRA-86)
- Changes made without an editor return keyboard focus to the control used once the page shows the change, so Enter repeats it: destination arrows, an idea's Up, Down, Must do and budget selection, Mark complete and Reopen, and Show Church and Hide Church. A destination or idea moved to the first or last place focuses its other arrow, and Show Church and Hide Church focus the one that replaces them. A failed change leaves focus on its control, and focus the person moves elsewhere during a save stays there.
- In editors, removing a Mass time or photo focuses the next one's Remove, or Add Mass time or Add photos after the last. Undo photo changes focuses Add photos, or the last photo's Remove when the saved photos fill the gallery. A destination photo or travel stop moved to the first or last place focuses its other move control.
- Ideas returned focus as soon as their save ended, before the page showed the new order, so an idea moved to the first or last place could still lose focus. They now share the timing above.
- Not included: removing a tag, added after this review, and controls that already kept focus, such as research links and adding or removing a travel stop.

## Added scope: November 14, 2026, destination idea carousels (TRA-120)
- Each destination card on a trip's page, and each destination's page in Destinations, shows Hotels, Activities and Restaurants sections directly below its budget, each with its idea count. They start expanded each time the page loads and open and close independently, saving nothing.
- Each section has a carousel with left and right arrows and a card for each idea: its main photo, or an icon without one, its name and its price. Ideas chosen for the budget come first, marked as on their full pages, then the rest, each group in its saved order.
- Selecting a card opens the idea's details, read only and laid out like its editor. **Edit** opens the editor; saving returns to the details once they show what was saved, and Cancel returns to them without saving.
- Each section has **Edit budget**, opening the existing accommodation, activities or food budget editor, an **Add** button opening the existing editor for a new idea, and a **Manage** link to the category's full page, which keeps reordering, Must do, choosing or including, and deleting ideas.
- The budget's Hotels, Activities and Restaurants links and their arrows are removed; Shopping and Miscellaneous keep their editors.
- Not included: changes to the idea, destination or budget data, calculations, validation or editors' fields; new filtering, searching or sorting beyond chosen ideas first; changes to the full Hotels, Activities and Restaurants pages, other destination sections, navigation, permissions or sharing.

## Added scope: November 14, 2026, connection price without arrows (TRA-49)
- The Estimated price field in Plan this connection has no increment and decrement arrows. That one editor fills in a new connection and changes a planned one, since the route adds connections itself. People type the price, with cents if needed, such as 12.50, and change or clear it as before.
- Only the arrows go, with TRA-46's class: the field keeps its validation, from $0 to $100,000,000 in whole cents, the Up and Down keys still step it, and saving and saved prices are unchanged.
- Not included: other price fields, changes to validation, precision, stored data or budget totals, and other changes to the connection editor.

## Added scope: November 14, 2026, photo changes through ChatGPT and Claude (TRA-122)
- Through normal chat, without browser control or agent mode, ChatGPT and Claude propose photo changes for destinations, hotels, activities, restaurants and churches: adding photos from the https:// addresses of image files, removing saved photos, choosing the primary or main photo, and ordering a destination's photos, the only gallery whose editor orders photos. Each is a photo change of its own, `destination.photos`, `candidate.photos` or `church.photos`, reusing the gallery editors' changes and rules, which changes nothing but photos.
- Travel downloads each new photo as it is proposed, only over HTTPS and only from public internet addresses, refusing private, loopback and link-local ones for the address given, each of up to 3 redirects and every address a host name resolves to as it connects. A proposal downloads at most 10 new photos and 15 MiB, up to 5 MiB each, within 15 seconds, and each photo is then checked and prepared by `prepareImage`, as an upload is. A proposal with any photo Travel can't download or prepare is refused, naming the change, the address and the reason, and isn't recorded.
- A proposal's prepared photos are kept beside it in an integration table, never in its changes, and can't be altered. The proposal's page shows the owner each photo it adds, changes or deletes while it waits, and only the owner can see them. Approving saves exactly the photo changes previewed with every other change in the proposal, or nothing; rejecting, a failed approval and expiry leave every gallery unchanged, and their photos are deleted, an expired proposal's with the next proposal or decision. Schema 25 adds the table.
- Ordinary accounts change photos only in Travel's photo editors, as before; only the designated owner approves photo changes.
- Not included: chat attachments or image files sent directly, changes without the owner's approval, browser automation, new image editing, gallery redesign or new gallery limits, automatic photo searches, and permission or approval workflow changes.

## Added scope: November 14, 2026, custom city text kept intact (TRA-76)
- A destination records whether its city was chosen from a city suggestion. Only that city is shown shorter, as city and country or city and US state; any other destination text is shown and saved exactly as entered, on cards, travel connections, page titles and in the editor, so `Tokyo, Kyoto, Japan` never becomes `Tokyo, Japan`.
- The destination editor starts from the full saved city, so saving other changes, or the city unchanged, keeps the city and its travel connections. Edited text is saved exactly as typed, and choosing a suggestion records it.
- Destinations saved before schema 26 record no suggestion, so each shows its full saved city until its city is chosen from a suggestion again in its editor, which keeps its connections when the city is the same. Adding a city to a trip keeps an existing destination as it is. Cities ChatGPT or Claude propose are shown as written.
- Not included: guessing which saved cities came from suggestions, changes to how suggestions are labeled or matched, and departing or return cities, which already show as saved.

## Added scope: November 14, 2026, older cities chosen from suggestions shown shorter (TRA-129)
- This replaces TRA-76's start for destinations saved before schema 26. Schema 27 records once, as chosen from a suggestion, each one whose city has a suggestion's shape (city, region and a country's full name), so it shows as before Travel 1.10: `Vienna, State of Vienna, Austria` as `Vienna, Austria`, and `Austin, Texas, United States` as `Austin, Texas`.
- Text typed in that shape before then is recorded too: `Tokyo, Kyoto, Japan` shows as `Tokyo, Japan`. A country code is not a full name, so `Chicago, Cook County, IL` still shows as typed. Saving a recorded city unchanged keeps its record; changing its text saves it as typed.
- Every city saved since keeps TRA-76's rule: only one chosen from a suggestion is shown shorter.
- Not included: checking older cities against the suggestion provider, and departing or return cities, which already show as saved.

## Added scope: November 14, 2026, destination photo arrows (TRA-123)
- From feedback: a destination gallery with two or more photos has Previous and Next arrows on the left and right edges of its main photo, so people browse its photos without choosing each thumbnail. They follow the saved order and loop, from the last photo to the first and the first to the last.
- With a mouse, the arrows appear while the pointer is over the main photo or either arrow has keyboard focus; on touchscreens they always show. They are buttons named Previous photo and Next photo of the destination, at least 44 × 44 CSS pixels, with a visible focus ring, clear of the counter and Primary photo badge.
- The counter, selected thumbnail and Primary photo badge follow the photo shown, and thumbnails still choose any photo. Browsing saves nothing: photo order, the primary photo and the destination are unchanged.
- Not included: uploading, deleting or reordering photos or choosing the primary photo; slideshows or timed transitions; zoom, fullscreen viewing or image editing; arrows for hotel, activity, restaurant or church galleries; and redesigning the thumbnails or destination page.

## Added scope: November 14, 2026, proposal review on phones (TRA-121)
- In windows up to 640 pixels wide, such as phones, a proposal's page shows each changed field stacked: its name, then its Before and After values, each labeled beside it, in place of the Field, Before and After columns. Wider windows, including a phone held sideways past 640 pixels, keep the columns as before.
- Every change, record, field value, photo and notice shows in full from 320 pixels wide without scrolling sideways, in every state: waiting, approved, rejected, failed and expired. Long text, links and values of several lines wrap, and photos shrink to fit, keeping their shape.
- **Approve every change** and **Reject** are at least 44 pixels tall at every width, and on phones the page ends with room for Send feedback, so at the end of the page they sit above it instead of under it.
- Screen readers read each stacked value with its Before or After label; wider windows' tables keep their column headings and read as before.
- Not included: changes to what proposals hold, how they are proposed, approved, rejected or expire, who can see or decide them, the AI assistants and connection pages, the site header, or the wider layout beyond the buttons' height.

## Added scope: November 14, 2026, confirmations on phones (TRA-32)
- Confirmations, such as deleting a trip or an idea, removing a destination from a trip, and clearing entry requirements, health and safety, or a travel plan, open centered on the screen over a darker backdrop and clear of **Send feedback**, in portrait and landscape and at every screen size.
- Their title and message wrap without scrolling sideways at widths down to 320 pixels. When they don't fit, as on a phone turned sideways, they scroll together while **Cancel** and the confirming button stay in view at the bottom.
- Cancel and the confirming button are at least 44 by 44 pixels, and on phones they share the width so a long label such as **Clear entry requirements** wraps instead of running past the edge. Confirming buttons keep their specific labels: **Delete**, **Remove from trip**, **Clear travel plan**, **Clear entry requirements**, and **Clear health and safety**.
- Opening a confirmation moves focus into it, focus stays in it, and the page behind can't be used until it closes. Cancel, the X, and Escape close it without changing anything and return focus to the control that opened it, when that control still exists.
- Not included: which actions ask for confirmation, their messages, what deleting, removing, or clearing does, editors, and the Send feedback dialog.

## Added scope: November 14, 2026, failing a deploy whose database can't open (TRA-78)
- The container checks its storage and sign-in settings, then opens the database and runs any schema upgrade before its server starts. A database the release can't open or upgrade, such as one with a newer schema after rolling back to an older image, unexpected non-USD amounts, or an upgrade that fails, stops the container with the store's error, and a release without its settings never upgrades the database. The server still opens the database when a request first needs it.
- `app.json` gives Dokku a startup health check on `/api/health`, read from the image's working directory, so Dokku switches traffic only to a release that answers it and otherwise keeps the running release.
- Not included: opening the database at startup in `pnpm dev` or the standalone preview, readiness or liveness checks, changes to the deploy workflow, such as failing a re-run of a failed deploy, and checks for images built before this change.

## Added scope: November 14, 2026, visible focus on the trip search and cards (TRA-87)
- Home's trip search shows the same focus outline as every other text field while it has focus. Before, only the caret showed it was focused.
- A trip card reached with the keyboard shows its focus ring just inside its edge at every screen width. Before, the card cut off all but the ring's bottom edge.
- Destinations' search and cards share these styles and show focus the same way; before, its cards showed no ring at all.
- Not included: other focus styles or colors, and the cards' Edit and Delete buttons, whose rings already showed.

## Added scope: November 14, 2026, dragging photos into order (TRA-126)
- From feedback: with a mouse or trackpad, people drag photos into a new order while editing the photos of a destination, hotel, activity, restaurant or church. A photo dropped on another takes its place. The photo being dragged is outlined, and a bar on one side of the photo under the pointer shows whether it goes before or after it.
- The editor shows the new order at once, new photos not yet saved included, and saving the destination or item saves it. Cancel discards it, Undo photo changes restores the saved order, and the main or primary photo stays the same photo. Galleries show photos in their saved order everywhere.
- Hotels, activities, restaurants and churches save photo order as destinations do: a save sends the order only when it isn't the saved order with new photos last, and an order that no longer lists every photo, because the gallery changed meanwhile, is refused. Dragging changes no photo or other detail. The destination editor keeps Move left and Move right.
- Dragging needs a main pointer that hovers and points precisely, so phones and tablets keep their editors unchanged. ChatGPT and Claude still order only a destination's photos (TRA-122).
- Not included: dragging on touchscreens; Move left and Move right, or other keyboard ordering, for hotel, activity, restaurant and church photos; photo editing, upload limits or storage; choosing the main photo automatically; gallery redesign; and dragging anything but photos.

## Added scope: November 14, 2026, restaurant types (TRA-36)
- Each restaurant can have any of five types, Breakfast, Lunch, Dinner, Snack and Drinks, to show which meals and visits it suits. Its editor has an independent checkbox for each, so any combination can be chosen, such as Lunch and Drinks, or none. Editing shows the saved types checked, to add, change or clear them all.
- A restaurant's types show as labeled tags, always in that order, on its card in the destination's Restaurants carousel, on the Restaurants page, and in its details. A restaurant without types shows no tags or placeholder. Checkboxes and tags wrap to fit phones, where each checkbox is at least 44 pixels tall.
- Types belong to the destination's restaurant, so every trip that visits the destination shows the same ones. They are labels only: prices, budget inclusion, Must do, order and budgets are unchanged. Schema 28 starts every saved restaurant without types, and a save from a page opened before then keeps a restaurant's types.
- ChatGPT and Claude can propose a restaurant's types, which the proposal's page shows by name. Types other than the five, a type given twice, and types for a hotel or activity are refused.
- Not included: other or custom types, filtering or sorting by type, choosing types automatically, changes to prices or budget rules, and types for hotels, activities or churches.

## Added scope: November 14, 2026, consistent activity photo sizes (TRA-124)
- From feedback: activity photos show at one size within each list, whatever their shape. In a destination's Activities carousel, each card's photo fills the same 4:3 frame. Before, a portrait or square photo made its frame taller, and with it every card in the row.
- On the Activities page, each activity's main photo already filled the same 16:7 frame. An activity without photos now shows the activity icon in an empty frame of that size, so its card lines up with the others.
- Photos fill their frames without stretching, cropped to fit, and the frames keep their size while photos load and as people choose other photos. Saved photos, their order, the main photo and other details are unchanged.
- Not included: hotel, restaurant, church and destination photos, which keep their presentation; cropping or editing photos; changes to uploads, storage or compression; and other changes to cards, galleries or carousels.

## Added scope: November 14, 2026, deleting an idea from its editor (TRA-128)
- Editing a saved hotel, activity or restaurant shows **Delete** in the editor's footer, beside **Cancel** on the left, with **Save changes** still on the right. On the narrowest phones Save changes wraps below them. Editors adding an idea show no Delete.
- Delete opens the confirmation the category's page shows, which names the idea, says it will be removed from the destination in every trip that visits it, and warns that this can't be undone. It opens above the editor, which stays open beneath it: Cancel, the X and Escape return to the editor with its unsaved changes, photos and links, and focus on Delete.
- Confirming deletes the idea as the category's page does, without saving pending edits, closes the editor without returning to its details, and refreshes the lists, selections and budgets. A failed delete shows its error in the confirmation and removes nothing.
- The category pages' Delete buttons work as before.
- Not included: Delete in other editors, such as a destination's, trip's or church's; deleting several ideas at once; undo or recovery; changes to what deleting removes or to budget rules; and other editor changes.

## Added scope: November 14, 2026, looping idea carousels (TRA-127)
- The left and right arrows of a destination's Hotels, Activities and Restaurants carousels loop: Next at the end returns to the start, and Previous at the start goes to the end, scrolling smoothly as the carousels already do, or at once for people who reduce motion. Between the ends, each still scrolls the carousel's width.
- Both arrows work whenever the cards don't all fit, at either end too, and neither works when they do. Swiping and scrolling with a mouse, trackpad or touchscreen are unchanged and stop at either end.
- The arrows keep their labels, keyboard use and focus ring at every screen size, and browsing saves nothing: ideas, their order, selections, photos and budgets are unchanged. Destination photo arrows already loop (TRA-123) and are unchanged.
- Not included: autoplay or timed scrolling, changes to swiping or scrolling, carousel or arrow redesign, changes to ideas or photos, new pagination or browsing controls, and arrows for galleries without them.

## Added scope: November 14, 2026, miscellaneous spending in transit (TRA-26)
- Each travel connection's editor has an optional **Miscellaneous spending (USD)** field for spending on the way, such as airport meals, drinks, snacks and layover purchases. One amount covers the whole connection, layovers included, for the whole party. The connection's existing Notes describe it; there is no separate notes field.
- Blank is no estimate and never makes the trip estimate partial; zero is a known amount. The amount follows every other amount's rules: zero or more, at most two decimal places, and no more than $100,000,000.
- A connection's card shows an entered amount apart from its transportation price. The trip estimate has a **Transit miscellaneous** row, separate from Travel and destination Miscellaneous, and counts its USD total once in the trip total.
- The amount is saved with its connection and kept when the trip is reopened or the connection edited. Clearing the connection clears it, and a route change that removes or clears a connection removes it from the trip total. ChatGPT and Claude can propose it, and the proposal's page shows it. Schema 29 adds it to each connection, blank.
- Not included: other currencies, conversion or exchange rates; itemized purchases, receipts or actual spending; a separate spending notes field; suggested amounts from the transportation, duration or layovers; and changes to destination miscellaneous spending.

## Added scope: November 15, 2026, closing an editor during a save (TRA-81)
- When the browser closes an editor while it saves, as Chrome does after repeated Escapes and Android's back button can, the page forgets the editor. The save still finishes: a failed save's error shows in the alert at the bottom of the screen, as for changes made without an editor (TRA-82), and every editor opens again without reloading. Before, the error showed inside the closed editor, out of sight, and Edit and Add buttons opened nothing.
- The Delete confirmation above an idea's editor (TRA-128) closed this way returns to the editor, which shows a failed delete's error, and its Delete opens the confirmation again.
- Cancel, the X and Escape still do nothing while saving, and an idea's editor opened from its details still returns to them when its save succeeds.
- Not included: reopening an editor the browser closed, keeping its draft after its save fails, and changes to saving or its messages.

## Added scope: November 15, 2026, feedback limits per account (TRA-92)
- Feedback limits count per signed-in account, which a client can't change the way it could drop the anonymous feedback cookie to get fresh limits. The cookie is removed. Each account gets 10 tokens an hour, one for each opening of the sheet or retry, and keeps its 3 sends an hour. Everyone together keeps 20 tokens a minute and 120 an hour, and 5 sends a minute and 30 an hour, so one account can't use up everyone's.
- A send doesn't count against the limits when Jira certainly created nothing: the settings are missing or invalid, the connection was refused or Jira's host wasn't found, or Jira answered with a 4xx status or 503. Timeouts, dropped connections and other statuses still count, since Jira may have created the task.
- After a 429 from a token request or a send, the sheet's **Send** shows that message again without asking the server until the sheet is closed and reopened. Other failures still retry with Send (TRA-91), and the draft is kept.
- `JIRA_URL`, `JIRA_EMAIL` and `JIRA_API_TOKEN` are trimmed, so a value saved with a line break still signs in. Each failed send logs a fixed reason naming what to check, with Jira's HTTP status when it answered, never a setting's value, the feedback or what Jira sent.
- Not included: changes to the sheet's layout or messages, Jira's issue fields, the one-use token rules, limits kept across restarts or processes, and automatic retries.

## Added scope: November 15, 2026, estimates without a departing city (TRA-85)
- A blank departing city no longer makes the trip estimate partial. It is optional and not an amount, and the travel from and to it is still counted with every other connection. A trip with every required amount filled shows a complete estimate on its page and on Home, with or without a departing city. Before, it showed **Partial estimate** with nothing listed to fix.
- Showing **Add a departing city** beside the status instead was not chosen: adding one clears the travel from and to it, so a trip whose connections were priced would lose them and become partial again.
- Not included: requiring a departing city; keeping the travel from and to it when one is first added, which still clears those connections as any new endpoint does; and other partial-estimate explanations, such as for a trip without destinations.

## Added scope: November 15, 2026, adjustable destination photo crops (TRA-53)
- Each destination photo, new uploads included, has its own focal point, which decides what shows where the 16:7 main photo crops it to fit. A photo without an adjusted crop stays centered, as before.
- The destination's photo editor has **Adjust crop** under each photo. It opens a crop editor in place of the photos, with the photo in a 16:7 frame, the main photo's shape on every screen. Dragging the photo with a mouse or a finger moves it within the frame, and the frame shows the crop as it changes. Without zoom, a photo moves only the way it is wider or taller than the frame, as far as its edges.
- **Reset to center** centers the photo, **Apply** keeps the crop as an unsaved change, and **Cancel** discards the crop editor's changes, keeping the crop applied before. The destination's Save saves every applied crop, and its Cancel or **Undo photo changes** discards them.
- The main photo and the gallery's thumbnails show each photo's focal point, on desktop and phones, whichever photo is shown or primary, as do the editor's photos. Adjusting a crop never changes the photo file, the photo order or the primary photo, and the crop editor's dragging is separate from dragging photos into order. Schema 30 starts every saved destination photo centered.
- ChatGPT and Claude read each destination photo's focal point but can't propose one: photo changes keep saved focal points, and the photos they add start centered.
- Not included: crops for hotel, activity, restaurant or church photos; zoom; resizing, rotating, filtering or changing photo files; separate crops for desktop and mobile; choosing crops automatically; keyboard adjustment of a crop; and changes to photo limits, order, primary photos or deletion.

## Added scope: November 15, 2026, travel map (TRA-44)
- Each trip's page has a Map section below its header and before its destinations, open by default, which its heading closes and reopens. It shows the departing city, every destination in route order and the return city, one marker serving as both when they are the same place, and each connection's layovers and stops in their saved order. Destinations, trip endpoints, layovers and stops are drawn differently, with a key below the map.
- Straight lines join each connection's places in travel order, and each connection shows the icons of its saved Transportation text, including the generic icon for unrecognized text. The map frames every place it found when it opens and when its places change, and zooms and pans with a mouse, touch or keyboard. Selecting a marker goes to its destination's card, its connection or its itinerary entry on the page; there is no popup.
- Places are looked up by their saved names through Open-Meteo, as city suggestions are, within the same limits, and kept in memory for a day. No coordinates are stored or guessed: a place the map can't find is listed below it with why, and no line stands in for it. Activities on the way stay itinerary stops; there is no new itinerary type. Saved changes update the map. Leaflet draws it, with OpenStreetMap's tiles.
- Not included: hotels, restaurants, activities and churches within a destination (TRA-130); road, rail, flight or sea routes; navigation, traffic or travel times; placing or moving places on the map; new itinerary types; storing coordinates; and changes to prices, schedules or budgets.

## Added scope: November 15, 2026, destination taglines (TRA-125)
- From feedback: each destination has its own tagline, shown above its name at the top of its page in place of the fixed A PLACE WORTH KNOWING. The destination's editor, from its page or a trip's page, has a single-line **Tagline** field directly below City or destination, which saves and cancels with the rest of the editor.
- A tagline has up to 120 characters. It is saved as typed and shown in capitals in the existing heading style, wrapping to fit on desktop and phones without overflowing the page. A destination without one, including every destination saved before (schema 31 starts them all empty), shows A PLACE WORTH KNOWING, and clearing the field and saving shows it again.
- The tagline belongs to the shared destination, so every trip that visits it, and everyone who can open it, sees the same one. Saving any other detail, from the destination's editor or a section's own editor, keeps it, and a tagline never changes the destination's city, notes or other details. ChatGPT and Claude can propose a tagline, which the proposal's page shows.
- Not included: trip taglines or changes to trip headings and names; customizing hotel, activity, restaurant or church headings; fonts, colors, bold or other formatting, and multiline taglines; AI-generated or suggested taglines; and changes to destination names, notes or other existing fields.

## Added scope: November 16, 2026, small photo thumbnails (TRA-89)
- Each photo is saved with a thumbnail: the whole photo as WebP, scaled down only as far as it still covers 480 × 320. Uploads, a destination's single image from an old client, and photos ChatGPT and Claude propose are all prepared with theirs.
- Gallery thumbnails and the photo editors' previews of saved photos show the thumbnail instead of the photo, so a card with 10 photos downloads under 0.5 MB of thumbnails instead of about 3.7 MB of photos. The main photo, the crop editor, the idea carousels' cards and the proposal page's photos still show the photo itself, and a destination photo's thumbnail keeps its focal point in view.
- Thumbnails are served under each photo's address with `/thumbnail` added, versioned and private, only to accounts that can see the photo. Schema 32 adds them to the photo tables. Photos saved before have none, and theirs is made from the photo whenever a browser asks for it, without saving it. A photo proposal made before the upgrade can't be approved and has to be proposed again.
- Not included: thumbnails for the idea carousels' cards or the proposal page, more than one thumbnail size, responsive `srcset` images, changes to photo limits or processing, and saving thumbnails for photos saved before.

## Added scope: November 16, 2026, airport codes (TRA-132)
- From feedback: layovers saved as airport codes, such as PHL and CLT, were listed under **Not on the map**, because Open-Meteo doesn't find airports by their codes. A departure, return or layover written as an airport's three-letter IATA code in capitals is now shown at that airport.
- Airports come from OurAirports' public-domain data: every airport with an IATA code, with its name, the city it serves, its country and its position, kept with the app and refreshed by a script. Codes are matched exactly. Saved places must be in capitals, and destinations and other stops are looked up only by name, because names such as Goa, Ulm and UAE are also airport codes. A name with a code in parentheses, such as Frankfurt (FRA), is still looked up by its name.
- Departing city and Return city suggest the airport for a three-letter IATA code in any letter case, first in the list, with its name and code, the city it serves and its country. Choosing it saves the code. City or destination suggests no airports, since a destination is a city.
- The trip map has a compact airport search above it. A code in any letter case shows the airport it names anywhere in the world, or says no airport has it, and selecting the airport centers the map on it. Typing alone doesn't move the map, and searching changes no trip, destination or other map behavior.
- Not included: ICAO codes, city codes such as NYC, and searching airports by name in the map's search; flight schedules, availability, fares or booking; terminals, gates, parking or other airport details; marking the searched airport on the map or adding it to a trip; and other changes to location search or the map.

## Added scope: November 16, 2026, screen reader names and headings on trip pages (TRA-95)
- From review: what screen readers hear on a trip's page matches what it shows, and nothing on screen changes.
- A connection's heading, and the route at the top of its editor, read "to" where they show an arrow, as in Wooster, Ohio to Rome, Italy. Before, the arrow was silent and the two places ran together.
- **Edit shopping budget**, **Edit miscellaneous budget**, **Show Church** and the Church section name their destination as its card does, so a city chosen from a suggestion is Paris, France, not its saved label, Paris, Ile-de-France, France.
- An idea's **Must do** control is named by the label it shows, **Mark as must do** or **Must do**, followed by the idea's name. Before, it was always named "Must do:" and the idea's name, which left out the **Mark as must do** people see and say to select it.
- Below each destination card's h4 **Church** heading, the Sundays during the stay, each church and the message shown without any are h5 headings, and each church's Mass times an h6, so a trip page's headings nest in order. Before, they were h3, h2 and h3. The Sundays and the churches take their heading level from the section that shows them, and each heading keeps its look.
- Not included: the Church page and a destination's page in Destinations, which still go from their h1 straight to the card's h4 sections; other names, headings or labels; and any visible change.

## Added scope: November 16, 2026, text contrast (TRA-88)
- From review: all text has at least 4.5:1 contrast with its background at every size, WCAG AA for normal text.
- Gray secondary text (`--muted`) is #5f6b63, darkened from #738077, which measured 3.82:1 on the page and 3.61:1 in the budget panel. It now measures 5.15:1 and 4.87:1, and at least 4.6:1 on every other background it is shown on.
- The orange accent (`--orange`) is #a65135, darkened from #b75a3b, so eyebrows, the map's reasons, **Remove** buttons, links and buttons that turn orange on hover, and the AI proposal badges on their light orange all reach 4.5:1. Before, eyebrows measured 4.28:1 and the badges 3.82:1.
- Each other text color below 4.5:1 is darkened in its own hue until it reaches 4.5:1 on its backgrounds: trip numbers, stop numbers, the budget panel's eyebrow, breakdown labels and note, estimate status, prices not yet estimated, selection tags, idea notes, the route at the top of a connection's editor, and the note and N in the home page's illustration. Placeholders are #6d736b, the trip, destination and airport searches' included, which used the browser's default gray.
- Not included: icons and other graphics, disabled controls, which WCAG exempts, and other color changes.

## Added scope: November 16, 2026, in-app Help (TRA-3)
- **Help** at the end of the header's navigation opens help for the page shown, above it, without leaving it: "Help:" and the page's name, then up to six short points in plain language on what the page is for and its common tasks.
- Every signed-in page has its own help: All trips, a trip, Destinations, a destination, the Hotels, Activities, Restaurants and Church pages in a trip and in Destinations, What's new, AI assistants, Connect an AI assistant and a proposal. The not-found page has its own, including where an address names a trip, destination or proposal that can't be opened.
- Planner editors, confirmations and an idea's details have **Help** beside their X. It opens above the editor, which keeps its draft, and describes the page beneath, not the editor. It waits while the editor saves, as the X does.
- Help closes with its X, Escape or the backdrop and returns focus to the button that opened it. Opening and closing it changes no page or editor and makes no request.
- The help is static text in `src/lib/help.ts`, organized by route as Meals' is, and typed against the routes Next.js generates so a page without help fails the type check.
- On screens up to 400 pixels wide the navigation's links are closer together, so the owner's five links stay on one line down to 360 pixels, as four did before.
- Not included, as the ticket says: AI or conversational help, searching help or separate help pages, tours or walkthroughs, help for individual editors, help people can edit, and changes to Travel's features or data.

## Added scope: November 16, 2026, trip order (TRA-16)
- In place of the original request for sorting by name, start date and last update, people put the trips on All trips in any order by dragging each card's handle, with a mouse, finger or pen, onto another card's place. Only the handle drags, so opening, editing and deleting trips work as before. Dragging near the window's top or bottom scrolls the page.
- From the keyboard, Space or Enter on a handle picks its trip up, the arrow keys, Home and End move its place, and Space or Enter drops it, or Escape puts it back. Handles are labeled with their trips' names, and screen readers hear each step with the trip's position.
- The order saves as soon as a trip is dropped, without a Save button. If saving fails, the trips go back to their previous order and the error shows. The order stays across refreshes, navigation and signing in again.
- Each account's order is its own and changes no one else's list or any trip. New trips and newly shared trips go last, in the order the account got them, and arranged trips keep their order. Search and tag filters keep the saved order and turn dragging off until they are cleared.
- Schema 33 adds a `trip_order` table, one row per account and trip it has arranged, and records each account's current order, newest trip first, so no list changes. A save that doesn't name every trip the account can open, once each, is refused. ChatGPT and Claude can't propose an order, since it is each person's own and they can't read it.
- Not included, as the ticket says: sorting by name, date or last update; ordering destinations, stops or any other list; one order shared between people; moving trips while a search or tag filter is on; and changes to trip details, budgets, dates, destinations or sharing.

## Added scope: November 16, 2026, trip headline images (TRA-133)
- Each trip can have one optional headline image, separate from its destinations' photos. **Edit trip**, and the editor that creates a trip, uploads it from the device: a JPEG, PNG or WebP image up to 5 MB, checked and prepared as every upload is.
- It shows across the top of the trip's card on All trips, above the trip's details, in a 2:1 frame, and as a 3:1 banner on the trip's page, between **All trips** and the trip's name. Each frame has the same shape on every screen. A trip without one looks as it did, with no placeholder or empty frame.
- The card and the banner each have their own crop: a focal point, chosen by dragging the image in that frame's preview with a mouse or finger, and a zoom from 100% to 300% about that point, chosen with the preview's slider. The previews show each crop as it changes. A new image starts centered at 100% in both.
- **Replace image**, **Remove image** and, for a saved image, **Undo image changes** change the editor's draft. Saving the trip saves the image, both crops and the trip's other details together, or nothing, and **Cancel** discards every image change. A refused file keeps the editor's image, and a failed save keeps the saved image and crops.
- Schema 34 adds a `trip_images` table, deleted with its trip. The image is served at `/api/trip-images/[id]`, versioned and only to accounts that can open the trip. New crops name the image they were chosen for, and are refused once someone else replaces or removes it. ChatGPT and Claude can't change headline images.
- Not included, as the ticket says: more than one image per trip or a slideshow, image addresses, image search or choosing a destination photo, choosing images automatically, filters, text, rotation or other editing beyond dragging and zooming, changes to destination photos, and headline images anywhere else, such as Destinations, idea cards or idea pages.

## Added scope: November 16, 2026, trip taglines (TRA-134)
- Each trip has its own tagline, shown above its name at the top of its page in place of the fixed AN ADVENTURE IN THE MAKING. The trip editor, when creating or editing a trip from its page or its card on All trips, has a single-line **Tagline** field directly below Trip name, which saves and cancels with the rest of the editor and shows the trip's saved tagline when editing.
- A tagline has up to 120 characters. It is saved as typed and shown in capitals in the existing heading style, wrapping to fit on desktop and phones. A trip without one, including every trip saved before (schema 35 starts them all empty), shows AN ADVENTURE IN THE MAKING, and clearing the field and saving shows it again. A failed save keeps the saved tagline.
- The tagline belongs to the trip, so everyone the trip is shared with sees the same one and can change it. Saving any other change to the trip keeps it, and a tagline never changes the trip's name, dates, cities, notes or other details. ChatGPT and Claude can propose a tagline, as they can a destination's, which the proposal's page shows.
- Not included, as the ticket says: taglines on All trips cards, changes to destination taglines or trip names, fonts, colors, bold or other formatting, multiline taglines, taglines Travel generates or suggests itself, and changes to trip notes, images, dates or other fields.

## Added scope: November 16, 2026, destination map (TRA-130)
- Each destination card on a trip's page, and each destination's page in Destinations, has a Map section after the destination's photos and before its budget, ideas and research, open by default, which its heading closes and reopens. A trip's card has its name and notes after its photos, so its map follows them. Both show the same map from the same saved places, and the trip map is unchanged.
- The map shows every saved hotel, activity, restaurant and church, chosen for the budget or not, each category with its own symbol, and places found at the same spot share a marker. Checkboxes for the four categories, all checked to start, choose any combination for both the markers and Not on the map.
- Places are looked up with Nominatim, OpenStreetMap's search, within 50 km of the destination, which is found as the trip map finds it: by a saved address, which must lead to a building or other specific place, and otherwise by name, which must be one of the place's own. A place shows only when exactly one place matches, so nothing is guessed, and nothing is stored. Places it can't show are listed below the map by category, each with why and View details, with Try again when a lookup couldn't be made. When nothing selected can be shown, a message replaces the map.
- Selecting a marker, with a pointer, touch, Enter or Space, opens a popup with each place's name and category and View details, which opens an idea's existing details, or a church's saved details, read only. The map pans and zooms with a mouse, touch or keyboard. Saved changes to places' names and addresses, and to the destination's city, update the map without duplicate markers.
- Nominatim's usage policy for its public server allows at most one request a second, made one at a time, with answers kept: Travel's requests wait their turn, more than a second apart, and are kept in memory for a day. The server waits a few seconds for a map's places, and the map asks again for any still waiting.
- Not included, as the ticket says: changes to the trip map; directions, routes, travel times or distances; placing, dragging or assigning coordinates by hand; finding or adding new places; and transportation stops, shopping and other categories. Also not included: storing coordinates, and editing a church from its details, which its card in the Church section does.

## Added scope: November 16, 2026, primary photos on Destinations cards (TRA-131)
- Each card in Destinations (`/destinations`) shows its destination's primary photo across its top, edge to edge above the city, its trips and its idea counts, in the 2:1 frame trip cards use for their headline images, the same shape on desktop and phones.
- The photo fills its frame without stretching, cropped around the focal point saved for it, as the destination's page crops it. Selecting it opens the destination, as the rest of the card does, and the card's details are unchanged.
- A destination without photos keeps its card as it was, with no placeholder or empty frame. Choosing another primary photo, adjusting its crop, replacing or removing it shows on the card the next time the list loads.
- The card loads the photo from the versioned address the destination's page uses, served only to accounts that can open the destination. Nothing new is stored, and the schema is unchanged.
- Not included, as the ticket says: adding, replacing, removing or cropping photos from the list; galleries, slideshows or more than one photo per card; changes to trip cards, destination pages or idea cards; photos chosen or generated automatically; and changes to destinations' names, notes, budgets, tags or research.

## Added scope: November 18, 2026, monthly typical weather chart (TRA-135)
- Each destination's Typical weather section, on a trip's destination cards and on the destination's own page, has **Monthly averages** below its existing typical weather: one reusable chart, the same for every destination, of that destination's saved historical averages, with the average daily high and low in °F as two lines from January to December, month labels, a legend, the averages' source and reference years, and a table of every month. They are labeled as historical averages, not a forecast.
- Hovering over a month, tapping or dragging across the months, or choosing one with the keyboard shows its average high, low and precipitation. In a trip, the month a dated stay begins is chosen at first and stays marked; without dates, and on a destination's own page, no month is chosen. Choosing a month only changes what the chart shows.
- Monthly averages are recorded per destination, apart from its seasonal typical weather fields, with **Add monthly averages** or **Edit monthly averages** and **Clear**: every month's high and low in °F and precipitation in inches, a source and its first and last reference years, all required, so nothing is ever filled in or estimated. A destination without them shows an empty state. ChatGPT and Claude can propose them for the owner's approval. Schema 36 adds a `destination_climate` table, deleted with its destination, and starts every destination without averages.
- Existing typical weather, including Vienna's temporary summer placeholder, and all other research, dates and budgets are unchanged, and saving or clearing either the averages or the typical weather keeps the other.
- Not included, as the ticket says: live forecasts, current conditions or alerts; looking up, researching or filling in averages automatically; replacing or removing the seasonal typical weather fields; changes to trip or destination dates, itineraries or budgets; weather recommendations, suggested months or packing advice; changes to other destination research; and comparing destinations on one chart. Also not included: Celsius or millimeters, and partial years of averages.

## Added scope: November 18, 2026, transportation word forms (TRA-117)
- Connections in Between the places recognize more ways of writing the kinds of transportation TRA-112 shows icons for: plane and fly for airplane, railway for train, drive and ride share for car, walk for walking, and the plurals of the terms for a vehicle or a ride, such as flights, trains, buses, boats, cars, ferries, planes, taxis and bikes. The trip map, which shows each connection's icons as Between the places does, follows.
- They match as TRA-112's terms do, which all still work: as complete words or phrases in any capitalization, each kind once in the order entered, with the generic route icon when nothing is recognized. Saved connections show the icons for what they say without any change to their Transportation text.
- Not included, as the ticket says: new kinds of transportation or icon designs, changes to saved Transportation values or the schema, to how transportation is entered, or to the map's routes, markers or interactions, and interpreting the text with AI or other services.

## Added scope: November 18, 2026, church photo browsing (TRA-136)
- From feedback: each church's photos browse as a destination's do (TRA-123). A church with two or more photos has Previous and Next arrows on the left and right edges of its main photo, on its card in the Church section and in its details from the destination map. They follow the saved order and loop, from the last photo to the first and the first to the last.
- On touchscreens, swiping the main photo to the left shows the next photo and to the right the previous one, looping the same way. A swipe moves at least 40 CSS pixels, more sideways than up or down, with one finger or a pen; scrolling the page up and down and pinching to zoom still work, and a mouse doesn't swipe.
- The arrows are the destination gallery's own, shared by both galleries: with a mouse they appear while the pointer is over the main photo or either arrow has keyboard focus, and on touchscreens they always show. They are buttons named Previous photo and Next photo of the church, at least 44 × 44 CSS pixels, with a visible focus ring, before the thumbnails in keyboard order, clear of the counter and Main photo badge.
- The counter, selected thumbnail and Main photo badge follow the photo shown, thumbnails still choose any photo, and each church's gallery browses on its own. Photos fill the existing 16:7 frame, cropped to fit without stretching, and stay centered, since church photos have no saved focal point. Each photo's description names the church and the photo's number.
- A church with one photo shows it as before, without arrows, thumbnails or swiping, and a church without photos keeps its card as it was. Browsing saves nothing and never leaves the church: its photos, their order, its main photo and its other details are unchanged, and nothing new is stored.
- Not included, as the ticket says: adding, uploading, editing, deleting, reordering or cropping church photos; finding or adding photos automatically; changes to church names, addresses, websites, Mass times or other details; scrolling between churches; and changes to other galleries, so destination galleries keep their arrows without swiping, and hotel, activity and restaurant galleries keep their thumbnails alone.

## Added scope: November 18, 2026, one photo size for hotels, activities and restaurants (TRA-137)
- From feedback: hotel and restaurant photos show at one size in a destination's carousels, as activity photos have since TRA-124. Before, a portrait, square or tall hotel or restaurant photo made its card's frame taller than 4:3, and with it every card in the row: on a phone 448 pixels wide, one tall photo made a row of hotels about 1,300 pixels tall.
- Every card's photo in the Hotels, Activities and Restaurants carousels, on a trip's destination cards and on destination pages, fills the same 4:3 frame at every screen width. Photos fill it without stretching, cropped around their center, since idea photos have no saved focal point, and the frames keep their size while photos load. A card without photos keeps its category's icon in a frame of the same size.
- Each category's page already showed every idea's main photo in the same 16:7 frame, at the same size while browsing its photos, as does an idea's details. Both are unchanged, as are the Activities page's empty frame for an activity without photos and the Hotels and Restaurants pages' cards without photos, which show none.
- Not included, as the ticket says: changes to adding, removing, ordering or saving photos, or to the main photo; cropping or positioning controls; full-size galleries; church and destination photos; and other changes to cards, prices, selection or editing.

## Added scope: November 18, 2026, adding images by URL (TRA-139)
- From feedback: every photo editor, for destinations, hotels, activities, restaurants and churches, has **Add image by URL** beside **Add photos**, and the trip editor has it beside **Add image** for a trip's headline image (TRA-133), since the ticket asks for it wherever Travel takes uploads. It opens a field for an image's web address, and **Preview** shows the image Travel downloads before **Use this image** adds it.
- An image added by URL joins the editor's draft as a file chosen from the device does, so it is arranged, cropped, chosen as the main or primary photo and removed as new photos are, counts toward the same limits, and saving uploads and prepares it as every upload is. Travel keeps its own copy, which never changes with its source.
- Travel downloads it on the server, only from `http://` and `https://` addresses of public internet hosts, refusing private, loopback and link-local ones for the address given, each of up to 3 redirects and every address a host name resolves to as it connects, as it downloads ChatGPT's and Claude's photos (TRA-122), which stay HTTPS only. The image must be a JPEG, PNG or WebP image of up to 5 MiB that downloads within 15 seconds, and `prepareImage` checks it before it shows, so an image the editor previews is one its save accepts. Each refusal says why, and nothing is added.
- `/api/image-url` answers only signed-in accounts' requests from Travel's own pages and stores nothing. The file upload workflow, saved photos, ChatGPT's and Claude's photo changes and the schema are unchanged.
- Not included, as the ticket says: image search or photo libraries, web pages or scraping, several addresses at once, new editing tools, gallery redesign, changes to saved photos, other services' integrations, and keeping images in step with their sources. Also not included: limits on how often an account downloads images, and Help for the editors, which Help leaves out (TRA-3).

## Added scope: November 18, 2026, destination previews on the trip map (TRA-143)
- Pointing to a destination's numbered marker on a trip's map with a mouse or pen, or reaching it with the keyboard, shows a compact preview beside the marker: the destination's name as saved, below its primary photo, in the same 2:1 frame for every destination, filling it without stretching and cropped around its saved focal point. A destination without photos shows its name alone, with no empty frame or broken image.
- The preview goes above the marker, or below it where there isn't room above, moved across as far as keeps it within the map, at every edge and on phones. The map's zoom buttons and credits stay above it.
- It stays while the pointer is on the marker or the preview, closes a moment after the pointer leaves both or when the keyboard moves on, and Escape closes it. While the map moves, it waits, then shows beside the marker where the marker ends up.
- Selecting a marker by pointer, tap, Enter or Space still goes to what it stands for. Touch has no hover, so a tap shows no preview. Screen readers hear the destination's name in its marker's label, so the preview, which repeats it, is hidden from them. Each marker's tooltip still names the place the map found for it.
- The preview loads the photo's thumbnail from the versioned address the destination's gallery uses, served only to accounts that can open the destination. Nothing is stored or changed, and the schema is unchanged.
- Not included, as the ticket says: previews for the departure, return, layovers, stops or transportation, or on destination maps; budgets, ideas, dates or other details in the preview; editing from it; and changes to photos, crops, names, routes, numbering or how the map frames the trip.

## Added scope: November 18, 2026, what each idea is (TRA-138)
- From feedback: each hotel, activity and restaurant card has a line directly below its name saying what the place is, such as Boutique hotel, Historic cathedral or Traditional Italian restaurant, so an unfamiliar name makes sense without opening the idea.
- The ticket expected the line to come from each idea's saved category or description, with no new field. Ideas have no category beyond their list and a restaurant's meal types, which the cards already show, and their only description is their notes. The owner chose a new optional field instead: What it is, below Name in the idea's editor, one line of up to 120 characters saved as typed. Schema 37 adds it, empty for every existing idea, so no card changes until one is entered.
- The line shows on the cards in a destination's Hotels, Activities and Restaurants carousels, on a trip's destination cards and destination pages, and on each category's page, above a restaurant's types, in one style for all three categories. Every card shows at most two lines at every screen width, ending in an ellipsis when it is longer. An idea without it shows nothing there, and its details show it first, or Not added.
- It belongs to the idea, shared by every trip that visits its destination. ChatGPT and Claude read it and can propose it with an idea's other details, and the proposal's page shows it as What it is. A save without it, as from a page opened before it, keeps it.
- Not included: filling it in automatically, from notes or with AI; lines below the names of destinations, churches or other items; and other changes to the cards' photos, prices, buttons, selection, ordering or layout.

## Added scope: November 18, 2026, city suggestions kept in view (TRA-140)
- From feedback: at 1920 × 911, Add destination's editor cut its city suggestions off at its buttons, leaving two of eight in view. Suggestions now float over the editor, below the field, or above it when the list at its full height doesn't fit below and there is more room above, so it stays on one side as people type.
- They are as tall as before at most, about four suggestions, and stay 8 pixels inside the part of the window people can see, which an on-screen keyboard shortens. With less room they are shorter and their list scrolls, so every suggestion can be reached. They show above the editor's buttons and its Send feedback button, and never over the field.
- The ticket named Add destination, but every city field is one shared field that cut off its suggestions the same way, so all of them change: Add destination, New destination, Edit destination, and the trip editor's Departing city and Return city.
- Scrolling the editor's fields closes the suggestions, as a select's list closes, and typing or the Down and Up arrows open them again. The arrows, which scroll only the list, Enter and Escape work as before, as do searching, filtering, ranking and choosing suggestions.
- Not included, as the ticket says: the suggestions' look, how cities are searched or saved, and saved data or the schema. Also not included: other lists, such as tag suggestions, which the browser shows.

## Added scope: November 18, 2026, no airport search on the trip map (TRA-144)
- The airport search above each trip's map (TRA-132) is removed, since viewing a trip doesn't need it and it cluttered the map: its field, the airport it found and its messages, and centering the map on the airport selected. Nothing on the map searches airports, and the map follows its help directly, without the search's space, on desktop and phones.
- The rest of the map is unchanged: numbered destinations, the departure, return, layovers and stops, transportation, lines, framing, zoom, panning, selecting markers and destination previews (TRA-143). A departure, return or layover saved as an airport's code, such as ORD, is still shown at that airport.
- Departing city and Return city still suggest the airport for a three-letter code, and choosing it still saves the code. `/api/locations` no longer finds an airport by its code alone, which only the map's search asked, and airport suggestions no longer include the airport's position, which only it used. Trip data and the schema are unchanged.
- Not included, as the ticket says: changes to airport suggestions in other fields or to how saved codes are found and shown; to trip data, markers, routes or map controls; to destination maps; and redesigning the map or replacing its provider.

## Added scope: November 18, 2026, no instructions above the trip map (TRA-145)
- The paragraph of instructions below the **The map** heading on each trip's page is removed, since the map and its controls explain themselves: "Your departure, destinations, stops along the way and return, joined by straight lines in travel order. Select a place or a connection's transportation to find it below." The map follows the heading directly, without the paragraph's space or styles, on desktop and phones.
- The heading had less space below it only to keep the paragraph close, so it now has the space below it that the page's other section headings have, such as The destinations and Between the places. Closed, the section takes the same space as before.
- The THE WHOLE JOURNEY label, the heading, closing and reopening the map with it, and the rest of the map are unchanged: markers, transportation, lines, framing, zoom, panning, selecting markers, destination previews (TRA-143) and **Not on the map** with its explanation. Trip data and the schema are unchanged.
- Not included, as the ticket says: other explanatory text in Travel, Help included; destination maps; and changes to the map's markers, routes, controls or provider.
