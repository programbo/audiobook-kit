#!/usr/bin/env bun
import { stat } from 'node:fs/promises';
import { cac } from 'cac';
import { z } from 'zod';

import { executeBuild, inspectFile, planBuild } from './media.js';
import { AbkError, type BuildOptions, type InspectionReport } from './types.js';

const buildSchema = z.object({
  inputs: z.array(z.string()).default(['.']),
  output: z.string().optional(),
  force: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  json: z.boolean().default(false),
  noConversion: z.boolean().default(false),
  jobs: z.coerce.number().int().positive().default(1),
  bitrate: z
    .string()
    .regex(/^\d+k$/, 'Bitrate must use the form 64k.')
    .default('128k'),
  title: z.string().optional(),
  author: z.string().optional(),
  narrator: z.string().optional(),
  series: z.string().optional(),
  seriesPart: z
    .string()
    .regex(/^[1-9]\d*$/, 'Series part must be a positive whole number.')
    .optional(),
  year: z
    .string()
    .regex(/^\d{4}$/)
    .optional(),
  genre: z.string().optional(),
  cover: z.string().optional(),
  chapters: z.string().default('from'),
  tempDir: z.string().optional(),
  progress: z.boolean().default(false),
});

export function parseCommand(
  argv: string[],
):
  | ({ command: 'build' } & BuildOptions)
  | { command: 'inspect'; file: string; json: boolean; chaptersOnly: boolean } {
  const [command = 'build', ...tokens] = argv;
  if (command === 'inspect') {
    const [file] = tokens.filter((token) => !token.startsWith('-'));
    return {
      command: 'inspect',
      file: file ?? '',
      json: tokens.includes('--json'),
      chaptersOnly: tokens.includes('--chapters-only'),
    };
  }
  const options: Record<string, unknown> = { inputs: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith('-')) (options.inputs as string[]).push(token);
    else if (token === '-o' || token === '--output') options.output = tokens[++index];
    else if (token === '-f' || token === '--force') options.force = true;
    else if (token === '-n' || token === '--dry-run') options.dryRun = true;
    else if (token === '--json') options.json = true;
    else if (token === '--no-conversion') options.noConversion = true;
    else if (token === '--jobs') options.jobs = tokens[++index];
    else if (token === '--bitrate') options.bitrate = tokens[++index];
    else if (token === '--title') options.title = tokens[++index];
    else if (token === '--author') options.author = tokens[++index];
    else if (token === '--narrator') options.narrator = tokens[++index];
    else if (token === '--series') options.series = tokens[++index];
    else if (token === '--series-part') options.seriesPart = tokens[++index];
    else if (token === '--year') options.year = tokens[++index];
    else if (token === '--genre') options.genre = tokens[++index];
    else if (token === '--cover') options.cover = tokens[++index];
    else if (token === '--chapters') options.chapters = tokens[++index];
    else if (token === '--temp-dir') options.tempDir = tokens[++index];
    else if (token === '--progress') options.progress = true;
  }
  const parsed = buildSchema.parse(
    options.inputs && (options.inputs as string[]).length ? options : { ...options, inputs: ['.'] },
  );
  return { command: 'build', ...parsed };
}

export function buildHelp() {
  return `abk build — build a single .m4b audiobook from files or folders

USAGE
  abk build [inputs...] [options]

OUTPUT
  -o, --output <file>        Output .m4b path. [default: input folder name]
  -f, --force                Overwrite an existing output.
  --no-conversion            Remux only; sources must share audio properties.

METADATA
  --title <text>  --author <text>  --cover <file>

CHAPTERS
  --chapters <from|none|file>  Filename chapters by default; accepts ffmetadata
                               or HH:MM:SS title text.

CONTROL
  -n, --dry-run              Resolve and print the plan without building.
  --jobs <n>                 Parallel input conversions. [default: 1]
  --bitrate <Nk>             AAC bitrate. [default: 128k]
  --temp-dir <dir>           Run directory parent.
  --progress                 Mirror NDJSON events to stderr.
  --json                     Emit exactly one result document to stdout.`;
}

export function inspectHelp() {
  return `abk inspect — show tags, chapters, cover, and stream info for an .m4b

USAGE
  abk inspect <file> [options]

OPTIONS
  --chapters-only            Print just the chapter list.
  --json                     Emit one structured inspection report.`;
}

function envelope(ok: boolean, data?: unknown, error?: unknown) {
  return ok ? { v: 1, ok: true, data } : { v: 1, ok: false, error };
}

async function printHuman(lines: readonly string[]) {
  if (process.stdout.isTTY) {
    const { renderSummary } = await import('./ink.js');
    await renderSummary(lines);
    return;
  }
  console.log(lines.join('\n'));
}

async function printHumanInspection(report: InspectionReport, chaptersOnly: boolean) {
  if (chaptersOnly) {
    await printHuman(
      report.chapters.map(
        (chapter) =>
          `${String(chapter.index).padStart(2, '0')}  ${formatTime(chapter.startMs)}  ${chapter.title}`,
      ),
    );
    return;
  }
  await printHuman([
    report.file,
    '',
    `Title: ${report.tags.title ?? '(none)'}`,
    `Artist: ${report.tags.artist ?? '(none)'}`,
    `Audio: ${report.audio.codec}, ${report.audio.channels}ch, ${report.audio.sampleRate} Hz, ${formatTime(report.audio.durationMs)}`,
    `Cover: ${report.cover.present ? `${report.cover.format} ${report.cover.width}×${report.cover.height}` : 'none'}`,
    `Chapters: ${report.chapters.length}`,
    ...report.chapters.map(
      (chapter) =>
        `  ${String(chapter.index).padStart(2, '0')}  ${formatTime(chapter.startMs)}  ${chapter.title}`,
    ),
  ]);
}

function formatTime(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

async function build(options: BuildOptions) {
  const plan = await planBuild(options);
  if (options.dryRun) return { dryRun: true, plan };
  if (!options.force) {
    const exists = await stat(plan.output)
      .then(() => true)
      .catch(() => false);
    if (exists)
      throw new AbkError(
        'OUTPUT_EXISTS',
        `Output already exists: ${plan.output}`,
        'Pass --force to overwrite it.',
      );
  }
  const result = await executeBuild(plan, options);
  const report = await inspectFile(result.output);
  return { ...result, report };
}

export async function main(argv = process.argv.slice(2)) {
  const wantsJson = argv.includes('--json');
  try {
    const parsed = parseCommand(argv);
    if (parsed.command === 'inspect') {
      if (!parsed.file) throw new AbkError('INPUT_UNREADABLE', 'inspect requires a file path.');
      const report = await inspectFile(parsed.file);
      if (parsed.json) console.log(JSON.stringify(envelope(true, report)));
      else await printHumanInspection(report, parsed.chaptersOnly);
      return;
    }
    const result = await build(parsed);
    if (parsed.json) console.log(JSON.stringify(envelope(true, result)));
    else if ('dryRun' in result) console.log(JSON.stringify(result.plan, null, 2));
    else await printHuman([`Built ${result.output}`, `Run directory: ${result.runDir}`]);
  } catch (error) {
    const known =
      error instanceof AbkError
        ? { code: error.code, message: error.message, hint: error.hint }
        : error instanceof z.ZodError
          ? {
              code: 'INVALID_ARGUMENT',
              message: error.issues[0]?.message ?? 'Invalid command arguments.',
            }
          : {
              code: 'BUILD_FAILED',
              message: error instanceof Error ? error.message : String(error),
            };
    if (wantsJson) console.log(JSON.stringify(envelope(false, undefined, known)));
    else
      console.error(`${known.code}: ${known.message}${known.hint ? `\nHint: ${known.hint}` : ''}`);
    process.exitCode = 1;
  }
}

/** CAC owns the executable command grammar; parseCommand is a testable adapter. */
export function createCli() {
  const cli = cac('abk');
  cli
    .command('build [inputs...]', 'Build an .m4b audiobook')
    .option('-o, --output <file>', 'Output .m4b path')
    .option('-f, --force', 'Overwrite output')
    .option('-n, --dry-run', 'Plan without building')
    .option('--json', 'Write one JSON result')
    .option('--no-conversion', 'Remux compatible input')
    .option('--jobs <n>', 'Maximum parallel conversions')
    .option('--bitrate <rate>', 'AAC bitrate')
    .option('--title <text>', 'Audiobook title')
    .option('--author <text>', 'Audiobook author')
    .option('--narrator <text>', 'Audiobook narrator')
    .option('--series <text>', 'Series name')
    .option('--series-part <n>', 'Series position')
    .option('--year <yyyy>', 'Publication year')
    .option('--genre <text>', 'Genre')
    .option('--cover <file>', 'Cover image')
    .option('--chapters <mode-or-file>', 'Chapter source')
    .option('--temp-dir <dir>', 'Run directory parent')
    .option('--progress', 'Write progress NDJSON to stderr');
  cli
    .command('inspect <file>', 'Inspect an audiobook')
    .option('--json', 'Write one JSON report')
    .option('--chapters-only', 'Print chapter list only');
  return cli;
}

if (import.meta.main) void main();
