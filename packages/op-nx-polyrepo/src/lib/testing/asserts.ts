/**
 * Type-narrowing assertion for test code.
 *
 * Replaces the repetitive `if (!value) throw new Error(...)` guard pattern
 * with a single call that narrows `T | undefined | null` to `T`.
 */
export function assertDefined<T>(
  value: T | undefined | null,
  message = 'Expected value to be defined',
): asserts value is T {
  if (value === undefined || value === null) {
    throw new Error(message);
  }
}
