# Travel
A shared notebook for travel ideas: trips, ordered destinations, transportation between departing city, destinations, and return city, hotel alternatives, activities, restaurants, and estimated budgets. Each city's research stays in Destinations, shared by every trip that visits it.

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
Sign in with Google is the only way in, and Travel signs in the same way as Budget and Meals: the OpenID Connect code flow with PKCE, written by hand in `src/lib/google.ts`, with sessions kept in Travel's own database. Every page, saved change, photo, city suggestion, feedback message and What's new entry requires signing in. Only the sign-in page (`/login`), the Google routes under `/auth/google`, and `/api/health` are public, apart from what ChatGPT and Claude need to connect: OAuth metadata under `/.well-known`, and the registration and token endpoints under `/api/oauth`. The MCP endpoint, `/api/mcp`, takes only an AI connection's access token, never a session (see [AI assistants](#ai-assistants)).

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
- **What shared people can do.** Everything in the trip: its details and dates, tags, destinations, travel, hotels, activities, restaurants, churches, entry requirements, health and safety, budgets, At home items and photos. The destinations it visits are the owner's, shared by the owner's other trips that visit them, so a change to one appears in those trips too (see [Destinations](#destinations)). Only the owner can delete the trip, share it, or remove someone, and the Share and Delete controls appear only for the owner. There are no view-only or custom roles.
- **Who has access.** The Share dialog lists the owner and everyone the trip is shared with, each with **Remove**. Trip lists show both your own trips and trips shared with you, marked **Shared by** their owner.
- **Removing access.** Takes effect on that person's next request: the trip leaves their list, its pages and saved links show "This page has moved on.", saves are refused and photos are no longer served. Its destinations leave their Destinations too, unless another trip shared with them visits them. Nothing in the trip changes. Their email stays authorized, so they keep their own trips and any others shared with them. Photos their browser already downloaded can stay in that browser's cache.
- **Working together.** Everyone with access works on the same saved trip, and changes appear when the page reloads, including after each save. There are no live updates or edit conflict checks: the last save wins.
- **Enforcement.** The server checks the signed-in account against the trip or destination on every page, Server Action and photo request, finding each item's trip or destination from what is saved rather than from what the browser sends. A trip or destination you can't open looks the same as one that doesn't exist.

## Trip tags
Tags such as `Europe`, `Beach` or `Family vacation` group trips without changing their names (TRA-17).

- **Adding and removing.** A trip's page shows its tags under its details, each with a remove button, beside an **Add a tag** field. Type a new tag, or choose one the field suggests from the tags on every trip you can open, then press Enter or **Add**. Removing a tag takes it off that trip only. Tags aren't part of **Edit trip**.
- **One tag, one spelling.** A tag is up to 40 characters, with extra spaces removed. Names that differ only in letter case or spacing are the same tag: a trip has each tag once, and a tag you add takes the spelling it already has on a trip you can open, so `europe` becomes `Europe`. A tag exists while a trip has it. There is no list for renaming or deleting tags across trips, and tags have no colors or icons.
- **Sharing.** Tags follow the trip's sharing: everyone with access to a trip sees its tags and can add and remove them, and changes appear when the page reloads, as for every other change. Suggestions and filters offer only tags on trips you can open, so a tag only on trips you can't open is never shown to you.
- **Trip list.** Each trip card shows its tags. **Filter by tag** above the cards lists every tag on your trips. Select any number of them to show only trips with every selected tag. Tag filters combine with the search, so a trip shows only when it matches both. Select a tag again to remove that filter, or choose **Clear tag filters** to remove them all and keep the search. Filters reset when you leave the page, as the search does.
- **Deleting.** Deleting a trip deletes its tags, never another trip's. Schema 23 adds tags; existing trips start without any (see [deployment](docs/DEPLOYMENT.md#schema-23-trip-tags-tra-17)).

## Destinations
**Destinations** in the header lists every destination you own and every destination a trip shared with you visits, including destinations no longer in any trip (TRA-105). Search by city or trip name. Each card shows the city, the trips that visit it, and how many hotels, activities and restaurants are saved for it. When two cities would show the same short name, such as `Newport, Wales, United Kingdom` and `Newport, England, United Kingdom`, their cards also show their full saved names. A destination's page has its photos, notes, budget, [Hotels, Activities and Restaurants](#hotels-activities-and-restaurants), entry requirements, health and safety, typical weather and Church, its Hotels, Activities, Restaurants and Church pages, **Edit destination**, and **In your trips**, which lists each of your trips that visits it.

- **New destination.** **New destination** saves a city to research before it is in any trip (TRA-106). Only the city is needed, chosen with the same city search as everywhere else. The destination's page opens next, where you add and edit its photos, notes, budget amounts, hotels, activities, restaurants, churches and research as for any destination. Choosing a city you already have a destination for, in a trip or not, opens that destination instead and saves nothing new. A destination you create is yours, even when a trip shared with you visits another account's destination for the same city.
- **Adding to a trip.** **Add destination** on a trip's page asks only for the city, chosen with the same city search (TRA-107). When the trip's owner already has a destination for that city, such as one created with **New destination**, one researched for another trip, or one removed from this trip, the trip visits it with everything saved for it, copying nothing. Any other city becomes a new destination. Either way it joins the route as the last stop, without nights or stay notes; enter them with its edit control when you know them. Connections between the earlier stops are kept, and the one from the previous last stop to the return city is replaced by connections to and from the new stop. Choosing a city the trip already visits adds nothing: the page shows that stop's card and says the city is already in the trip. A trip that the schema 21 upgrade left visiting a city twice shows its first stay there.
- **One destination per city.** Each owner has one destination for each city, shared by every trip of theirs that visits it. Cities match on their full saved name, ignoring letter case, extra spaces, and how accented letters are encoded, so same-named cities in different states, regions or countries stay separate. Adding a city to a trip visits the trip owner's destination for it when there is one, as described above, and renaming a destination to another saved destination's city is refused.
- **Shared by its trips.** A destination's notes, photos, hotels, activities and restaurants with their selections (the chosen hotel, included ideas and Must do), churches and Church visibility, entry requirements, health and safety, typical weather, and every budget amount, rate and method belong to the destination. Change them from its page in Destinations or from any trip's page, and the change appears in every trip that visits it. Renaming its city clears its travel connections in every trip that visits it.
- **Kept by each trip.** Each trip keeps its own order, stay notes, nights, calculated arrival and departure dates, and travel connections, so the same city can be a 2-night stay in one trip and a 5-night stay in another. Change them from the trip's page; editing from Destinations has no nights or stay notes. Each trip's estimate for the destination applies the shared rates to that trip's nights, and **In your trips** shows each stay's nights, dates and estimate. In Destinations, totals that need nights wait for a trip, and Church shows unless hidden, without Sunday dates, which come from each trip's stay.
- **Removing.** **Remove from trip** on a trip's destination card removes only that trip's stay: its nights, stay notes, and connections to and from it. The route reconnects, and the destination stays in Destinations with everything saved for it. Deleting a trip keeps its destinations the same way. Adding the city to the trip again brings the destination back with everything saved for it, as a new stay.
- **Deleting.** The owner of a destination that is in no trip can delete it from its page, after confirming. Deleting permanently removes it with everything saved for it: hotels, activities, restaurants, churches, photos, notes, budget amounts, entry requirements, health and safety, and typical weather. A destination any trip visits can't be deleted, and its page offers no delete; remove it from each trip first. People a trip is shared with can't delete destinations.
- **Sharing.** A destination added to a trip belongs to the trip's owner, even when someone the trip is shared with adds it. When they add a city the owner already has, the trip visits the owner's destination for it, never one of their own, so everyone with the trip can then see and change what the owner saved for it. People a trip is shared with see the destinations it visits in Destinations, marked **Shared by** the owner, and can change them, including for the owner's other trips that visit them, but **In your trips** lists only the trips they can open.
- **Upgrade.** The schema 21 upgrade combines each owner's existing destinations for the same city into one, keeping each trip's stay, dates and connections; see [deployment](docs/DEPLOYMENT.md#schema-21-shared-destinations-tra-105) for how differing details are combined.

## AI assistants
Travel's designated owner, the Google account named by `TRAVEL_OWNER_EMAIL`, can connect ChatGPT and Claude to Travel's MCP endpoint, `/api/mcp` (TRA-115). Each assistant reads all of Travel and proposes changes; nothing changes until the owner approves a proposal on Travel's own page. **AI assistants** in the header, shown only to the designated owner, has the endpoint's address, the connections and the latest proposals. Anyone else finds no such page.

- **Connecting.** Add Travel as a custom connector with the endpoint's address: in Claude, Settings → Connectors → Add custom connector; in ChatGPT, a custom app or connector with developer mode on and OAuth authentication. The assistant registers itself with Travel and opens Travel's **Connect** page, where the owner chooses **Allow** or **Cancel**. Sign in to Travel in that browser first: after signing in, Travel opens All trips, not the Connect page, so start connecting again. Only the designated owner can allow a connection; anyone else signed in is told so. Travel sends authorizations only to Claude's and ChatGPT's own OAuth callbacks, so no other app can be connected. Each Allow makes a separate connection.
- **What assistants read.** Every trip, destination and account, whoever owns them: trip details, owners and sharing, tags, stays, travel, At home items, budgets, destinations with their ideas, churches, research and photos, and each account's email, Google name and whether it has signed in. Never Google account identifiers, sessions, or any code or token.
- **Proposals.** An assistant proposes up to 50 of the planner's own changes at once, with a summary of up to 200 characters. They may apply to any trip or destination, whoever owns it, including deleting trips and changing who they are shared with, and they follow the same rules as editing in Travel. A trip or destination an assistant adds belongs to the designated owner. Photos can't be added, removed or arranged. A change that adds a trip, idea, church or At home item names it with a new ID, so later changes in the same proposal can change it; a city added to a trip gets its IDs only once approved. A proposal the rules refuse is never recorded, and the assistant is told which change was refused and why.
- **Reviewing.** The assistant gives the owner a link to the proposal's page, which lists each change and every record it adds, changes or deletes, field by field, before and after, including what follows from it, such as travel connections cleared by a new city or an email authorized by sharing. **Approve every change** makes all of them in one transaction, exactly as shown, or none: if Travel has changed since in a way that would make a change do anything else, or a rule refuses one, nothing changes and the proposal fails with the reason. **Reject** changes nothing. Each proposal is decided once, within 24 hours, after which it expires. A database failure while approving, such as a full disk, also changes nothing, and leaves the proposal to approve again. The assistant reads what became of it.
- **Ordinary access is unchanged.** An assistant's reach comes only through the owner's approval of each proposal; what each signed-in account can open and change in Travel itself stays as described above.
- **Connections.** An assistant's access lasts an hour at a time and is renewed with a single-use refresh token; a connection not renewed for 30 days ends. **Revoke** in AI assistants ends a connection at once and withdraws its proposals. Starting Travel with a different `TRAVEL_OWNER_EMAIL` ends the previous owner's connections. Codes and tokens are stored only as hashes, as sessions are. Registrations never allowed are removed after a day, and at most 100 can wait at once.
- **Upgrade.** Schema 24 adds the connection and proposal tables and changes no trip (see [deployment](docs/DEPLOYMENT.md#schema-24-chatgpt-and-claude-connections-and-proposals-tra-115)).

## Checks
CI runs these on every pull request and before every deployment (`.github/workflows/check.yml`):
```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
bash scripts/smoke-container.sh
```
The container smoke script needs Docker and Bash. It builds the image and checks the container, persistent storage, sign-in enforcement, trip and destination isolation, and that only the designated owner reaches AI assistants and only an access token reaches the MCP endpoint, which a Next.js build alone does not verify.

After building, CI also runs `node scripts/review-errors-smoke.mjs` to check production page status codes, failure recovery, and save validation with health-, image-, and page-first store initialization, and connecting Claude, from registration and the owner's consent to MCP reads, a proposal, its approval and revoking the connection. It creates disposable databases and logs under `test-results`, using fixture sessions without contacting Google. You can run the same command locally.

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
Trip and destination pages fetch only the relevant trip's or destination's data. Home-page budgets are computed on the server and reused while searching, and saves refresh the displayed page without returning the entire database to the browser. The unused Next.js image optimizer is disabled; existing photo routes and galleries are unchanged.

Production deployments require a verified, encrypted off-host backup before replacing the running application, and the server also sends one to the Windows receiver daily at 03:00 UTC. The one-time administrator setup, its November 9, 2026 verification and the isolated restore rehearsal are described in [deployment](docs/DEPLOYMENT.md).

## Travel 1.8 review fixes
Save failures keep their specific validation message even when an API route opens the database first. Unexpected failures retain the generic save error.

City suggestions limit upstream requests within the single application process to 300 per rolling minute, 2,500 per hour, and 8,000 per day, with at most eight concurrent requests. An anonymous client cookie provides best-effort limits of 20 upstream requests per minute and two concurrent requests per client. An upstream rate-limit response pauses new lookups for 60 seconds. Cached suggestions remain available; manual city entry still works when new suggestions are temporarily unavailable. These in-memory limits reset when the process restarts.

Feedback errors appear only when there is a message. Unreadable server responses show the standard friendly error, and **Send** can retry failed initialization without closing the sheet or losing the draft. Pending submissions still prevent duplicate sends.

The error page's **Try again** reloads failed server data. Initial requests for missing trips, destinations, or categories return HTTP 404; server-rendering failures return HTTP 500. Pages wait for their server checks before sending a response, instead of streaming the root loading screen first.

## Trip dates and nights
Set the trip's optional **Start date**, then enter each destination's nonnegative whole number of **Nights** from the trip's page. Nights and stay notes belong to the trip, so a destination shared with other trips can have different nights in each. Arrival and departure dates, their weekdays, and the trip end date are calculated in destination order. A departure is the next destination's arrival; changing the start, nights, or order recalculates the route. A zero-night stop arrives and departs on the same day. Dates cannot be overridden individually. Travel-leg timing notes do not determine the schedule.

Missing start dates or night counts leave affected dates and the trip end incomplete. Earlier complete destinations retain their calculated ranges. Nights still drive budget estimates even when the trip start is unknown. Stay notes and the trip's flexible date label remain descriptive text and are never parsed.

Schema 15 preserves original arrival/departure values separately. It backfills only valid, consistent structured dates; gaps, overlaps, invalid dates, and incomplete chains require review. Preserved dates appear beside incomplete schedules so you can set the start and nights deliberately. Migration replay retains later edits. See [deployment and rollback](docs/DEPLOYMENT.md) before upgrading.

## Budget rules
Every price is in **USD**, for the entire traveling party, with at most two decimal places. Currency selectors have been removed. Existing USD amounts retain their exact cents. Startup stops on unexpected non-USD records without converting or relabeling them; review those records before deployment.

Every amount follows the same rules, from destination budgets to the estimated prices of ideas, travel connections and at-home tasks: zero or more, at most two decimal places, and no more than $100,000,000. An amount outside them is refused with the same message in every field, naming that field. A subtotal too large to calculate exactly shows as not estimated, never as an inexact amount.

A destination's amounts, rates and methods are shared by every trip that visits it, and each trip's estimate uses its own nights. The estimate sums every travel leg, one selected hotel or the general nightly estimate per destination, the selected activities and food methods, miscellaneous spending, shopping, and entered at-home expenses. Alternatives stay saved without contributing. Missing required amounts remain visibly unknown; zero is known. At-home and shopping amounts are optional: blank adds no cost and does not make a complete estimate partial.

Changing a destination, departing city, or effective return city clears only affected travel plans, including links and itinerary; renaming a destination clears them in every trip that visits it. Reordering destinations keeps unchanged connections.

## Daily miscellaneous spending
Enter a daily miscellaneous amount in the destination editor or with **Edit miscellaneous budget**. The subtotal is daily amount × nights, except a **zero-night stop uses one full budget day**. For example, three nights uses three days, one night uses one day, and zero nights also uses one day. The preview updates as nights and the amount change. Missing nights or amounts keep the estimate partial, including a zero amount with unknown nights. Clearing the amount marks it unknown.

## Nightly hotel estimate
Enter a general nightly amount in the destination editor or from Hotels. Its subtotal is nightly amount × nights; a zero-night stay costs zero when its rate is known. Unknown nights or a missing rate remain unestimated.

With no hotel selected, the general estimate supplies accommodation. Selecting a hotel replaces it with that hotel's whole-stay price, counted once. A selected hotel with an unknown price keeps accommodation unknown. Selecting, editing, unchecking, or deleting hotels preserves the general estimate; removing the selection restores it using the current nights.

## Activities budget
Choose **General budget** or **Itemized activity costs** in the destination editor, with **Edit budget** in a destination's Activities section, or on its Activities page. Itemized is the default. A general amount covers the whole stay once; nights and travelers never multiply it. Missing amounts keep totals partial only in General budget mode.

Itemized mode uses only included activities, with included missing prices keeping the estimate partial; no included activities contributes zero. Switching methods preserves the general amount, saved ideas, and selections. Editing ideas never switches the method.

## Food budget
Choose **Daily food budget** or **Itemized restaurant costs** in the destination editor, with **Edit budget** in a destination's Restaurants section, or on its Restaurants page. Itemized is the default. The daily amount uses the same duration as miscellaneous spending: nights, with **one full day for a zero-night stop**. Missing rates or nights are unknown, even for a zero rate, and make totals partial only in daily mode.

Daily mode excludes restaurant costs. Itemized mode counts only included restaurants' whole-party meal prices, with included missing prices keeping the estimate partial. No included restaurants contributes zero. Switching methods preserves entries, selections, and the daily estimate. Traveler count never multiplies amounts.

## Shopping budget
Use the edit control beside **Shopping**, or edit the destination, to enter an optional whole-stay amount. It is counted once, separately from miscellaneous spending. **Not set** adds no cost and is not a missing estimate. Zero is an intentional known amount. Clear the amount to remove its contribution.

## Destination controls
Each destination's **Budget** starts collapsed each time the page loads. It always lists Accommodation, Activities, Food, Shopping, and Miscellaneous with their amounts, with **Edit shopping budget** and **Edit miscellaneous budget** beside Shopping and Miscellaneous. The Hotels, Activities and Restaurants sections below it change Accommodation, Activities and Food, so the budget no longer links to those pages (TRA-120). Activities or Food with some included prices missing show **Partial estimate**. On a trip's page, the stay's nights, arrival, and departure sit above it and the destination estimate below. Select the **Budget** heading by mouse, touch, or keyboard to show or hide each category's calculations, breakdowns, and notes. Each destination's budget opens and closes on its own, and its edit controls work either way. Showing or hiding changes nothing saved, makes no server request, and is not remembered between visits.

Every editor keeps its title and close button (X) at the top, and **Cancel** on the left and its one **Save** or other confirming action on the right in a footer that stays at the bottom while the fields scroll (TRA-114). Pending state and save errors stay in view just above those buttons; Cancel discards the draft. Opening an editor focuses its first field (TRA-116).

Keyboard focus stays near the control you used in an editor when that control goes away or turns off (TRA-86). Removing a Mass time or a photo focuses the next one's **Remove**, or **Add Mass time** or **Add photos** after the last. **Undo photo changes** focuses **Add photos**, or the last photo's **Remove** when the saved photos fill the gallery. A destination photo or travel stop moved to the first or last place keeps focus on its other move control.

If a save's response doesn't arrive, as when the connection drops, the editor keeps the draft and says it couldn't confirm the changes were saved, because they may have been (TRA-75). Saving again from the same editor is safe: a new trip, idea, church or At home item is saved once, with the details sent last, and photos the first save added aren't added twice. Closing the editor and adding the item again would add a second one, so refresh to check first. Adding a city to a trip again, from any editor, shows the stop the first save added instead (TRA-107).

Changes made without an editor save as soon as you select them: the arrows that reorder destinations, an idea's **Up**, **Down**, **Must do** and budget selection, **Mark complete** and **Reopen** in At home, **Show Church** and **Hide Church**, and adding or removing a tag. If one fails, for example because the item was deleted in another tab, its error appears at the bottom of the screen wherever the page is scrolled, above **Send feedback** so neither covers the other (TRA-82). It stays until you dismiss it or start another change.

Of these, the arrows, an idea's controls, **Mark complete**, **Reopen**, **Show Church** and **Hide Church** return keyboard focus to the control you used once the page shows the change, so pressing Enter again repeats it: **Move down** twice moves a destination two places (TRA-86). A destination or idea moved to the first or last place keeps focus on its other arrow, **Mark complete** and **Reopen** stay focused as they switch, and **Show Church** and **Hide Church** focus the one that replaces them. A failed change leaves focus on its control. If you move focus elsewhere while a change saves, it stays where you put it.

Each section's edit control opens an editor titled for that section with only its fields, while **Edit destination** in Destinations and the pencil on each trip destination card still open the complete destination editor (TRA-113). On Hotels, **Edit estimate & nights** opens the stay's nights and the general nightly estimate, with previews of the stay's dates and estimate; in Destinations, where nights belong to each trip, **Edit nightly estimate** opens the nightly estimate alone. The Hotels section's **Edit budget** opens the same editor, and the Activities and Restaurants sections' open the activities and food budget editors. **Edit miscellaneous budget** opens the daily miscellaneous amount, previewed with the stay's nights. On a trip's Restaurants page, **Edit destination nights** opens the stay's nights with a preview of its dates. Activities, Food, and Shopping keep their own editors. These editors keep Save and Cancel at the bottom. Saved nights recalculate the trip's dates and estimates as described in [Trip dates and nights](#trip-dates-and-nights).

The focused Typical Weather, Accommodation, Shopping, Food, Activities, Miscellaneous, and nights editors save only their own fields. Accommodation's are the nightly estimate and, in a trip, the stay's nights; the nights editor's are the stay's nights alone. If someone changes any other detail while one is open, such as the city, stay notes, or schedule, those newer details and saved travel connections are preserved. Intentionally renaming a city in the main destination editor still clears its affected connections.

## Hotels, activities and restaurants
Each destination card on a trip's page, and each destination's page in Destinations, shows **Hotels**, **Activities**, and **Restaurants** directly below its budget, each with how many ideas it has (TRA-120). They start expanded each time the page loads. Select a heading by mouse, touch, or keyboard to hide or show its ideas. Each opens and closes on its own, changes nothing saved, and is not remembered between visits.

Each section's carousel has a card for each idea, with its main photo, or an icon when it has none, its name, and its price, or **Not estimated**. Ideas chosen for the budget come first, marked **Chosen stay** or **In the plan**, then the rest, each group in its saved order. The left and right arrows scroll the cards, and each is unavailable once there are no more cards its way. Swiping or scrolling sideways also works.

Select a card to see that idea's details, read only and in its editor's order: its price and what it covers, address, photos, research links, notes, **Must do** for activities and restaurants, and its budget selection. **Edit** opens its editor. **Save changes** returns to the details, showing what was saved, and **Cancel** returns to them without saving. **Close** or X closes the details.

Each section's **Edit budget** opens its category's budget editor: Hotels, the accommodation budget, with the stay's nights on a trip's page; Activities, the activities budget; and Restaurants, the food budget. **Add hotel**, **Add activity**, and **Add restaurant** open the editor for a new idea. **Manage hotels**, **Manage activities**, and **Manage restaurants** open the category's full page, where ideas are reordered, marked **Must do**, chosen or included, and deleted.

These sections only present what is saved: they change no ideas, photos, prices, selections, or budgets.

## Entry requirements
Each destination card has an **Entry requirements** section for manually maintained research. Add or edit passport nationality, purpose of travel, traveler circumstances, visa or electronic authorization requirements, passport validity, entry or health documents, separate transit requirements, and notes. Save official government or immigration links with descriptions and the date you last checked the information. All fields are optional; unrecorded information does not mean no requirements apply.

The section starts collapsed each time the page loads, showing only its **Entry requirements** heading, **Add entry requirements** or **Edit entry requirements**, and **Clear** once requirements are recorded. Select the heading by mouse, touch, or keyboard to show or hide the current stay, recorded requirements, sources, last checked date, and explanatory notes. Each destination's section opens and closes on its own, and adding, editing, and clearing work either way. Showing or hiding changes nothing saved, makes no server request, and is not remembered between visits.

On a trip's page, that trip's calculated arrival, departure, and nights are shown for reference. Schedule changes preserve the research and its last checked date; saving does not automatically mark it checked. Verify requirements with official sources before traveling. Travel does not retrieve requirements, verify eligibility or documents, or monitor changes. **Clear** removes the record after confirmation; Cancel discards an editor draft. Requirements are stored with the destination (schema 18), shared by every trip that visits it, included in backups, and kept when the destination leaves a trip or its trip is deleted.

## Health and safety
Each destination card, and each destination's page in Destinations, has a **Health and safety** section for manually maintained research, separate from **Entry requirements** (TRA-14). Record the government travel advisory level and its warnings; health precautions such as recommended vaccinations and medical precautions; local safety concerns, common scams, areas to avoid, and general safety guidance; emergency contacts; official source links with descriptions; and the date you last checked the information. All fields are optional. Unrecorded fields show **Not recorded**, and the section notes that missing information does not mean the destination is safe or that no precautions are needed.

Add, edit, or remove up to 20 emergency contacts, each with a name, a phone number, and optional notes. Phone numbers may contain digits, spaces, plus signs, parentheses, hyphens, and periods; put an extension or an alternative number in the notes or in another contact. Sources are up to 20 http or https links with optional descriptions, as in Entry requirements.

The section starts collapsed each time the page loads, showing only its **Health and safety** heading, **Add health and safety** or **Edit health and safety**, and **Clear** once research is recorded. Select the heading by mouse, touch, or keyboard to show or hide the reminder to verify before traveling, the recorded research, emergency contacts, sources, and last checked date. Each destination's section opens and closes on its own, and adding, editing, and clearing work either way. Showing or hiding changes nothing saved, makes no server request, and is not remembered between visits.

The last checked date is only what you enter: saving never sets or changes it, and Travel never marks research as outdated because of its age. Verify advisories, health guidance, and contacts with official sources before traveling. Travel does not retrieve advisories, health information, or emergency contacts, monitor them for changes, or give medical advice. **Clear** removes the record after confirmation; Cancel discards an editor draft. Research is stored with the destination (schema 22), shared by every trip that visits it, kept when dates or other destination details change, included in backups, and kept when the destination leaves a trip or its trip is deleted.

## Idea priorities and ordering
Each destination's Hotels, Activities, and Restaurants page, opened with **Manage hotels**, **Manage activities**, or **Manage restaurants**, has **Up** and **Down** controls on each idea. Use them by mouse, touch, or keyboard to save your preferred order. Each destination and category keeps its own order; newly added ideas appear at the end, and editing a name leaves its position unchanged. A destination's carousels show the ideas chosen for the budget first, each group in this order. The **Add hotel**, **Add activity**, or **Add restaurant** button appears below the list and remains available when the list is empty.

Mark activities and restaurants as **Must do** from their cards or editor; select the control again to remove the marker. This priority is independent of budget inclusion and does not change list order, prices, or budgeting methods. Hotels retain their separate chosen-stay selection.

Schema 16 preserves each existing list's alphabetical order on its first upgrade, with no ideas initially marked Must do. Order and priority survive reopening, backups, and migration replay. See [deployment and rollback](docs/DEPLOYMENT.md) before upgrading.

## Typical weather
Each destination card on the main trip page, and each destination's page in Destinations, shows **Typical weather** with **Edit typical weather**. Category detail pages do not repeat it. Enter optional high and low temperatures in °F, rainfall notes, the month or period described, and a source name or link. These are manually recorded typical conditions; there is no automatic lookup or Celsius conversion.

The section starts collapsed each time the page loads, showing only its **Typical weather** heading and **Edit typical weather**. Select the heading by mouse, touch, or keyboard to show or hide the temperatures, period, rainfall notes, source, and explanation. Each destination's section opens and closes on its own, and **Edit typical weather** works either way. Showing or hiding changes nothing saved, makes no server request, and is not remembered between visits.

Negative and decimal Fahrenheit values are accepted; high must be at least low when both are supplied. Missing values show **Not provided** and zero shows **0 °F**. Clear individual fields or use **Clear all weather fields** and save. Weather and its recorded period persist independently of schedule and budget changes.

## Church
Each main destination card can show **Church**. New destinations show it while dates are unknown. With a complete date range it is eligible only when that inclusive range contains a Sunday, including Sunday arrivals, departures, and same-day stops. Both destinations sharing a Sunday transfer are eligible. Manual showing cannot override a known range without Sunday.

Hide Church without deleting entries or photos. Hiding persists through date changes and applies in every trip that visits the destination; eligible hidden destinations offer **Show Church**. Each trip's own dates decide whether its card can show Church. Upgrades preserve existing visibility choices, including previously disabled sections. Church is absent from category navigation; existing direct Church URLs still work and respect date eligibility and hiding.

Visible Church sections list every Sunday in the calculated stay, including arrival/departure Sundays, shared transfer days, and zero-night Sunday visits. The dates update when the trip start, destination order, or nights change. Unknown schedules show no assumed Sunday. These dates do not verify the recorded Mass times; confirm them with the church.

Add, edit, or remove multiple churches with name, address, optional denomination and website, and up to 30 Mass times with a day or date. Missing times show **Mass times unknown**. Church galleries use the photo controls below. Entries, visibility, Mass times, and photos persist in the same database and backups, and do not change idea counts or budgets.

## Feedback
**Send feedback** is available across the app in the bottom-right corner. With an editor open it stays there, above the backdrop, and the editor ends above it so neither covers the other. A save's message appears just above it on every screen size, in the same place as the errors of changes made without an editor, so neither covers the other. The message closes after five seconds, or sooner with its X (TRA-84). Feedback opens over the editor, and closing or sending it returns to the editor with its draft and focus kept. Messages allow 2,000 characters. Submission shows a pending state, prevents duplicate clicks, and reports success only after Jira confirms creation. Failures preserve the draft for retry; opening again after success starts a fresh message.

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
Each trip has an **At home** section below **Between the places**, even before destinations are added. Add, edit, or delete arrangements such as house sitting, child care, pet care, or pausing mail. Each item has a name, notes, an optional total price in USD, and a completion checkbox. The price is typed, with cents if needed, such as 12.50; its field has no increment and decrement arrows (TRA-46). Completed items can be reopened and remain visible. Items and expenses belong only to their trip and are included in backups.

## City suggestions
The Departing city, optional Return city, and City or destination fields use the [Open-Meteo geocoding API](https://open-meteo.com/en/docs/geocoding-api), with location data from [GeoNames](https://www.geonames.org/). Suggestions are optional; manually entered cities still work. They open when you type in the field or press the Down or Up arrow, not when it gets focus, so an editor that opens on a saved city shows no list and one Escape closes it (TRA-116). Searches of at least two characters are sent through `/api/locations`; adding a state or country (for example `Wooster, OH`) narrows results.

Destinations display as city and country, or city and state for US locations. Suggestions retain region details to distinguish same-named cities. Full selected labels remain stored so this display change and unchanged edits preserve travel plans; recognized older city/region/country labels are shortened on screen, while custom text remains supported.

The provider needs no key for this personal, non-commercial app. Its [free-service terms](https://open-meteo.com/en/terms) currently allow fewer than 10,000 calls per day, 5,000 per hour, and 600 per minute; commercial use needs a suitable plan or another provider. Lookup uses a four-second timeout, shares simultaneous matching queries, and keeps up to 200 queries in memory for ten minutes. The provider and response mapping live in `src/lib/location-search.ts`; no coordinates or extra location metadata are stored with a trip.

## Routes, itineraries, and research links
Trips return to their departing city by default. Select **Return to a different city** to enter a separate endpoint. Existing trips retain their departure location and default return behavior.
Each travel connection supports up to 30 ordered layovers or stops, with a place, arrival/departure details, and notes. The connection's estimated price covers the whole itinerary and is counted once in the trip budget. The price is typed, with cents if needed, such as 12.50; its field has no increment and decrement arrows (TRA-49).
Each connection in **Between the places** shows an icon for each kind of transportation its saved Transportation text names, once per kind and in the order entered: airplane (flight, airplane, flying, air, jet), train (train, rail, subway, tram), car (car, driving, rental car, taxi, rideshare, road, Uber, Lyft), bus (bus, coach, shuttle), boat (boat, ferry, cruise, ship, sea, water), walking (walking, on foot), and bicycle (bike, bicycle, cycling). Terms match as complete words or phrases in any capitalization, so "Train and flight" shows a train and then an airplane, and "Airbnb" matches nothing. Blank or unrecognized text shows a generic route icon. The Transportation field stays free text; the terms live in `src/lib/transportation-methods.ts`.
Connections and hotel/activity/restaurant ideas support up to 20 research links with optional short descriptions. Existing single links are retained during the additive database upgrade. Older schema versions upgrade to the current version automatically inside a transaction; take an online backup before deploying this upgrade.
## Images
Each destination, hotel, activity, restaurant, and church can have up to 10 photos, with one selected as the main photo on its card. Click the thumbnails to view the other photos. Add photos, choose the main photo, or remove individual photos in the editor; removing the main photo selects another remaining photo. Cancel discards photo changes. Existing single idea images become the main photo automatically.

Destination galleries also have **Move left** and **Move right** controls in the editor to save photo order. The primary photo opens first, independently of its position in the thumbnail order. Removing it chooses the first remaining photo. Schema 17 preserves each existing destination image, including its bytes and version, as that destination's primary photo. Existing single-image URLs continue to serve the current primary photo; individual photo URLs retain ownership and version checks. Ordinary destination edits preserve the gallery.
JPEG, PNG, and WebP uploads up to 5 MiB each and 20 megapixels are supported, with at most 15 MiB of new files in one save. Images are oriented, resized to fit 1600 × 1200, stripped of metadata, and saved as WebP (up to 2 MiB each). All selected uploads must be valid before any changes are saved.
Images live in the same persistent SQLite database and are included in online backups. Snapshots carry only photo IDs, versions, and the main selection; image routes serve separate, versioned responses. Image-only edits preserve travel plans, prices, research links, and budget selections.

## Saving after a deploy
Every deploy builds with the same Server Actions key, so a page opened before a deploy keeps saving after it. If a save reaches a version of the planner that doesn't recognize it, because the key or the save action itself changed, it shows **The planner was updated. Your changes haven't been saved. Please reload the page and try again.** instead of the connection error, since trying again without reloading never works. Adding an item from a page opened before TRA-75, which doesn't send the new item's ID, shows the same message; that page's changes to saved items keep working. Deploying requires the key; see [deployment](docs/DEPLOYMENT.md#server-actions-key-tra-74).

## Database failures
A save the database can't complete, as when the disk is full, saves nothing and shows **We couldn't save your changes. Please try again.** The server log names SQLite's own error, such as `database or disk is full`, rather than an error from undoing the save (TRA-93). Saving works again once there is room, without a restart.

If the database can't be opened, because its file isn't a database or another process holds its write lock, the request that tried fails and closes its connection, and the next request tries again. While another process holds the write lock, each try waits up to 5 seconds for it.

## Hosting
The existing GitHub Actions deployment builds a Node container and deploys it to Dokku at travel.dev.boyersoftware.com after checks pass. Only `main` deploys, only to the server with the verified SSH host key, and with the 20 MiB request limit photo uploads need; see [deployment safeguards](docs/DEPLOYMENT.md#deployment-safeguards-tra-98).
**Provision persistent storage before the first app deployment.** See [deployment and recovery instructions](docs/DEPLOYMENT.md).
This version runs one application instance with SQLite. Google Sign In requires the production settings in [deployment](docs/DEPLOYMENT.md#google-sign-in-tra-103); trip ownership and sharing need no further settings, but the schema 20 upgrade assigns existing trips to `TRAVEL_OWNER_EMAIL` (see [deployment](docs/DEPLOYMENT.md#schema-20-trip-ownership-and-sharing-tra-104)), and the schema 21 upgrade combines each owner's same-city destinations (see [deployment](docs/DEPLOYMENT.md#schema-21-shared-destinations-tra-105)). Live collaboration and conflict resolution are future work.

## Backups
```sh
pnpm backup ./backups/travel-2026-10-07.sqlite
```
The backup uses SQLite's online backup API, checks integrity, and refuses to overwrite an existing backup.
It reads `TRAVEL_DATABASE_PATH` from the environment, then `.env.local`, then `.env`, and otherwise backs up `data/travel.sqlite`.
Store backups outside the repository and keep a copy off the server.

See [PLAN.md](PLAN.md) for the agreed scope and acceptance checks.
