import { describe, expect, test } from 'vitest';

import { buildHelp, inspectHelp, parseCommand } from '../src/cli.js';

describe('CLI contract', () => {
  test('build defaults to the current directory and filename chapters', () => {
    expect(parseCommand(['build'])).toMatchObject({
      command: 'build',
      inputs: ['.'],
      chapters: 'from',
      dryRun: false,
      json: false,
    });
  });

  test('build help explains the non-interactive contract', () => {
    expect(buildHelp()).toContain('--json');
    expect(buildHelp()).toContain('--dry-run');
    expect(buildHelp()).toContain('--chapters');
  });

  test('inspect help exposes its JSON report mode', () => {
    expect(inspectHelp()).toContain('abk inspect <file>');
    expect(inspectHelp()).toContain('--json');
  });
});
