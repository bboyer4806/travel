import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { feedbackIssue, validateFeedback } from "../src/lib/feedback.ts";

const LIMIT = 256 * 1024;
const url = "http://127.0.0.1:3010/rest/api/3/issue";
const issue = (message, context = {}) => JSON.stringify(feedbackIssue(validateFeedback({ message, page: "/trips/demo", browser: "Test browser", viewport: "390 × 844", ...context })));
const post = (body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body });

// The documented command, on its documented loopback address.
let stub;
before(async () => {
  stub = spawn(process.execPath, ["scripts/jira-feedback-stub.mjs"], { stdio: ["ignore", "pipe", "inherit"] });
  const [line] = await Promise.race([once(stub.stdout, "data"), once(stub, "exit").then(() => { throw new Error("The stand-in did not start."); })]);
  assert.equal(String(line), "Jira feedback stand-in: http://127.0.0.1:3010\n");
});
after(() => stub.kill());

test("the stand-in accepts 1,000-line messages and the largest issue the app can send", async () => {
  const thousandLines = issue(Array.from({ length: 1000 }, () => "é").join("\n"));
  // Every new line adds an ADF paragraph, and control characters are escaped as six bytes.
  const largest = issue("a" + "\n".repeat(1998) + "a", { page: "/" + "\u0001".repeat(2047), browser: "\u0001".repeat(1024), viewport: "\u0001".repeat(40) });
  assert.ok(Buffer.byteLength(thousandLines) > 24_000 && Buffer.byteLength(largest) < LIMIT);
  for (const body of [thousandLines, largest]) {
    const response = await post(body);
    assert.equal(response.status, 201);
    assert.match((await response.json()).key, /^TRA-STUB-\d+$/);
  }
});

test("the stand-in counts bytes, not characters, and answers larger requests with 413", async () => {
  const multibyte = JSON.stringify({ fields: { description: "é".repeat(LIMIT / 2) } });
  assert.ok(multibyte.length < LIMIT && Buffer.byteLength(multibyte) > LIMIT);
  assert.equal((await post(multibyte)).status, 413);
  const valid = issue("A useful improvement");
  assert.equal((await post(valid + " ".repeat(LIMIT - Buffer.byteLength(valid)))).status, 201);
  assert.equal((await post(valid + " ".repeat(LIMIT - Buffer.byteLength(valid) + 1))).status, 413);
});

test("the stand-in rejects malformed and invalid payloads with 400", async () => {
  const valid = issue("A useful improvement");
  const { fields } = JSON.parse(valid);
  const notUtf8 = Buffer.from(valid);
  notUtf8[notUtf8.indexOf("useful")] = 0xff;
  for (const body of ["{", notUtf8, "{}", JSON.stringify({ fields: { ...fields, project: { key: "MEA" } } }), JSON.stringify({ fields: { ...fields, labels: [] } })]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.equal((await fetch(url)).status, 404);
});
