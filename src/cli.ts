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
  seriesPart: z.string().optional(),
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
  const cli = createCli();
  const parsed = cli.parse(['node', 'abk', ...argv], { run: false });
  const options = parsed.options;
  if (cli.matchedCommandName === 'inspect') {
    const [file, ...extra] = parsed.args;
    if (!file || extra.length)
      throw new AbkError('INVALID_ARGUMENT', 'inspect requires exactly one file path.');
    return {
      command: 'inspect',
      file,
      json: Boolean(options.json),
      chaptersOnly: Boolean(options.chaptersOnly),
    };
  }
  if (cli.matchedCommandName !== 'build')
    throw new AbkError('INVALID_ARGUMENT', 'Run abk --help for available commands.');
  const input = buildSchema.parse({
    inputs: parsed.args.length ? parsed.args : ['.'],
    output: options.output,
    force: options.force,
    dryRun: options.dryRun,
    json: options.json,
    noConversion: options.conversion === false,
    jobs: options.jobs,
    bitrate: options.bitrate,
    title: options.title,
    author: options.author,
    cover: options.cover,
    chapters: options.chapters,
    tempDir: options.tempDir,
    progress: options.progress,
  });
  return { command: 'build', ...input };
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
  if (argv.includes('--help') || argv.includes('-h')) {
    const command = argv[0];
    console.log(command === 'inspect' ? inspectHelp() : buildHelp());
    return;
  }
  if (argv.includes('--version') || argv.includes('-V')) {
    console.log('abk 0.1.0');
    return;
  }
  const parsed = parseCommand(argv);
  try {
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
        : { code: 'BUILD_FAILED', message: error instanceof Error ? error.message : String(error) };
    if (parsed.json) console.log(JSON.stringify(envelope(false, undefined, known)));
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
