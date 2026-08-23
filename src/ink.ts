import { Box, Text, render } from 'ink';
import { createElement } from 'react';

function Summary({ lines }: { lines: readonly string[] }) {
  return createElement(
    Box,
    { flexDirection: 'column' },
    ...lines.map((line) => createElement(Text, { key: line }, line)),
  );
}

/** Render one stable final frame without taking over piped/agent output. */
export async function renderSummary(lines: readonly string[]) {
  const instance = render(createElement(Summary, { lines }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  instance.unmount();
}
