/**
 * Error type shared by the built-in utility ("小工具") implementations.
 *
 * `key` refers to an i18n message under `tools.errors.*`; the page maps it
 * back to the active locale before showing it to the user.
 */
export class ToolError extends Error {
  readonly key: string;
  readonly params: Record<string, string>;

  constructor(key: string, params: Record<string, string> = {}) {
    super(key);
    this.name = 'ToolError';
    this.key = key;
    this.params = params;
  }
}

/** Convenience helper so callers can write `fail('radix.range')`. */
export function fail(key: string, params: Record<string, string> = {}): never {
  throw new ToolError(key, params);
}
