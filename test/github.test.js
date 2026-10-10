import assert from "node:assert/strict";
import test from "node:test";
import { Refused } from "../src/tools/common.js";
import { TOKEN_ENV, TOOL, handle } from "../src/tools/create-github-repo.js";
import { VERSION } from "../src/version.js";

const TOKEN = "ghp_test_token_1234";

const isRefusal = (pattern) => (e) => e instanceof Refused && pattern.test(e.message);

/** Set the token variable for one test, or remove it when `value` is null, and restore it after. */
function setToken(t, value) {
  const saved = process.env[TOKEN_ENV];
  if (value === null) delete process.env[TOKEN_ENV];
  else process.env[TOKEN_ENV] = value;
  t.after(() => {
    if (saved === undefined) delete process.env[TOKEN_ENV];
    else process.env[TOKEN_ENV] = saved;
  });
}

const withToken = (t) => setToken(t, TOKEN);
const withoutToken = (t) => setToken(t, null);

/** Answer every request with one canned response, and record what was sent. */
function answer(t, status, body) {
  return t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify(body), { status }));
}

const created = (overrides = {}) => ({
  name: "demo",
  full_name: "me/demo",
  html_url: "https://github.com/me/demo",
  clone_url: "https://github.com/me/demo.git",
  private: true,
  visibility: "private",
  default_branch: "main",
  ...overrides,
});

test("the token variable is the one the owner named", () => {
  assert.equal(TOKEN_ENV, "LXAGENTS_MCP_GITHUB_API_KEY");
  assert.equal(TOOL.name, "create_github_repo");
  assert.ok(TOOL.description.includes(TOKEN_ENV));
  assert.deepEqual(Object.keys(TOOL.inputSchema), ["name", "org", "description", "private", "auto_init"]);
});

test("a repository is created in the token owner's account, private and initialized by default", async (t) => {
  withToken(t);
  const fetch = answer(t, 201, created());

  const { payload, ok } = await handle({ name: "demo" });

  assert.equal(ok, true);
  assert.deepEqual(payload, {
    summary: "Created private repository me/demo on GitHub.",
    name: "demo",
    full_name: "me/demo",
    html_url: "https://github.com/me/demo",
    clone_url: "https://github.com/me/demo.git",
    visibility: "private",
    default_branch: "main",
  });

  assert.equal(fetch.mock.callCount(), 1);
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://api.github.com/user/repos");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), { name: "demo", private: true, auto_init: true });
  assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(init.headers.Accept, "application/vnd.github+json");
  assert.equal(init.headers["X-GitHub-Api-Version"], "2022-11-28");
  assert.equal(init.headers["User-Agent"], `lxagents-mcp-cli/${VERSION}`);
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("an organization changes the endpoint, and the options reach GitHub", async (t) => {
  withToken(t);
  const fetch = answer(t, 201, created({ full_name: "acme/demo", private: false, visibility: "public" }));

  const { payload } = await handle({
    name: "demo",
    org: "acme",
    description: "  A demo  ",
    private: false,
    auto_init: false,
  });

  assert.equal(payload.summary, "Created public repository acme/demo on GitHub.");
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://api.github.com/orgs/acme/repos");
  assert.deepEqual(JSON.parse(init.body), {
    name: "demo",
    private: false,
    auto_init: false,
    description: "A demo",
  });
});

test("a blank org means the personal account", async (t) => {
  withToken(t);
  const fetch = answer(t, 201, created());

  await handle({ name: "demo", org: "   " });

  assert.equal(fetch.mock.calls[0].arguments[0], "https://api.github.com/user/repos");
});

test("visibility falls back to the private flag, and a missing default branch is left out", async (t) => {
  withToken(t);
  answer(t, 201, created({ visibility: undefined, private: false, default_branch: undefined }));

  const { payload } = await handle({ name: "demo", private: false });

  assert.equal(payload.visibility, "public");
  assert.equal("default_branch" in payload, false);
});

test("a missing token is a refusal that names the variable, and nothing is sent", async (t) => {
  withoutToken(t);
  const fetch = answer(t, 201, created());

  await assert.rejects(handle({ name: "demo" }), isRefusal(/^LXAGENTS_MCP_GITHUB_API_KEY is not set\./));
  assert.equal(fetch.mock.callCount(), 0);
});

test("bad arguments are refused before the token is read or anything is sent", async (t) => {
  withoutToken(t);
  const fetch = answer(t, 201, created());

  await assert.rejects(handle({}), isRefusal(/`name` is required/));
  await assert.rejects(handle({ name: "   " }), isRefusal(/`name` is required/));
  await assert.rejects(handle({ name: 5 }), isRefusal(/`name` must be a string/));
  await assert.rejects(handle({ name: "has space" }), isRefusal(/not a valid GitHub repository name/));
  await assert.rejects(handle({ name: "a/b" }), isRefusal(/not a valid GitHub repository name/));
  await assert.rejects(handle({ name: ".." }), isRefusal(/not a valid GitHub repository name/));
  await assert.rejects(handle({ name: "a".repeat(101) }), isRefusal(/not a valid GitHub repository name/));
  await assert.rejects(handle({ name: "ok", org: "bad/org" }), isRefusal(/not a valid GitHub organization name/));
  await assert.rejects(handle({ name: "ok", org: "-".repeat(40) }), isRefusal(/not a valid GitHub organization name/));
  await assert.rejects(handle({ name: "ok", private: "no" }), isRefusal(/`private` must be true or false/));
  await assert.rejects(handle({ name: "ok", auto_init: 1 }), isRefusal(/`auto_init` must be true or false/));
  await assert.rejects(handle({ name: "ok", description: 3 }), isRefusal(/`description` must be a string/));

  assert.equal(fetch.mock.callCount(), 0);
});

test("401 says the token was rejected", async (t) => {
  withToken(t);
  answer(t, 401, { message: "Bad credentials" });

  await assert.rejects(
    handle({ name: "demo" }),
    isRefusal(/^GitHub rejected the token \(401\)\. Check that LXAGENTS_MCP_GITHUB_API_KEY holds a valid token/),
  );
});

test("403 says what permission the token needs, for the account or the organization", async (t) => {
  withToken(t);
  answer(t, 403, { message: "Resource not accessible by personal access token" });

  await assert.rejects(
    handle({ name: "demo" }),
    isRefusal(/403\): Resource not accessible .* in the token owner's account: a classic token needs the `repo` scope/),
  );
  await assert.rejects(handle({ name: "demo", org: "acme" }), isRefusal(/repositories in 'acme'/));
});

test("404 on an organization says the organization may not exist", async (t) => {
  withToken(t);
  answer(t, 404, { message: "Not Found" });

  await assert.rejects(
    handle({ name: "demo", org: "ghost" }),
    isRefusal(/could not find the organization 'ghost' \(404\).*omit `org`/),
  );
  await assert.rejects(handle({ name: "demo" }), isRefusal(/^GitHub answered 404: Not Found\.$/));
});

test("422 carries GitHub's reason, such as a name that is taken", async (t) => {
  withToken(t);
  answer(t, 422, {
    message: "Repository creation failed.",
    errors: [{ resource: "Repository", code: "custom", field: "name", message: "name already exists on this account" }],
  });

  await assert.rejects(
    handle({ name: "demo" }),
    isRefusal(
      /could not create 'demo' \(422\): Repository creation failed\. \(name already exists on this account\)\..*already exists in the token owner's account/,
    ),
  );
});

test("any other status is reported with its status and message", async (t) => {
  withToken(t);
  answer(t, 500, { message: "Server Error" });

  await assert.rejects(handle({ name: "demo" }), isRefusal(/^GitHub answered 500: Server Error\.$/));
});

test("a failure never carries the token, even when GitHub echoes it", async (t) => {
  withToken(t);
  answer(t, 500, { message: `bad token ${TOKEN}` });

  await assert.rejects(handle({ name: "demo" }), (e) => e instanceof Refused && !e.message.includes(TOKEN) && e.message.includes("***"));
});

test("a 201 whose body is not a repository is refused", async (t) => {
  withToken(t);
  answer(t, 201, { unexpected: true });

  await assert.rejects(handle({ name: "demo" }), isRefusal(/answered 201, but the body was not a repository/));
});

test("a network failure is a refusal", async (t) => {
  withToken(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
  });

  await assert.rejects(handle({ name: "demo" }), isRefusal(/^Could not reach api\.github\.com: ECONNREFUSED\./));
});
