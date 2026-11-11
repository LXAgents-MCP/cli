/** A listing entry, as the text block needs it. */
interface RenderedEntry {
  name: string;
  type: string;
  size: number;
}

/**
 * The text block of a tool result: what the model actually reads.
 *
 * It is rendered per result shape: a command gets its two streams, a listing gets the entries,
 * a file gets its content, and a refusal gets the sentence explaining it.
 *
 * @param message The reason, for a refusal or a handler bug.
 */
export function renderResult(
  summary: string,
  fields: Record<string, unknown>,
  message: string = "",
): string {
  if (message) {
    // A refusal or a handler bug: there is nothing to render but the reason.
    return `**${summary || "Refused"}**\n\n${message}`;
  }
  if ("stdout" in fields) {
    let body = `**${summary}**\n\n`;
    if (fields.stdout) body += `\`\`\`\n${fields.stdout}\n\`\`\`\n`;
    if (fields.stderr) body += `\n**stderr**\n\n\`\`\`\n${fields.stderr}\n\`\`\`\n`;
    if (!fields.stdout && !fields.stderr) body += "_(no output)_\n";
    return body;
  }
  if ("entries" in fields) {
    const lines = (fields.entries as RenderedEntry[])
      .map((e) => `- \`${e.name}\`` + (e.type === "dir" ? "/" : `  (${e.size} bytes)`))
      .join("\n");
    return `**${summary}**\n\n${lines || "_(empty)_"}`;
  }
  if ("content" in fields) {
    return `**${summary}**\n\n\`\`\`text\n${fields.content}\n\`\`\`\n`;
  }
  return `**${summary}**`;
}
