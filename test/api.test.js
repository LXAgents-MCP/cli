import assert from "node:assert/strict";
import test from "node:test";
import { API_TIMEOUT_MS } from "../src/config.js";
import {
  Refused,
  callApi,
  optionalFlag,
  optionalText,
  redact,
  requireToken,
} from "../src/tools/common.js";

const isRefusal = (pattern) => (e) => e instanceof Refused && pattern.test(e.message);

/** Set an environment variable for one test and put it back afterwards. */
function env(t, name, value) {
  const saved = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  t.after(() => {
    if (saved === undefined) delete process.env[name];
    else process.env[name] = saved;
  });
}

test("requireToken returns the trimmed token", (t) => {
  env(t, "LXAGENTS_TEST_TOKEN", "  abc123  ");

  assert.equal(requireToken("LXAGENTS_TEST_TOKEN"), "abc123");
});

test("requireToken refuses a missing or blank token and names the variable", (t) => {
  env(t, "LXAGENTS_TEST_TOKEN", undefined);
  assert.throws(() => requireToken("LXAGENTS_TEST_TOKEN"), isRefusal(/^LXAGENTS_TEST_TOKEN is not set\. .*`env` block/));

  env(t, "LXAGENTS_TEST_TOKEN", "   ");
  assert.throws(() => requireToken("LXAGENTS_TEST_TOKEN"), isRefusal(/LXAGENTS_TEST_TOKEN is not set/));
});

test("redact removes every occurrence of a secret and tolerates an empty one", () => {
  assert.equal(redact("a s3cret b s3cret", "s3cret"), "a *** b ***");
  assert.equal(redact("nothing here", "s3cret"), "nothing here");
  assert.equal(redact("kept", ""), "kept");
});

test("optionalText trims, drops blanks and refuses a non-string", () => {
  assert.equal(optionalText(undefined, "x"), undefined);
  assert.equal(optionalText(null, "x"), undefined);
  assert.equal(optionalText("   ", "x"), undefined);
  assert.equal(optionalText("  hi ", "x"), "hi");
  assert.throws(() => optionalText(5, "x"), isRefusal(/`x` must be a string, got number\./));
});

test("optionalFlag falls back when absent and refuses a non-boolean", () => {
  assert.equal(optionalFlag(undefined, "x", true), true);
  assert.equal(optionalFlag(null, "x", false), false);
  assert.equal(optionalFlag(false, "x", true), false);
  assert.throws(() => optionalFlag("yes", "x", true), isRefusal(/`x` must be true or false, got string\./));
});

test("callApi sends the method, headers and a JSON body, and decodes the answer", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response('{"ok":true}', { status: 201 }));

  const result = await callApi("https://api.example.com/things", {
    method: "POST",
    headers: { Authorization: "Bearer x" },
    json: { a: 1 },
  });

  assert.deepEqual(result, { status: 201, body: { ok: true } });
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://api.example.com/things");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { Authorization: "Bearer x", "Content-Type": "application/json" });
  assert.equal(init.body, '{"a":1}');
  assert.ok(init.signal instanceof AbortSignal);
});

test("callApi sends no body and no content type when there is no JSON", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 204 }));

  const result = await callApi("https://api.example.com/things");

  assert.deepEqual(result, { status: 204, body: null });
  const [, init] = fetch.mock.calls[0].arguments;
  assert.equal(init.method, "GET");
  assert.equal(init.body, undefined);
  assert.deepEqual(init.headers, {});
});

test("callApi hands back a body that is not JSON as short text", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("x".repeat(1000), { status: 502 }));

  const { status, body } = await callApi("https://api.example.com/things");

  assert.equal(status, 502);
  assert.equal(body, "x".repeat(300));
});

test("callApi turns a network failure into a refusal with the secret scrubbed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: new Error("getaddrinfo ENOTFOUND for s3cret") });
  });

  await assert.rejects(
    callApi("https://api.example.com/things", { token: "s3cret" }),
    (e) =>
      e instanceof Refused &&
      e.message === "Could not reach api.example.com: getaddrinfo ENOTFOUND for ***. Check the network connection.",
  );
});

test("callApi turns a timeout into a refusal that says how long it waited", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
  });

  await assert.rejects(
    callApi("https://api.example.com/things"),
    isRefusal(new RegExp(`^api\\.example\\.com did not answer within ${API_TIMEOUT_MS / 1000} seconds`)),
  );
});
