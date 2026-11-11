import { createServer } from "node:http";

// Local-only stand-in: never forwards requests or stores feedback in a real Jira project.
// The byte limit sits well above the largest issue the app can send; see
// tests/jira-feedback-stub.test.mjs. A larger body is read to its end and dropped,
// so the client gets the 413 instead of a reset connection.
const MAX_REQUEST_BYTES = 256 * 1024;
const utf8 = new TextDecoder("utf-8", { fatal: true });
let count = 0;
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/rest/api/3/issue") { response.writeHead(404).end(); return; }
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size <= MAX_REQUEST_BYTES) chunks.push(chunk);
  }
  if (size > MAX_REQUEST_BYTES) { response.writeHead(413).end(); return; }
  try {
    const { fields } = JSON.parse(utf8.decode(Buffer.concat(chunks)));
    if (fields.project.key !== "TRA" || fields.issuetype.name !== "Task" || fields.labels[0] !== "user-feedback" || !fields.description) throw new Error("Invalid payload");
    count++;
    console.log(`Stub accepted feedback ${count} for TRA (no live Jira request).`);
    response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ id: String(count), key: `TRA-STUB-${count}` }));
  } catch { response.writeHead(400).end("Invalid feedback payload"); }
});
server.listen(3010, "127.0.0.1", () => console.log("Jira feedback stand-in: http://127.0.0.1:3010"));
