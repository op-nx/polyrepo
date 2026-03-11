/**
 * Normalizes a git URL for duplicate detection.
 *
 * Handles SSH, ssh://, git://, and HTTPS URLs, lowercasing the hostname
 * and stripping trailing `.git` suffixes. Non-URL strings (local paths)
 * are returned as-is.
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, '');

  // Normalize SSH URLs: git@host:org/repo -> https://host/org/repo
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);

  if (sshMatch) {
    normalized = `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  // Normalize ssh:// URLs: ssh://git@host/path -> https://host/path
  const sshProtoMatch = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);

  if (sshProtoMatch) {
    normalized = `https://${sshProtoMatch[1]}/${sshProtoMatch[2]}`;
  }

  // Normalize git:// URLs
  normalized = normalized.replace(/^git:\/\//, 'https://');

  // Lowercase the host portion of https:// URLs.
  // Only attempt URL parsing for http(s):// URLs to avoid
  // Windows drive letters (e.g., D:) being interpreted as protocols.
  if (/^https?:\/\//.test(normalized)) {
    try {
      const parsed = new URL(normalized);
      parsed.hostname = parsed.hostname.toLowerCase();
      normalized = parsed.toString().replace(/\/$/, '');
    } catch {
      // Not a parseable URL, return as-is
    }
  }

  return normalized;
}
