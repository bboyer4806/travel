// Where focus goes as editors open and close (TRA-116, TRA-114), in Chromium at desktop and phone sizes.
// Run after pnpm build with Node 24. It uses an isolated database under test-results and a fixture
// session, as review-errors-smoke.mjs does; Google is never called.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, devices } from "playwright";
import { createStore } from "../src/lib/store.ts";
import { sessionCookieName } from "../src/lib/session-cookie.ts";

assert.equal(process.versions.node.split(".")[0], "24", "Run this check with Node 24.");
assert.ok(existsSync(".next/BUILD_ID"), "Run pnpm build before the editor focus check.");
const build = JSON.parse(readFileSync(".next/required-server-files.json", "utf8"));
const standalone = join(resolve(".next/standalone"), relative(build.config.outputFileTracingRoot ?? resolve("."), resolve(".")));
assert.ok(existsSync(join(standalone, "server.js")), "The build must include the standalone server.");
if (existsSync("public")) cpSync("public", join(standalone, "public"), { recursive: true });
cpSync(".next/static", join(standalone, ".next/static"), { recursive: true });
mkdirSync("test-results", { recursive: true });
const directory = mkdtempSync(resolve("test-results/editor-focus-"));
const database = join(directory, "planner.sqlite");
const ownerEmail = "owner@example.test";
const store = createStore(database, ownerEmail);
const owner = store.authorizeAccount(ownerEmail);
assert.equal(store.authorizeGoogleSignIn({ subject: "editor-focus-owner", email: ownerEmail, emailVerified: true, name: "Focus Owner" })?.id, owner.id);
const token = store.createSession(owner.id, Date.now());
const tripId = store.applyMutation(owner.id, { type: "trip.save", name: "Focus trip", dateLabel: "", homeCity: "Wooster, OH", travelers: 2, notes: "" }).id;
const destinationId = store.applyMutation(owner.id, { type: "destination.save", tripId, city: "Vienna, Austria", notes: "", stay: "" }).id;
store.applyMutation(owner.id, { type: "homeItem.save", tripId, name: "House sitting", price: "", notes: "", completed: false });
store.applyMutation(owner.id, { type: "candidate.save", destinationId, category: "hotels", name: "Hotel Sacher", price: "", address: "", url: "", notes: "", included: false });
// Share then lists this person's Remove button before its email field.
store.applyMutation(owner.id, { type: "trip.share", tripId, email: "friend@example.test" });
const stopId = store.getTripSnapshot(owner.id, tripId).data.stops[0].id;
store.close();

const trip = `/trips/${tripId}`;
// Each editor and the field it opens on, with any control before that field that focus must skip.
// A confirmation has no field, so it opens on the X, never its confirming action.
const editors = [
  { page: trip, opener: 'button:has-text("Edit trip")', focus: 'input[name="name"]' },
  { page: trip, opener: '.heading-actions button:has-text("Share")', focus: 'input[name="email"]', skips: 'button:has-text("Remove")' },
  { page: trip, opener: 'button:has-text("Edit shopping budget")', focus: 'input[name="shoppingAmount"]' },
  { page: trip, opener: 'button[aria-label^="Edit travel from"]', focus: 'input[name="method"]' },
  { page: trip, opener: 'button[aria-label="Edit House sitting"]', focus: 'input[name="name"]' },
  { page: trip, opener: 'button[aria-label="Delete trip"]', focus: 'button[aria-label="Close"]' },
  { page: `${trip}/destinations/${stopId}/hotels`, opener: 'button[aria-label="Edit Hotel Sacher"]', focus: 'input[name="name"]' },
  { page: "/destinations", opener: 'button:has-text("New destination")', focus: 'input[role="combobox"]' },
];

const probe = createServer();
probe.listen(0, "127.0.0.1");
await once(probe, "listening");
const port = probe.address().port;
await new Promise((resolveClose) => probe.close(resolveClose));
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [join(standalone, "server.js")], {
  env: {
    ...process.env, NODE_ENV: "production", GOOGLE_CLIENT_ID: "editor-focus-client", GOOGLE_CLIENT_SECRET: "editor-focus-secret",
    TRAVEL_OWNER_EMAIL: ownerEmail, TRAVEL_DATABASE_PATH: database, HOSTNAME: "127.0.0.1", PORT: String(port),
  },
  windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
});
let output = "";
server.stdout.on("data", (data) => { output += data; });
server.stderr.on("data", (data) => { output += data; });
const exited = once(server, "exit");

/** The focused element's markup, for failure messages. */
const focused = (page) => page.evaluate(() => document.activeElement?.outerHTML.slice(0, 160) ?? "nothing");
async function expectFocus(page, check, arg, message) {
  try { await page.waitForFunction(check, arg, { timeout: 2000 }); }
  catch (error) { assert.fail(`${message}; focus is on ${await focused(page)} (${error.message.split("\n")[0]})`); }
}
async function visit(page, path) {
  await page.goto(origin + path);
  // A click before hydration does nothing, so wait until React has attached to the page's buttons.
  await page.waitForFunction(() => Object.keys(document.querySelector("main button") ?? {}).some((key) => key.startsWith("__reactProps")));
}
async function open(page, opener) {
  const button = page.locator("main " + opener).first();
  const handle = await button.elementHandle();
  await button.click();
  await page.locator("dialog.editor-dialog[open]").waitFor();
  return handle;
}
async function expectOpenerFocused(page, opener, name) {
  await page.locator("dialog.editor-dialog").waitFor({ state: "detached" });
  await expectFocus(page, (element) => document.activeElement === element, opener, `Closing ${name} returns focus to the control that opened it`);
}
const settle = (page) => page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
const cancel = (page) => page.locator('dialog.editor-dialog .dialog-actions button:has-text("Cancel")').click();

let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 100 && !ready; attempt++) {
    if (server.exitCode !== null) throw new Error(`Production server exited: ${output}`);
    try { ready = (await fetch(origin + "/login", { signal: AbortSignal.timeout(1000) })).status === 200; } catch {}
    if (!ready) await delay(100);
  }
  assert.ok(ready, `Production server did not become ready: ${output}`);
  browser = await chromium.launch();
  for (const [size, options] of [["desktop", { viewport: { width: 1280, height: 800 } }], ["phone", devices["Pixel 7"]]]) {
    const context = await browser.newContext(options);
    await context.addCookies([{ name: sessionCookieName(false), value: token, url: origin }]);
    const page = await context.newPage();
    for (const editor of editors) {
      if (page.url() !== origin + editor.page) await visit(page, editor.page);
      const name = `${size} ${editor.opener}`;
      const opener = await open(page, editor.opener);
      if (editor.skips) assert.equal(await page.locator("dialog.editor-dialog " + editor.skips).count(), 1, `${name} has ${editor.skips} for focus to skip`);
      await expectFocus(page, (selector) => document.querySelector("dialog.editor-dialog")?.contains(document.activeElement) && document.activeElement.matches(selector), editor.focus, `${name} opens on ${editor.focus}`);
      await cancel(page);
      await expectOpenerFocused(page, opener, name);
    }

    // A saved city opens focused with no suggestion list, so one Escape closes the editor.
    await visit(page, trip);
    let opener = await open(page, '.destination-card button[aria-label^="Edit Vienna"]');
    await expectFocus(page, () => document.activeElement?.matches('dialog.editor-dialog input[role="combobox"]'), null, `${size} Edit destination opens on City or destination`);
    await settle(page);
    assert.equal(await page.locator("dialog.editor-dialog .location-panel").count(), 0, `${size} Edit destination opens without city suggestions`);
    await page.keyboard.press("Escape");
    await expectOpenerFocused(page, opener, `${size} Edit destination with one Escape`);

    // Send feedback from an editor returns to that editor with its focus and draft.
    opener = await open(page, 'button:has-text("Edit trip")');
    await page.locator('dialog.editor-dialog input[name="name"]').fill("Draft kept");
    const feedback = page.locator('dialog.editor-dialog button:has-text("Send feedback")');
    const feedbackButton = await feedback.elementHandle();
    await feedback.click();
    await page.locator("dialog.feedback-dialog[open]").waitFor();
    await page.keyboard.press("Escape");
    await page.locator("dialog.feedback-dialog[open]").waitFor({ state: "detached" });
    await expectFocus(page, (element) => document.activeElement === element, feedbackButton, `${size} closing Send feedback returns focus to the editor`);
    assert.equal(await page.locator('dialog.editor-dialog input[name="name"]').inputValue(), "Draft kept", `${size} Send feedback keeps the editor's draft`);
    await cancel(page);
    await expectOpenerFocused(page, opener, `${size} Edit trip after Send feedback`);
    await context.close();
    console.log(`Passed ${size}: ${editors.length + 1} editors open on their first field or the X, closing returns focus, and Send feedback returns to its editor.`);
  }
} finally {
  await browser?.close();
  if (server.exitCode === null && server.signalCode === null) server.kill();
  await exited;
  writeFileSync(join(directory, "server.log"), output);
}
console.log("Isolated fixture and server log:", directory);
