import React from 'react';
import { Text, Box } from 'ink';

interface Column<T> {
  key: keyof T;
  label: string;
  width?: number;
  color?: string;
  colorFn?: (value: string) => string | undefined;
  align?: 'left' | 'right';
}

interface TableProps<T extends Record<string, unknown>> {
  data: T[];
  columns: Column<T>[];
}

function pad(str: string, width: number, align: 'left' | 'right' = 'left'): string {
  const truncated = str.length > width ? str.slice(0, width - 1) + '…' : str;
  return align === 'right' ? truncated.padStart(width) : truncated.padEnd(width);
}

export function Table<T extends Record<string, unknown>>({ data, columns }: TableProps<T>) {
  const colWidths = columns.map((col) => {
    const headerLen = col.label.length;
    const maxDataLen = data.reduce((max, row) => {
      const val = String(row[col.key] ?? '');
      return Math.max(max, val.length);
    }, 0);
    return col.width ?? Math.max(headerLen, maxDataLen) + 2;
  });

  const separator = colWidths.map((w) => '─'.repeat(w)).join('─┼─');

  return (
    <Box flexDirection="column">
      <Text>
        {columns.map((col, i) => (
          <Text key={String(col.key)} bold>
            {pad(col.label, colWidths[i])}{i < columns.length - 1 ? ' │ ' : ''}
          </Text>
        ))}
      </Text>
      <Text dimColor>─{separator}─</Text>
      {data.map((row, rowIdx) => (
        <Text key={rowIdx}>
          {columns.map((col, i) => {
            const val = String(row[col.key] ?? '');
            const cellColor = col.colorFn ? col.colorFn(val) : col.color;
            return (
              <Text key={String(col.key)} color={cellColor}>
                {pad(val, colWidths[i], col.align)}{i < columns.length - 1 ? ' │ ' : ''}
              </Text>
            );
          })}
        </Text>
      ))}
    </Box>
  );
}
