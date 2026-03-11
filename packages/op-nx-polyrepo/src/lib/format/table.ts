export interface ColumnDef {
  value: string;
  align?: 'left' | 'right';
}

const COLUMN_SEPARATOR = '  ';

export function formatAlignedTable(rows: ColumnDef[][]): string[] {
  if (rows.length === 0) {
    return [];
  }

  // Determine max column count across all rows
  const maxCols = rows.reduce((max, row) => Math.max(max, row.length), 0);

  // Compute max width per column index
  const colWidths: number[] = new Array(maxCols).fill(0);

  for (const row of rows) {
    for (let i = 0; i < maxCols; i++) {
      const cell = row[i];
      const width = cell ? cell.value.length : 0;

      if (width > colWidths[i]) {
        colWidths[i] = width;
      }
    }
  }

  // Format each row
  return rows.map((row) => {
    const parts: string[] = [];

    for (let i = 0; i < maxCols; i++) {
      const cell = row[i];
      const value = cell ? cell.value : '';
      const align = cell?.align ?? 'left';
      const width = colWidths[i];

      if (align === 'right') {
        parts.push(value.padStart(width));
      } else {
        parts.push(value.padEnd(width));
      }
    }

    return parts.join(COLUMN_SEPARATOR);
  });
}
