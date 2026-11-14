import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:net";
import { Readable } from "node:stream";
import test from "node:test";
import { downloadAddress, downloadImage, isPublicAddress, MAX_IMAGE_REDIRECTS, publicLookup } from "../src/lib/image-download.ts";
import { MAX_IMAGE_UPLOAD_BYTES } from "../src/lib/image-limits.ts";
import { ImageValidationError } from "../src/lib/image-upload.ts";

const PRIVATE = /^Travel doesn't download photos from private, loopback or link-local addresses\.$/;
const refusal = (message) => (error) => error instanceof ImageValidationError && message.test(error.message);

/** A response as Travel's own request returns it, its body read from `body`. */
function respond(statusCode, headers = {}, body = []) {
  return Object.assign(Readable.from(body), { statusCode, headers });
}
/** A fetch answering each address from `routes`, and recording what was requested. An address without a route can't be reached. */
function fake(routes) {
  const requested = [];
  const fetch = async (url, signal) => {
    requested.push(url.href);
    const route = routes[url.href];
    if (!route) throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    return route(signal);
  };
  return { fetch, requested };
}
const jpeg = (...chunks) => () => respond(200, { "content-type": "image/jpeg" }, chunks.map((chunk) => Buffer.from(chunk)));
const redirect = (status, location) => () => respond(status, location === undefined ? {} : { location });
const download = (address, fetch, signal = AbortSignal.timeout(5000)) => downloadImage(address, signal, fetch);

test("only public internet addresses count as public", () => {
  for (const address of ["8.8.8.8", "1.1.1.1", "11.0.0.1", "100.128.0.1", "169.255.0.1", "172.32.0.1", "192.169.0.1", "2606:4700:4700::1111", "2a00:1450:4001:80b::200e"]) {
    assert.equal(isPublicAddress(address), true, address);
  }
  for (const address of [
    "0.0.0.0", "10.1.2.3", "100.64.0.1", "127.0.0.1", "127.255.255.254", "169.254.169.254", "172.16.0.1", "172.31.255.255", "192.0.0.1", "192.0.2.1", "192.88.99.1",
    "192.168.1.1", "198.18.0.1", "198.51.100.1", "203.0.113.1", "224.0.0.1", "240.0.0.1", "255.255.255.255",
    "::", "::1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "64:ff9b::7f00:1", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "2001::1", "2001:db8::1", "2002:7f00:1::1", "3fff::1",
    "localhost", "not an address", "",
  ]) {
    assert.equal(isPublicAddress(address), false, address);
  }
});

test("a photo's address is https://, without credentials, and never a private IP address, however it is written", () => {
  assert.equal(downloadAddress("https://images.example.com/a.jpg").href, "https://images.example.com/a.jpg");
  assert.equal(downloadAddress("https://8.8.8.8/a.jpg").hostname, "8.8.8.8");
  assert.equal(downloadAddress("/b.png", new URL("https://images.example.com/photos/a.jpg")).href, "https://images.example.com/b.png", "a redirect is read relative to the address it came from");
  const refusals = [
    ["not an address", /^This isn't a web address/],
    ...["http://images.example.com/a.jpg", "ftp://images.example.com/a.jpg", "data:image/png;base64,AAAA", "file:///etc/passwd"].map((address) => [address, /^Travel downloads photos only from https:\/\/ addresses\.$/]),
    ["https://user:secret@images.example.com/a.jpg", /without a user name or password/],
    ...["https://127.0.0.1/a.jpg", "https://2130706433/a.jpg", "https://0x7f.1/a.jpg", "https://127.1/a.jpg", "https://017700000001/a.jpg", "https://[::1]/a.jpg", "https://[::ffff:127.0.0.1]/a.jpg",
      "https://169.254.169.254/latest/meta-data/", "https://10.0.0.1/a.jpg", "https://192.168.1.10:8443/a.jpg", "https://[fe80::1]/a.jpg", "https://[fd00::1]/a.jpg", "https://0.0.0.0/a.jpg"].map((address) => [address, PRIVATE]),
  ];
  for (const [address, message] of refusals) assert.throws(() => downloadAddress(address), refusal(message), address);
});

test("looking up a host name refuses one with any address off the public internet", async () => {
  const lookup = (hostname, options) => new Promise((resolve) => publicLookup(hostname, options, (error, address, family) => resolve({ error, address, family })));
  for (const options of [{}, { all: true }]) {
    for (const hostname of ["localhost", "10.0.0.1", "::1"]) assert.ok(refusal(PRIVATE)((await lookup(hostname, options)).error), `${hostname} ${JSON.stringify(options)}`);
  }
  assert.deepEqual(await lookup("8.8.8.8", {}), { error: null, address: "8.8.8.8", family: 4 });
  assert.deepEqual(await lookup("8.8.8.8", { all: true }), { error: null, address: [{ address: "8.8.8.8", family: 4 }], family: undefined });
});

test("Travel's own requests never connect to a private address, given by IP address or by name", async (t) => {
  let connections = 0;
  const server = createServer((socket) => { connections += 1; socket.destroy(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => server.close());
  const { port } = server.address();
  for (const address of [`https://127.0.0.1:${port}/a.jpg`, `https://localhost:${port}/a.jpg`]) {
    await assert.rejects(downloadImage(address, AbortSignal.timeout(5000)), refusal(PRIVATE), address);
  }
  assert.equal(connections, 0, "nothing connected to the private server");
});

test("a download follows a few redirects, each checked as the address given is, and keeps what its server calls an image", async () => {
  const { fetch, requested } = fake({
    "https://images.example.com/a": redirect(301, "/b"),
    "https://images.example.com/b": redirect(302, "https://cdn.example.net/c"),
    "https://cdn.example.net/c": redirect(307, "d.jpg"),
    "https://cdn.example.net/d.jpg": () => respond(200, { "content-type": "Image/JPEG; charset=binary" }, [Buffer.from("ab"), Buffer.from("cd")]),
  });
  const file = await download("https://images.example.com/a", fetch);
  assert.deepEqual([file.type, file.size, await file.text()], ["image/jpeg", 4, "abcd"]);
  assert.deepEqual(requested, ["https://images.example.com/a", "https://images.example.com/b", "https://cdn.example.net/c", "https://cdn.example.net/d.jpg"]);
  assert.equal(MAX_IMAGE_REDIRECTS, 3);

  const loop = fake(Object.fromEntries([0, 1, 2, 3, 4].map((hop) => [`https://images.example.com/${hop}`, redirect(308, `/${hop + 1}`)])));
  await assert.rejects(download("https://images.example.com/0", loop.fetch), refusal(/^The photo's address redirects more than 3 times\.$/));
  assert.equal(loop.requested.length, 4, "the fourth redirect isn't followed");

  // A redirect to an address Travel refuses goes no further.
  for (const [location, message] of [["http://images.example.com/a.jpg", /^Travel downloads photos only from https/], ["https://127.0.0.1/a.jpg", PRIVATE], ["https://[::1]:8443/a.jpg", PRIVATE], ["https://169.254.169.254/latest/meta-data/", PRIVATE]]) {
    const hop = fake({ "https://images.example.com/a": redirect(302, location) });
    await assert.rejects(download("https://images.example.com/a", hop.fetch), refusal(message), location);
    assert.deepEqual(hop.requested, ["https://images.example.com/a"], location);
  }
  const nowhere = fake({ "https://images.example.com/a": redirect(303) });
  await assert.rejects(download("https://images.example.com/a", nowhere.fetch), refusal(/^The photo's server answered 303 without saying where the photo is\.$/));
});

test("a download refuses what isn't an image, what is larger than an upload may be, and what can't be reached", async () => {
  const cases = [
    [() => respond(404), /^The photo's server answered 404 Not Found\.$/],
    [() => respond(500), /^The photo's server answered 500 Internal Server Error\.$/],
    [() => respond(200, { "content-type": "text/html; charset=utf-8" }, [Buffer.from("<html>")]), /^This address isn't a JPEG, PNG or WebP image: its server says it is text\/html\.$/],
    [() => respond(200, { "content-type": "image/gif" }, [Buffer.from("GIF89a")]), /its server says it is image\/gif\.$/],
    [() => respond(200, {}, [Buffer.from("?")]), /^This address isn't a JPEG, PNG or WebP image\.$/],
  ];
  for (const [route, message] of cases) await assert.rejects(download("https://images.example.com/a", fake({ "https://images.example.com/a": route }).fetch), refusal(message), String(message));

  // A declared size over the limit refuses the photo before its body is read.
  let read = false;
  const declared = () => Object.assign(Readable.from((function* () { read = true; yield Buffer.alloc(1); })()), { statusCode: 200, headers: { "content-type": "image/png", "content-length": String(MAX_IMAGE_UPLOAD_BYTES + 1) } });
  await assert.rejects(download("https://images.example.com/a", fake({ "https://images.example.com/a": declared }).fetch), refusal(/^This photo is larger than 5 MB\.$/));
  assert.equal(read, false);
  // Without a declared size, reading a body that never ends stops at the limit.
  let chunks = 0;
  const streamed = () => Object.assign(Readable.from((function* () { for (;;) { chunks += 1; yield Buffer.alloc(1024 * 1024); } })()), { statusCode: 200, headers: { "content-type": "image/webp" } });
  await assert.rejects(download("https://images.example.com/a", fake({ "https://images.example.com/a": streamed }).fetch), refusal(/^This photo is larger than 5 MB\.$/));
  assert.ok(chunks >= 6 && chunks < 64, `reading stopped soon after the limit, at ${chunks} MB`);
  const exact = await download("https://images.example.com/a", fake({ "https://images.example.com/a": () => respond(200, { "content-type": "image/png" }, [Buffer.alloc(MAX_IMAGE_UPLOAD_BYTES)]) }).fetch);
  assert.equal(exact.size, MAX_IMAGE_UPLOAD_BYTES, "a photo of exactly the limit downloads");

  await assert.rejects(download("https://images.example.com/a", fake({}).fetch), refusal(/^Travel couldn't download this photo \(ECONNREFUSED\)\.$/));
  const unknown = async () => { throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }); };
  await assert.rejects(download("https://images.example.com/a", unknown), refusal(/^Travel couldn't find this photo's server\.$/));
});

test("a download stops when its signal aborts, before or after its server answers, and throws the signal's reason", async () => {
  // The server never finishes sending the photo.
  let destroyed = false;
  const stalled = () => Object.assign(new Readable({ read() {}, destroy(error, done) { destroyed = true; done(error); } }), { statusCode: 200, headers: { "content-type": "image/jpeg" } });
  await assert.rejects(download("https://images.example.com/a", fake({ "https://images.example.com/a": stalled }).fetch, AbortSignal.timeout(50)), (error) => error.name === "TimeoutError");
  assert.equal(destroyed, true, "the response stopped");
  // The server never answers.
  const silent = (signal) => new Promise((_, reject) => signal.addEventListener("abort", () => reject(Object.assign(new Error("The operation was aborted"), { name: "AbortError", code: "ABORT_ERR" }))));
  await assert.rejects(download("https://images.example.com/a", fake({ "https://images.example.com/a": silent }).fetch, AbortSignal.timeout(50)), (error) => error.name === "TimeoutError");
  const cancelled = new AbortController();
  cancelled.abort(new Error("Another photo failed"));
  await assert.rejects(download("https://images.example.com/a", fake({ "https://images.example.com/a": jpeg("abc") }).fetch, cancelled.signal), /Another photo failed/);
});
