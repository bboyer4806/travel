import { createServer } from "node:http";

// Local-only stand-in: never forwards requests or stores feedback in a real Jira project.
let count = 0;
const server = createServer(async (request, response) => {
  if (request.method !== "POST" || request.url !== "/rest/api/3/issue") { response.writeHead(404).end(); return; }
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 24000) { response.writeHead(413).end(); return; }
  }
  try {
    const { fields } = JSON.parse(body);
    if (fields.project.key !== "TRA" || fields.issuetype.name !== "Task" || fields.labels[0] !== "user-feedback" || !fields.description) throw new Error("Invalid payload");
    count++;
    console.log(`Stub accepted feedback ${count} for TRA (no live Jira request).`);
    response.writeHead(201, { "Content-Type": "application/json" }).end(JSON.stringify({ id: String(count), key: `TRA-STUB-${count}` }));
  } catch { response.writeHead(400).end("Invalid feedback payload"); }
});
server.listen(3010, "127.0.0.1", () => console.log("Jira feedback stand-in: http://127.0.0.1:3010"));
