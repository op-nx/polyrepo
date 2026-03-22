/**
 * Convert a repo alias to the environment variable name used for proxy target
 * caching. Uppercases and replaces any non-alphanumeric character with
 * underscore.
 *
 * Shared between `preTasksExecution` (which sets the env var) and
 * `createProxyTarget` (which declares the env input).
 */
export function toProxyHashEnvKey(alias: string): string {
  return `POLYREPO_HASH_${alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}
