import { describe, it, expect } from 'vitest';
import { toProxyHashEnvKey } from './proxy-hash';

describe(toProxyHashEnvKey, () => {
  it('converts a simple alias to uppercase with POLYREPO_HASH_ prefix', () => {
    expect(toProxyHashEnvKey('myrepo')).toBe('POLYREPO_HASH_MYREPO');
  });

  it('converts hyphens to underscores', () => {
    expect(toProxyHashEnvKey('repo-a')).toBe('POLYREPO_HASH_REPO_A');
  });

  it('converts dots to underscores', () => {
    expect(toProxyHashEnvKey('my.org')).toBe('POLYREPO_HASH_MY_ORG');
  });

  it('converts slashes to underscores', () => {
    expect(toProxyHashEnvKey('org/repo')).toBe('POLYREPO_HASH_ORG_REPO');
  });

  it('uppercases mixed case aliases', () => {
    expect(toProxyHashEnvKey('MyRepo')).toBe('POLYREPO_HASH_MYREPO');
  });

  it('handles aliases already containing uppercase letters', () => {
    expect(toProxyHashEnvKey('already-UPPER')).toBe(
      'POLYREPO_HASH_ALREADY_UPPER',
    );
  });
});
