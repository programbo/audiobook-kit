import { afterEach, describe, expect, test, vi } from 'vitest';

import { buildHelp, inspectHelp, main, parseCommand } from '../src/cli.js';

describe('CLI contract', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = undefined;
  });

  test('build defaults to the current directory and filename chapters', () => {
    expect(parseCommand(['build'])).toMatchObject({
      command: 'build',
      inputs: ['.'],
      chapters: 'from',
      dryRun: false,
      json: false,
    });
  });

  test('parses metadata overrides without changing positional inputs', () => {
    expect(
      parseCommand([
        'build',
        'book',
        '--author',
        'Author',
        '--narrator',
        'Narrator',
        '--series',
        'Series',
        '--series-part',
        '2',
        '--year',
        '2026',
        '--genre',
        'History',
      ]),
    ).toMatchObject({
      command: 'build',
      inputs: ['book'],
      author: 'Author',
      narrator: 'Narrator',
      series: 'Series',
      seriesPart: '2',
      year: '2026',
      genre: 'History',
    });
  });

  test('rejects non-numeric series parts before ffmpeg runs', () => {
    expect(() => parseCommand(['build', '--series-part', 'nope'])).toThrow('Series part');
  });

  test('uses the JSON envelope for schema errors', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await main(['build', '--json', '--year', 'not-a-year']);

    expect(process.exitCode).toBe(1);
    expect(JSON.parse(String(log.mock.calls[0]?.[0]))).toMatchObject({
      v: 1,
      ok: false,
      error: { code: 'INVALID_ARGUMENT' },
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
