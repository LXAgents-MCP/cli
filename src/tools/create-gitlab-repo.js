/** Create a project (a repository) on GitLab. */
import { z } from "zod";
import { VERSION } from "../version.js";
import { Refused, callApi, optionalFlag, optionalText, redact, requireToken } from "./common.js";

/** The environment variable that holds the token. */
export const TOKEN_ENV = "LXAGENTS_MCP_GITLAB_API_KEY";

const API = "https://gitlab.com/api/v4";

const VISIBILITIES = ["private", "internal", "public"];

// GitLab's own rules for a path segment: letters, digits, '_', '-' and '.', not starting with
// '-' or '.', and a project path may not end in '.git' or '.atom'.
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$/;
const MAX_GROUP_DEPTH = 20;

export const TOOL = {
  name: "create_gitlab_repo",
  description:
    "Create a new repository (a project) on GitLab.com and return its URLs. Use this when the " +
    "owner asks to start a new GitLab repository, in their own namespace or in a group. " +
    "Private unless told otherwise. It only creates: it does not clone, push to, change or " +
    "delete anything. The token is read from the LXAGENTS_MCP_GITLAB_API_KEY environment " +
    "variable of the server, never from an argument.",
  inputSchema: {
    name: z
      .string()
      .describe(
        "Repository name, which is also its URL path: letters, digits, '_', '-' and '.', " +
          "not starting with '-' or '.'. Example: 'my-new-repo'.",
      ),
    group: z
      .string()
      .optional()
      .describe(
        "Full path of the group or subgroup to create it in. Omit to create it in the " +
          "personal namespace that owns the token. Example: 'lxagents-mcp' or 'lxagents-mcp/tools'.",
      ),
    description: z.string().optional().describe("One-line description shown on the repository."),
    visibility: z
      .enum(["private", "internal", "public"])
      .optional()
      .describe(
        "Default 'private'. 'internal' is visible to any signed-in GitLab.com user. Pass " +
          "'public' only when the owner asked for a public repository.",
      ),
    initialize_with_readme: z
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
 * What GitLab said went wrong, as a short suffix: ": message".
 *
 * GitLab answers in three shapes: a plain string (`"404 Group Not Found"`), an object of field
 * errors (`{"name": ["has already been taken"]}`), and an OAuth-style `error` pair.
 *
 * @param {any} body
 * @returns {string}
 */
function apiDetail(body) {
  if (typeof body === "string") return body ? `: ${body}` : "";
  if (!body || typeof body !== "object") return "";

  const { message, error, error_description: description } = body;
  if (typeof message === "string") return `: ${message}`;
  if (message && typeof message === "object") {
    const fields = Object.entries(message).map(
      ([field, problems]) => `${field} ${[].concat(problems).join(", ")}`,
    );
    return fields.length > 0 ? `: ${fields.join("; ")}` : "";
  }
  if (typeof error === "string") return `: ${error}` + (description ? ` (${description})` : "");
  return "";
}

/**
 * A refusal that says what to do next, for a status GitLab answered with.
 *
 * @param {number} status
 * @param {any} body
 * @param {{ name: string, group: string | undefined, step: "group" | "project" }} request
 * @returns {Refused}
 */
function failure(status, body, { name, group, step }) {
  const detail = apiDetail(body);
  const where = group ? `in '${group}'` : "in the token owner's namespace";

  if (status === 401) {
    return new Refused(
      `GitLab rejected the token (401). Check that ${TOKEN_ENV} holds a valid token that has not expired.`,
    );
  }
  if (status === 404 && step === "group") {
    return new Refused(
      `GitLab could not find the group '${group}' (404), or the token cannot see it. Check ` +
        "the full path, or omit `group` to create the repository in the token owner's namespace.",
    );
  }
  if (status === 403) {
    return new Refused(
      `GitLab refused the request (403)${detail}. The token needs the \`api\` scope, and its ` +
        `owner must be allowed to create projects ${where}.`,
    );
  }
  if (status === 400 || status === 409 || status === 422) {
    return new Refused(
      `GitLab could not create '${name}' (${status})${detail}. The most common cause is that ` +
        `a project with that name or path already exists ${where}; pick another name.`,
    );
  }
  return new Refused(`GitLab answered ${status}${detail}.`);
}

/**
 * @param {{ name?: unknown, group?: unknown, description?: unknown, visibility?: unknown, initialize_with_readme?: unknown }} args
 * @returns {Promise<{ payload: object, ok: boolean }>}
 */
export async function handle(args) {
  const name = optionalText(args.name, "name");
  if (name === undefined) {
    throw new Refused("`name` is required and must be a non-empty string.");
  }
  if (!SEGMENT.test(name) || /\.(git|atom)$/i.test(name)) {
    throw new Refused(
      `\`name\` '${name}' is not a valid GitLab repository name. Use letters, digits, '_', ` +
        "'-' and '.', not starting with '-' or '.' and not ending in '.git' or '.atom'.",
    );
  }

  const group = optionalText(args.group, "group");
  if (group !== undefined) {
    const segments = group.split("/");
    if (segments.length > MAX_GROUP_DEPTH || !segments.every((s) => SEGMENT.test(s))) {
      throw new Refused(
        `\`group\` '${group}' is not a valid GitLab group path. Give the full path, such as ` +
          "'my-group' or 'my-group/sub-group'; omit it to create the repository in the token " +
          "owner's namespace.",
      );
    }
  }

  const description = optionalText(args.description, "description");
  const visibility = optionalText(args.visibility, "visibility") ?? "private";
  if (!VISIBILITIES.includes(visibility)) {
    throw new Refused(`\`visibility\` must be one of ${VISIBILITIES.join(", ")}, got '${visibility}'.`);
  }
  const readme = optionalFlag(args.initialize_with_readme, "initialize_with_readme", true);

  const token = requireToken(TOKEN_ENV);
  const headers = { "PRIVATE-TOKEN": token, "User-Agent": `lxagents-mcp-cli/${VERSION}` };
  const refuse = (status, body, step) => {
    throw new Refused(redact(failure(status, body, { name, group, step }).message, token));
  };

  // A group is created in by id, not by path, so look it up first.
  let namespaceId;
  if (group !== undefined) {
    const lookup = await callApi(`${API}/groups/${encodeURIComponent(group)}`, { headers, token });
    if (lookup.status !== 200) refuse(lookup.status, lookup.body, "group");
    if (!Number.isInteger(lookup.body?.id)) {
      throw new Refused(`GitLab answered 200 for the group '${group}', but without an id this server recognizes.`);
    }
    namespaceId = lookup.body.id;
  }

  const { status, body } = await callApi(`${API}/projects`, {
    method: "POST",
    headers,
    token,
    json: {
      name,
      path: name,
      visibility,
      initialize_with_readme: readme,
      ...(namespaceId === undefined ? {} : { namespace_id: namespaceId }),
      ...(description === undefined ? {} : { description }),
    },
  });

  if (status !== 201) refuse(status, body, "project");
  if (!body || typeof body !== "object" || typeof body.web_url !== "string") {
    throw new Refused("GitLab answered 201, but the body was not a project this server recognizes.");
  }

  const created = body.visibility ?? visibility;
  return {
    payload: {
      summary: `Created ${created} repository ${body.path_with_namespace} on GitLab.`,
      name: body.path ?? body.name,
      full_name: body.path_with_namespace,
      html_url: body.web_url,
      clone_url: body.http_url_to_repo,
      visibility: created,
      ...(typeof body.default_branch === "string" ? { default_branch: body.default_branch } : {}),
    },
    ok: true,
  };
}
