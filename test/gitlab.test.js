import assert from "node:assert/strict";
import test from "node:test";
import { Refused } from "../src/tools/common.js";
import { TOKEN_ENV, TOOL, handle } from "../src/tools/create-gitlab-repo.js";
import { VERSION } from "../src/version.js";

const TOKEN = "glpat-test-token-1234";

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

/** Answer each request in turn with `[status, body]`, and record what was sent. */
function answers(t, ...responses) {
  const queue = [...responses];
  return t.mock.method(globalThis, "fetch", async () => {
    const [status, body] = queue.shift();
    return new Response(JSON.stringify(body), { status });
  });
}

const project = (overrides = {}) => ({
  id: 7,
  name: "demo",
  path: "demo",
  path_with_namespace: "me/demo",
  web_url: "https://gitlab.com/me/demo",
  http_url_to_repo: "https://gitlab.com/me/demo.git",
  visibility: "private",
  default_branch: "main",
  ...overrides,
});

test("the token variable is the one the owner named", () => {
  assert.equal(TOKEN_ENV, "LXAGENTS_MCP_GITLAB_API_KEY");
  assert.equal(TOOL.name, "create_gitlab_repo");
  assert.ok(TOOL.description.includes(TOKEN_ENV));
  assert.deepEqual(Object.keys(TOOL.inputSchema), [
    "name",
    "group",
    "description",
    "visibility",
    "initialize_with_readme",
  ]);
});

test("a repository is created in the token owner's namespace, private and initialized by default", async (t) => {
  withToken(t);
  const fetch = answers(t, [201, project()]);

  const { payload, ok } = await handle({ name: "demo" });

  assert.equal(ok, true);
  assert.deepEqual(payload, {
    summary: "Created private repository me/demo on GitLab.",
    name: "demo",
    full_name: "me/demo",
    html_url: "https://gitlab.com/me/demo",
    clone_url: "https://gitlab.com/me/demo.git",
    visibility: "private",
    default_branch: "main",
  });

  assert.equal(fetch.mock.callCount(), 1);
  const [url, init] = fetch.mock.calls[0].arguments;
  assert.equal(url, "https://gitlab.com/api/v4/projects");
  assert.equal(init.method, "POST");
  assert.deepEqual(JSON.parse(init.body), {
    name: "demo",
    path: "demo",
    visibility: "private",
    initialize_with_readme: true,
  });
  assert.equal(init.headers["PRIVATE-TOKEN"], TOKEN);
  assert.equal(init.headers.Authorization, undefined);
  assert.equal(init.headers["User-Agent"], `lxagents-mcp-cli/${VERSION}`);
  assert.equal(init.headers["Content-Type"], "application/json");
});

test("a group is looked up by its encoded path, and its id becomes the namespace", async (t) => {
  withToken(t);
  const fetch = answers(t, [200, { id: 42, full_path: "acme/tools" }], [
    201,
    project({ path_with_namespace: "acme/tools/demo", visibility: "internal" }),
  ]);

  const { payload } = await handle({
    name: "demo",
    group: "acme/tools",
    description: "  A demo  ",
    visibility: "internal",
    initialize_with_readme: false,
  });

  assert.equal(payload.summary, "Created internal repository acme/tools/demo on GitLab.");
  assert.equal(fetch.mock.callCount(), 2);

  const [lookupUrl, lookupInit] = fetch.mock.calls[0].arguments;
  assert.equal(lookupUrl, "https://gitlab.com/api/v4/groups/acme%2Ftools");
  assert.equal(lookupInit.method, "GET");
  assert.equal(lookupInit.headers["PRIVATE-TOKEN"], TOKEN);

  const [, createInit] = fetch.mock.calls[1].arguments;
  assert.deepEqual(JSON.parse(createInit.body), {
    name: "demo",
    path: "demo",
    visibility: "internal",
    initialize_with_readme: false,
    namespace_id: 42,
    description: "A demo",
  });
});

test("a blank group means the personal namespace and no lookup", async (t) => {
  withToken(t);
  const fetch = answers(t, [201, project()]);

  await handle({ name: "demo", group: "   " });

  assert.equal(fetch.mock.callCount(), 1);
  assert.equal(fetch.mock.calls[0].arguments[0], "https://gitlab.com/api/v4/projects");
});

test("a missing default branch is left out, and visibility falls back to what was asked", async (t) => {
  withToken(t);
  answers(t, [201, project({ visibility: undefined, default_branch: null })]);

  const { payload } = await handle({ name: "demo", visibility: "public" });

  assert.equal(payload.visibility, "public");
  assert.equal("default_branch" in payload, false);
});

test("a missing token is a refusal that names the variable, and nothing is sent", async (t) => {
  withoutToken(t);
  const fetch = answers(t, [201, project()]);

  await assert.rejects(handle({ name: "demo" }), isRefusal(/^LXAGENTS_MCP_GITLAB_API_KEY is not set\./));
  assert.equal(fetch.mock.callCount(), 0);
});

test("bad arguments are refused before the token is read or anything is sent", async (t) => {
  withoutToken(t);
  const fetch = answers(t, [201, project()]);

  await assert.rejects(handle({}), isRefusal(/`name` is required/));
  await assert.rejects(handle({ name: "   " }), isRefusal(/`name` is required/));
  await assert.rejects(handle({ name: 5 }), isRefusal(/`name` must be a string/));
  await assert.rejects(handle({ name: "has space" }), isRefusal(/not a valid GitLab repository name/));
  await assert.rejects(handle({ name: "a/b" }), isRefusal(/not a valid GitLab repository name/));
  await assert.rejects(handle({ name: "-lead" }), isRefusal(/not a valid GitLab repository name/));
  await assert.rejects(handle({ name: ".lead" }), isRefusal(/not a valid GitLab repository name/));
  await assert.rejects(handle({ name: "repo.git" }), isRefusal(/not a valid GitLab repository name/));
  await assert.rejects(handle({ name: "repo.ATOM" }), isRefusal(/not a valid GitLab repository name/));
  await assert.rejects(handle({ name: "ok", group: "a//b" }), isRefusal(/not a valid GitLab group path/));
  await assert.rejects(handle({ name: "ok", group: "/a" }), isRefusal(/not a valid GitLab group path/));
  await assert.rejects(handle({ name: "ok", group: Array(21).fill("g").join("/") }), isRefusal(/not a valid GitLab group path/));
  await assert.rejects(handle({ name: "ok", visibility: "secret" }), isRefusal(/`visibility` must be one of private, internal, public, got 'secret'/));
  await assert.rejects(handle({ name: "ok", initialize_with_readme: "yes" }), isRefusal(/`initialize_with_readme` must be true or false/));
  await assert.rejects(handle({ name: "ok", description: 3 }), isRefusal(/`description` must be a string/));

  assert.equal(fetch.mock.callCount(), 0);
});

test("401 says the token was rejected, and stops before any project is created", async (t) => {
  withToken(t);
  const fetch = answers(t, [401, { message: "401 Unauthorized" }]);

  await assert.rejects(
    handle({ name: "demo", group: "acme" }),
    isRefusal(/^GitLab rejected the token \(401\)\. Check that LXAGENTS_MCP_GITLAB_API_KEY holds a valid token/),
  );
  assert.equal(fetch.mock.callCount(), 1);
});

test("404 on the group says the group may not exist, and no project is created", async (t) => {
  withToken(t);
  const fetch = answers(t, [404, { message: "404 Group Not Found" }]);

  await assert.rejects(
    handle({ name: "demo", group: "ghost" }),
    isRefusal(/could not find the group 'ghost' \(404\).*omit `group`/),
  );
  assert.equal(fetch.mock.callCount(), 1);
});

test("a group answer without an id is refused", async (t) => {
  withToken(t);
  answers(t, [200, { unexpected: true }]);

  await assert.rejects(handle({ name: "demo", group: "acme" }), isRefusal(/answered 200 for the group 'acme', but without an id/));
});

test("403 says what the token needs, for the namespace or the group", async (t) => {
  withToken(t);
  answers(t, [403, { message: "403 Forbidden" }], [403, { message: "403 Forbidden" }]);

  await assert.rejects(
    handle({ name: "demo" }),
    isRefusal(/403\): 403 Forbidden\. The token needs the `api` scope.* in the token owner's namespace\.$/),
  );
  await assert.rejects(handle({ name: "demo", group: "acme" }), isRefusal(/GitLab refused the request \(403\)/));
});

test("403 on the create step names the group", async (t) => {
  withToken(t);
  answers(t, [200, { id: 1 }], [403, { message: "403 Forbidden" }]);

  await assert.rejects(handle({ name: "demo", group: "acme" }), isRefusal(/create projects in 'acme'/));
});

test("400 carries GitLab's field errors, such as a name that is taken", async (t) => {
  withToken(t);
  answers(t, [400, { message: { name: ["has already been taken"], path: ["has already been taken"] } }]);

  await assert.rejects(
    handle({ name: "demo" }),
    isRefusal(
      /could not create 'demo' \(400\): name has already been taken; path has already been taken\..*already exists in the token owner's namespace/,
    ),
  );
});

test("an OAuth-style error is reported with its description", async (t) => {
  withToken(t);
  answers(t, [403, { error: "insufficient_scope", error_description: "needs api" }]);

  await assert.rejects(handle({ name: "demo" }), isRefusal(/\(403\): insufficient_scope \(needs api\)\./));
});

test("any other status is reported with its status and message", async (t) => {
  withToken(t);
  answers(t, [500, { message: "500 Internal Server Error" }]);

  await assert.rejects(handle({ name: "demo" }), isRefusal(/^GitLab answered 500: 500 Internal Server Error\.$/));
});

test("a failure never carries the token, even when GitLab echoes it", async (t) => {
  withToken(t);
  answers(t, [500, { message: `bad token ${TOKEN}` }]);

  await assert.rejects(handle({ name: "demo" }), (e) => e instanceof Refused && !e.message.includes(TOKEN) && e.message.includes("***"));
});

test("a 201 whose body is not a project is refused", async (t) => {
  withToken(t);
  answers(t, [201, { unexpected: true }]);

  await assert.rejects(handle({ name: "demo" }), isRefusal(/answered 201, but the body was not a project/));
});

test("a network failure is a refusal", async (t) => {
  withToken(t);
  t.mock.method(globalThis, "fetch", async () => {
    throw new TypeError("fetch failed", { cause: new Error("ECONNREFUSED") });
  });

  await assert.rejects(handle({ name: "demo" }), isRefusal(/^Could not reach gitlab\.com: ECONNREFUSED\./));
});
