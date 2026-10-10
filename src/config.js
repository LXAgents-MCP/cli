/**
 * Every knob this server has, in one place.
 *
 * Read the mutable ones as `config.name`, never destructured. `src/index.js` overwrites some
 * of them from the command line, and a destructured copy would bind the value at import time
 * and silently ignore --confine, --allow and --timeout. Property access is late-bound, so the
 * handlers see the values actually in force.
 */
export const config = {
  /**
   * Optional confinement boundary, as an absolute resolved path. `null` means nothing is
   * confined, which is the default: `cmd` is a free-form shell string, so bounding `path`
   * would limit where a command *starts* while leaving where it *goes* wide open. A boundary
   * that reads as a guarantee it cannot keep is worse than no boundary at all.
   *
   * There is deliberately no default value and no fallback directory - the server has no
   * opinion about where your code lives. Pass --confine <dir> to impose one.
   */
  confineRoot: null,

  /** Lowercase executable names. Empty means every executable may run; populate to narrow. */
  allowedExecutables: [],

  /** Seconds. Used when a call does not pass `timeout`; long enough for a build step. */
  defaultTimeout: 30,
};

/** The ceiling a model cannot argue its way past, in seconds. */
export const MAX_TIMEOUT = 600;

/** Characters. Past this the model reasons about a partial result as though it were complete. */
export const MAX_OUTPUT = 30000;

/** A listing is for orientation, not for transfer. */
export const MAX_LIST_ENTRIES = 500;

/** Bytes. A file is read to be looked at, not ingested. */
export const MAX_FILE_BYTES = 200_000;
