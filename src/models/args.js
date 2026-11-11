/** Reading tool arguments that are not paths or command lines. */
import { config, MAX_TIMEOUT } from "../config/config.js";

/**
 * Seconds to wait, clamped to what the server permits.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function clampTimeout(value) {
  if (value === undefined || value === null) return config.defaultTimeout;

  const requested = Number(value);
  if (!Number.isFinite(requested)) return config.defaultTimeout;
  return Math.max(1, Math.min(requested, MAX_TIMEOUT));
}
