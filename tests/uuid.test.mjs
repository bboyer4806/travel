import test from "node:test";
import assert from "node:assert/strict";
import { randomUuid } from "../src/lib/uuid.ts";

const VERSION_4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("new IDs come from crypto.randomUUID where the browser offers it", (t) => {
  const native = t.mock.method(crypto, "randomUUID");
  const id = randomUuid();
  assert.equal(native.mock.callCount(), 1);
  assert.equal(id, native.mock.calls[0].result);
  assert.match(id, VERSION_4);
});

test("over plain HTTP, new IDs are version 4 UUIDs from crypto.getRandomValues", (t) => {
  // Browsers leave randomUUID out of insecure contexts, such as http:// on a local network.
  Object.defineProperty(crypto, "randomUUID", { value: undefined, configurable: true });
  t.after(() => delete crypto.randomUUID);
  const secure = t.mock.method(crypto, "getRandomValues");
  t.mock.method(Math, "random", () => { throw new Error("Math.random is not a secure generator."); });
  const ids = Array.from({ length: 10_000 }, () => randomUuid());
  assert.equal(secure.mock.callCount(), ids.length);
  for (const id of ids) assert.match(id, VERSION_4);
  assert.equal(new Set(ids).size, ids.length);
});
