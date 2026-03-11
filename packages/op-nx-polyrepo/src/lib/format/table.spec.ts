import { describe, it, expect } from 'vitest';
import { formatAlignedTable } from './table';
import type { ColumnDef } from './table';

describe('formatAlignedTable', () => {
  it('returns empty array for empty input', () => {
    const result = formatAlignedTable([]);

    expect(result).toEqual([]);
  });

  it('returns single row without padding', () => {
    const rows: ColumnDef[][] = [
      [{ value: 'hello' }, { value: 'world' }],
    ];

    const result = formatAlignedTable(rows);

    expect(result).toEqual(['hello  world']);
  });

  it('pads left-aligned columns with padEnd (default)', () => {
    const rows: ColumnDef[][] = [
      [{ value: 'a' }, { value: 'short' }],
      [{ value: 'longer' }, { value: 'b' }],
    ];

    const result = formatAlignedTable(rows);

    expect(result).toEqual([
      'a       short',
      'longer  b    ',
    ]);
  });

  it('pads right-aligned columns with padStart', () => {
    const rows: ColumnDef[][] = [
      [{ value: '1', align: 'right' }, { value: 'one' }],
      [{ value: '123', align: 'right' }, { value: 'one hundred twenty-three' }],
    ];

    const result = formatAlignedTable(rows);

    expect(result[0].startsWith('  1')).toBe(true);
    expect(result[1].startsWith('123')).toBe(true);
  });

  it('handles mixed left and right alignment', () => {
    const rows: ColumnDef[][] = [
      [
        { value: 'repo-a', align: 'left' },
        { value: '5', align: 'right' },
        { value: 'main' },
      ],
      [
        { value: 'repo-long-name', align: 'left' },
        { value: '42', align: 'right' },
        { value: 'develop' },
      ],
    ];

    const result = formatAlignedTable(rows);

    // Column 0: max width 14, left-aligned
    // Column 1: max width 2, right-aligned
    // Column 2: max width 7, left-aligned (default)
    expect(result).toEqual([
      'repo-a           5  main   ',
      'repo-long-name  42  develop',
    ]);
  });

  it('handles rows with different column counts (shorter rows padded with empty)', () => {
    const rows: ColumnDef[][] = [
      [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
      [{ value: 'x' }],
    ];

    const result = formatAlignedTable(rows);

    // Row 2 should have empty padding for columns 1 and 2
    expect(result.length).toBe(2);
    expect(result[0]).toBe('a  b  c');
    expect(result[1]).toBe('x      ');
  });

  it('separates columns with two spaces', () => {
    const rows: ColumnDef[][] = [
      [{ value: 'a' }, { value: 'b' }],
      [{ value: 'c' }, { value: 'd' }],
    ];

    const result = formatAlignedTable(rows);

    // Single-char columns, so no padding needed; just separator
    expect(result[0]).toBe('a  b');
    expect(result[1]).toBe('c  d');
  });
});
