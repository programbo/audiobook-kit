import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { executeBuild, inspectFile, planBuild } from '../src/media.js';
import type { BuildOptions } from '../src/types.js';

const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

const execFileAsync = promisify(execFile);

async function ffmpeg(args: string[]) {
  await execFileAsync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args]);
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'abk-test-'));
  workspaces.push(root);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=1',
    '-ac',
    '2',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-metadata',
    'title=First chapter',
    '-metadata',
    'artist=Test Author',
    '-metadata',
    'composer=Source Narrator',
    '-metadata',
    'album=Source Series',
    '-metadata',
    'track=4',
    '-metadata',
    'date=2024',
    '-metadata',
    'genre=Mystery',
    join(root, '01 - First chapter.m4a'),
  ]);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:sample_rate=48000:duration=1',
    '-ac',
    '2',
    '-c:a',
    'aac',
    '-b:a',
    '64k',
    '-metadata',
    'title=Second chapter',
    '-metadata',
    'artist=Test Author',
    join(root, '02 - Second chapter.m4a'),
  ]);
  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x5b1121:s=64x64:d=0.1',
    '-frames:v',
    '1',
    '-q:v',
    '4',
    join(root, 'cover.jpg'),
  ]);
  return root;
}

function options(input: string, output: string): BuildOptions {
  return {
    inputs: [input],
    output,
    force: false,
    dryRun: false,
    json: true,
    noConversion: true,
    jobs: 2,
    bitrate: '64k',
    chapters: 'from',
    progress: false,
  };
}

describe('build integration', () => {
  test('remuxes generated AAC chapters into an inspectable M4B with chapters and cover', async () => {
    const root = await fixture();
    const output = join(root, 'book.m4b');
    const input = options(root, output);
    input.title = 'Fixture Book';
    input.narrator = 'Fixture Narrator';
    input.series = 'Fixture Series';
    input.seriesPart = '2';
    input.year = '2026';
    input.genre = 'Education';
    const plan = await planBuild(input);

    expect(plan.inputs).toHaveLength(2);
    expect(plan.chapters.map((chapter) => chapter.title)).toEqual([
      'First chapter',
      'Second chapter',
    ]);
    expect(plan.cover).toBe(join(root, 'cover.jpg'));

    const result = await executeBuild(plan, options(root, output));
    const report = await inspectFile(result.output);

    expect(report.audio.codec).toBe('aac');
    expect(report.chapters).toHaveLength(2);
    expect(report.chapters.map((chapter) => chapter.title)).toEqual([
      'First chapter',
      'Second chapter',
    ]);
    expect(report.cover.present).toBe(true);
    expect(report.tags).toMatchObject({
      title: 'Fixture Book',
      artist: 'Test Author',
      album: 'Fixture Series',
      date: '2026',
      genre: 'Education',
    });
  });

  test('preserves audiobook metadata from the first input when no override is supplied', async () => {
    const root = await fixture();
    const output = join(root, 'inherited.m4b');
    const input = options(root, output);
    const plan = await planBuild(input);

    expect(plan).toMatchObject({
      narrator: 'Source Narrator',
      series: 'Source Series',
      seriesPart: '4',
      year: '2024',
      genre: 'Mystery',
    });

    const result = await executeBuild(plan, input);
    const report = await inspectFile(result.output);
    expect(report.tags).toMatchObject({
      composer: 'Source Narrator',
      album: 'Source Series',
      track: '4',
      date: '2024',
      genre: 'Mystery',
    });
  });
});
