import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { FEEDBACK_FAILURE, FEEDBACK_LIMIT } from "../src/lib/feedback.ts";

// Execute the actual component's handlers with a small hook/host harness. No
// browser or Jira is contacted; network responses and challenge time are explicit.
const compiled = ts.transpileModule(readFileSync(new URL("../src/components/feedback.tsx", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness(responses) {
  const hooks = [], requests = [], timers = [];
  let cursor = 0, tree, now = 1000;
  class Element { focus() { this.focused = true; } }
  const opener = new Element();
  const dialog = { open: false, showModal() { this.open = true; }, close() { this.open = false; } };
  const jsx = (type, props) => ({ type, props });
  const react = {
    createContext: () => ({ Provider: "context" }),
    useContext: () => tree.props.value,
    useEffect: () => { cursor++; },
    useRef: (initial) => hooks[cursor++] ??= { current: initial },
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = value; }];
    },
  };
  const loaded = { exports: {} };
  runInNewContext(compiled, {
    exports: loaded.exports,
    require(name) {
      if (name === "react") return react;
      if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
      if (name === "lucide-react") return { MessageSquare: "message-icon", X: "close-icon" };
      if (name === "@/lib/feedback") return { FEEDBACK_FAILURE, FEEDBACK_LIMIT };
      throw new Error("Unexpected component import: " + name);
    },
    fetch: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push(body);
      assert.equal(url, "/api/feedback");
      assert.equal(options.method, "POST");
      assert.ok(responses.length, "Unexpected network request");
      return responses.shift()(body);
    },
    AbortSignal,
    Date: { now: () => now },
    setTimeout: (callback, delay) => { timers.push({ callback, at: now + delay }); },
    HTMLElement: Element,
    document: { activeElement: opener },
    location: { pathname: "/trips/test", search: "?tab=ideas" },
    window: { innerWidth: 390, innerHeight: 844 },
    FormData: class { get() { return ""; } },
  });
  function nodes(node) {
    if (!node || typeof node !== "object") return [];
    return [node, ...[node.props?.children].flat(Infinity).flatMap((child) => nodes(child))];
  }
  function render() {
    cursor = 0;
    tree = loaded.exports.default({ children: null });
    nodes(tree).find((node) => node.type === "dialog").props.ref.current = dialog;
  }
  function find(predicate) { render(); return nodes(tree).find(predicate); }
  const control = (type) => find((node) => node.type === type);
  const send = () => find((node) => node.type === "button" && node.props.type === "submit");
  const alert = () => find((node) => node.props?.role === "alert");
  render();
  return {
    requests, dialog, opener, send,
    open() { render(); tree.props.value(); },
    close() { find((node) => node.props?.["aria-label"] === "Close feedback").props.onClick(); },
    enter(value) { control("textarea").props.onChange({ target: { value } }); },
    message: () => control("textarea").props.value,
    error: () => alert()?.props.children,
    status: () => find((node) => node.props?.role === "status")?.props.children,
    submit() { return control("form").props.onSubmit({ preventDefault() {}, currentTarget: {} }); },
    async settle() { for (let i = 0; i < 20; i++) await Promise.resolve(); render(); },
    async advance(milliseconds) {
      now += milliseconds;
      for (const timer of timers.splice(0)) {
        if (timer.at <= now) timer.callback(); else timers.push(timer);
      }
      await this.settle();
    },
  };
}

const token = (value = "test-token") => () => Response.json({ token: value });
const success = () => Response.json({ ok: true });

test("feedback starts without an empty error and shares pending initialization with one protected submission", async () => {
  let finishOpen;
  const ui = harness([() => new Promise((resolve) => { finishOpen = resolve; }), success]);
  ui.open();
  assert.equal(ui.error(), undefined);
  ui.enter("My feedback");
  const submission = ui.submit();
  assert.equal(ui.send().props.disabled, true);
  await ui.submit();
  assert.equal(ui.requests.length, 1, "Send must share the in-flight token request");
  finishOpen(Response.json({ token: "first-token" }));
  await ui.settle();
  assert.equal(ui.requests.length, 1);
  await ui.advance(1099);
  assert.equal(ui.requests.length, 1, "Challenge must mature before submission");
  await ui.advance(1);
  await submission;
  assert.equal(ui.requests.length, 2);
  assert.equal(ui.requests[1].token, "first-token");
  assert.equal(ui.requests[1].message, "My feedback");
  assert.equal(ui.status(), "Thanks, your feedback was sent.");
  ui.close();
  assert.equal(ui.dialog.open, false);
  assert.equal(ui.opener.focused, true);
});

test("HTML, invalid JSON, and malformed feedback responses show only the friendly failure", async () => {
  for (const response of [
    () => new Response("<html>Bad gateway</html>", { status: 502 }),
    () => new Response("not-json", { status: 200 }),
    () => Response.json(null),
    () => Response.json([]),
    () => Response.json({}),
    () => Response.json({ token: 12 }),
    () => Response.json({ error: { technical: "bad response" } }, { status: 500 }),
  ]) {
    const ui = harness([response]);
    ui.open();
    await ui.settle();
    assert.equal(ui.error(), FEEDBACK_FAILURE);
    assert.equal(ui.send().props.disabled, false);
    assert.equal(ui.requests.length, 1, "Failure must not trigger background retries");
  }
});

test("failed initialization can be retried repeatedly with Send while preserving text and API errors", async () => {
  const friendly = "Feedback is temporarily unavailable. Please try again later.";
  const ui = harness([
    () => { throw new Error("Network failed"); },
    () => Response.json({ error: friendly }, { status: 429 }),
    token("retry-token"), success,
  ]);
  ui.open();
  ui.enter("Keep my draft");
  await ui.settle();
  assert.equal(ui.error(), FEEDBACK_FAILURE);
  const failedRetry = ui.submit();
  assert.equal(ui.error(), undefined, "Another attempt clears the previous error");
  await failedRetry;
  assert.equal(ui.error(), friendly);
  assert.equal(ui.message(), "Keep my draft");
  assert.equal(ui.send().props.disabled, false);
  const retry = ui.submit();
  await ui.settle();
  assert.equal(ui.requests.length, 3, "Successful token retry still waits for maturation");
  await ui.advance(1100);
  await retry;
  assert.equal(ui.requests[3].message, "Keep my draft");
  assert.equal(ui.requests[3].token, "retry-token");
  assert.equal(ui.status(), "Thanks, your feedback was sent.");
});

test("failed delivery keeps the draft and obtains a fresh single-use token only on manual retry", async () => {
  const ui = harness([
    token("consumed-token"),
    () => new Response("<html>Bad gateway</html>", { status: 502 }),
    token("fresh-token"), success,
  ]);
  ui.open();
  await ui.settle();
  ui.enter("Preserve feedback after delivery failure");
  const first = ui.submit();
  await ui.advance(1100);
  await first;
  assert.equal(ui.error(), FEEDBACK_FAILURE);
  assert.equal(ui.message(), "Preserve feedback after delivery failure");
  assert.equal(ui.requests.length, 2, "Failure must not automatically retry or prepare another send");
  const second = ui.submit();
  await ui.settle();
  assert.equal(ui.requests.length, 3);
  await ui.advance(1100);
  await second;
  assert.equal(ui.requests[1].token, "consumed-token");
  assert.equal(ui.requests[3].token, "fresh-token");
  assert.equal(ui.status(), "Thanks, your feedback was sent.");
});

test("feedback validation and character limit remain intact, and closing preserves an unsent draft", async () => {
  const ui = harness([token(), token()]);
  ui.open();
  await ui.settle();
  await ui.submit();
  assert.equal(ui.error(), "Enter your feedback");
  assert.equal(ui.requests.length, 1);
  ui.enter("x".repeat(FEEDBACK_LIMIT + 1));
  assert.equal(ui.message().length, FEEDBACK_LIMIT);
  ui.close();
  ui.open();
  await ui.settle();
  assert.equal(ui.message().length, FEEDBACK_LIMIT);
  assert.equal(ui.error(), undefined);
});

test("closing and reopening ignores a late token from the previous opening", async () => {
  let finishOldOpen;
  const ui = harness([() => new Promise((resolve) => { finishOldOpen = resolve; }), token("current-token"), success]);
  ui.open();
  ui.close();
  ui.open();
  await ui.settle();
  finishOldOpen(Response.json({ token: "obsolete-token" }));
  await ui.settle();
  ui.enter("Use the current opening");
  const submission = ui.submit();
  await ui.advance(1100);
  await submission;
  assert.equal(ui.requests[2].token, "current-token");
});
