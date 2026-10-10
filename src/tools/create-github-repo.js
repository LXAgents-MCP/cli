/** Create a repository on GitHub. */
import { z } from "zod";
import { VERSION } from "../version.js";
import { Refused, callApi, optionalFlag, optionalText, redact, requireToken } from "./common.js";

/** The environment variable that holds the token. */
export const TOKEN_ENV = "LXAGENTS_MCP_GITHUB_API_KEY";

const API = "https://api.github.com";

// GitHub's own rules: a repository name is letters, digits, '-', '_' and '.', up to 100
// characters; an organization login is letters, digits and '-', up to 39.
const REPO_NAME = /^[A-Za-z0-9._-]{1,100}$/;
const ORG_NAME = /^[A-Za-z0-9-]{1,39}$/;

export const TOOL = {
  name: "create_github_repo",
  description:
    "Create a new, empty repository on GitHub and return its URLs. Use this when the owner " +
    "asks to start a new GitHub repository, in their own account or in an organization. " +
    "Private unless told otherwise. It only creates: it does not clone, push to, change or " +
    "delete anything. The token is read from the LXAGENTS_MCP_GITHUB_API_KEY environment " +
    "variable of the server, never from an argument.",
  inputSchema: {
    name: z
      .string()
      .describe(
        "Repository name: letters, digits, '-', '_' and '.', at most 100 characters. " +
          "Example: 'my-new-repo'.",
      ),
    org: z
      .string()
      .optional()
      .describe(
        "Organization to create it in. Omit to create it in the personal account that " +
          "owns the token. Example: 'LXAgents-MCP'.",
      ),
    description: z.string().optional().describe("One-line description shown on the repository."),
    private: z
      .boolean()
      .optional()
      .describe("Default true. Pass false only when the owner asked for a public repository."),
    auto_init: z
      .boolean()
      .optional()
      .describe(
        "Default true: create an initial commit with a README, so the repository can be " +
          "cloned straight away. Pass false for a truly empty repository.",
      ),
  },
  outputSchema: {
    name: z.string(),
    full_name: z.string(),
    html_url: z.string(),
    clone_url: z.string(),
    visibility: z.string(),
    default_branch: z.string().optional(),
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
  },
};

/**
 * What GitHub said went wrong, as a short suffix: ": message (detail; detail)".
 *
 * @param {any} body
 * @returns {string}
 */
function apiDetail(body) {
  if (typeof body === "string") return body ? `: ${body}` : "";
  if (!body || typeof body.message !== "string") return "";

  const extra = Array.isArray(body.errors)
    ? body.errors.map((e) => e?.message ?? e?.code).filter(Boolean)
    : [];
  return `: ${body.message}` + (extra.length > 0 ? ` (${extra.join("; ")})` : "");
}

/**
 * A refusal that says what to do next, for a status GitHub answered with.
 *
 * @param {number} status
 * @param {any} body
 * @param {{ name: string, org: string | undefined }} request
 * @returns {Refused}
 */
function failure(status, body, { name, org }) {
  const detail = apiDetail(body);
  const where = org ? `in '${org}'` : "in the token owner's account";

  switch (status) {
    case 401:
      return new Refused(
        `GitHub rejected the token (401). Check that ${TOKEN_ENV} holds a valid token that has not expired.`,
      );
    case 403:
      return new Refused(
        `GitHub refused the request (403)${detail}. The token must be allowed to create ` +
          `repositories ${where}: a classic token needs the \`repo\` scope, a fine-grained ` +
          "token needs the Administration permission set to write. If the message mentions a " +
          "rate limit, wait and try again.",
      );
    case 404:
      return new Refused(
        org
          ? `GitHub could not find the organization '${org}' (404), or the token cannot see ` +
              "it. Check the spelling, or omit `org` to create the repository in the token " +
              "owner's account."
          : `GitHub answered 404${detail}.`,
      );
    case 422:
      return new Refused(
        `GitHub could not create '${name}' (422)${detail}. The most common cause is that a ` +
          `repository with that name already exists ${where}; pick another name.`,
      );
    default:
      return new Refused(`GitHub answered ${status}${detail}.`);
  }
}

/**
 * @param {{ name?: unknown, org?: unknown, description?: unknown, private?: unknown, auto_init?: unknown }} args
 * @returns {Promise<{ payload: object, ok: boolean }>}
 */
export async function handle(args) {
  const name = optionalText(args.name, "name");
  if (name === undefined) {
    throw new Refused("`name` is required and must be a non-empty string.");
  }
  if (!REPO_NAME.test(name) || name === "." || name === "..") {
    throw new Refused(
      `\`name\` '${name}' is not a valid GitHub repository name. Use letters, digits, '-', ` +
        "'_' and '.', at most 100 characters.",
    );
  }

  const org = optionalText(args.org, "org");
  if (org !== undefined && !ORG_NAME.test(org)) {
    throw new Refused(
      `\`org\` '${org}' is not a valid GitHub organization name. Use letters, digits and '-', ` +
        "at most 39 characters; omit it to create the repository in the token owner's account.",
    );
  }

  const description = optionalText(args.description, "description");
  const isPrivate = optionalFlag(args.private, "private", true);
  const autoInit = optionalFlag(args.auto_init, "auto_init", true);

  const token = requireToken(TOKEN_ENV);
  const url = org ? `${API}/orgs/${encodeURIComponent(org)}/repos` : `${API}/user/repos`;

  const { status, body } = await callApi(url, {
    method: "POST",
    token,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": `lxagents-mcp-cli/${VERSION}`,
    },
    json: {
      name,
      private: isPrivate,
      auto_init: autoInit,
      ...(description === undefined ? {} : { description }),
    },
  });

  if (status !== 201) {
    const refusal = failure(status, body, { name, org });
    throw new Refused(redact(refusal.message, token));
  }
  if (!body || typeof body !== "object" || typeof body.html_url !== "string") {
    throw new Refused("GitHub answered 201, but the body was not a repository this server recognizes.");
  }

  const visibility = body.visibility ?? (body.private ? "private" : "public");
  return {
    payload: {
      summary: `Created ${visibility} repository ${body.full_name} on GitHub.`,
      name: body.name,
      full_name: body.full_name,
      html_url: body.html_url,
      clone_url: body.clone_url,
      visibility,
      ...(typeof body.default_branch === "string" ? { default_branch: body.default_branch } : {}),
    },
    ok: true,
  };
}
