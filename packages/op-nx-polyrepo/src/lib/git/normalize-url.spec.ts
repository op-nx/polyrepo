import { describe, it, expect } from 'vitest';
import { normalizeGitUrl } from './normalize-url';

describe('normalizeGitUrl', () => {
  it('strips trailing .git suffix', () => {
    expect(normalizeGitUrl('https://github.com/org/repo.git')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('normalizes SSH to HTTPS', () => {
    expect(normalizeGitUrl('git@github.com:org/repo')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('normalizes ssh:// protocol to HTTPS', () => {
    expect(normalizeGitUrl('ssh://git@github.com/org/repo')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('normalizes git:// protocol to HTTPS', () => {
    expect(normalizeGitUrl('git://github.com/org/repo')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('lowercases hostname', () => {
    expect(normalizeGitUrl('https://GitHub.COM/org/repo')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('combines all normalizations', () => {
    expect(normalizeGitUrl('git@GitHub.COM:org/repo.git')).toBe(
      'https://github.com/org/repo',
    );
  });

  it('returns non-URL strings as-is (for local paths)', () => {
    expect(normalizeGitUrl('D:/projects/repo')).toBe('D:/projects/repo');
  });

  it('returns relative paths as-is', () => {
    expect(normalizeGitUrl('../some/repo')).toBe('../some/repo');
  });

  it('strips trailing slash from final result', () => {
    expect(normalizeGitUrl('https://github.com/org/repo/')).toBe(
      'https://github.com/org/repo',
    );
  });
});
