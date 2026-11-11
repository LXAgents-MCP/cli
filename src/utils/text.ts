/** Turning a command's or a file's bytes into text the model can read. */
import { MAX_OUTPUT } from "../config/config.js";

/**
 * Decode bytes as UTF-8, falling back to Windows-1252 when they are not valid UTF-8.
 *
 * The byte order mark is kept in the string (`ignoreBOM`) so a caller that cares can strip it
 * explicitly, instead of the decoder doing it for UTF-8 only and leaving it as mojibake for the
 * fallback.
 */
export function decode(payload: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(payload);
  } catch {
    return new TextDecoder("windows-1252").decode(payload);
  }
}

/** The text, cut to the output ceiling, and whether it was cut. */
export function truncate(text: string): [string, boolean] {
  if (text.length > MAX_OUTPUT) {
    return [`${text.slice(0, MAX_OUTPUT)}\n... (truncated)`, true];
  }
  return [text, false];
}
