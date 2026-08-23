import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { readdir, stat, mkdtemp, writeFile, readFile, mkdir } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

import { createActor } from 'xstate';

import {
  AbkError,
  type AudioProbe,
  type BuildOptions,
  type BuildPlan,
  type Chapter,
  type InspectionReport,
} from './types.js';
import { createRunLog } from './run-log.js';
import { buildMachine } from './workflow.js';

const AUDIO_EXTENSIONS = new Set([
  '.aac',
  '.flac',
  '.m4a',
  '.mp3',
  '.ogg',
  '.oga',
  '.opus',
  '.wav',
  '.wma',
]);
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);

function naturalCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

async function outputOf(command: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(command[0]!, command.slice(1), {
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    throw new Error(stderr.trim() || `${command[0]} failed`);
  }
}

async function run(command: string[], logPath?: string): Promise<void> {
  try {
    const { stdout, stderr } = await execFileAsync(command[0]!, command.slice(1), {
      maxBuffer: 16 * 1024 * 1024,
    });
    if (logPath) await writeFile(logPath, `${stdout}${stderr}`);
  } catch (error) {
    const stdout =
      error && typeof error === 'object' && 'stdout' in error ? String(error.stdout) : '';
    const stderr =
      error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : '';
    if (logPath) await writeFile(logPath, `${stdout}${stderr}`);
    throw new AbkError(
      'BUILD_FAILED',
      `ffmpeg failed: ${stderr.trim() || command.join(' ')}`,
      logPath,
    );
  }
}

async function walk(input: string): Promise<string[]> {
  const info = await stat(input).catch(() => undefined);
  if (!info) throw new AbkError('INPUT_UNREADABLE', `Cannot read input: ${input}`);
  if (info.isFile())
    return AUDIO_EXTENSIONS.has(extname(input).toLowerCase()) ? [resolve(input)] : [];
  const found: string[] = [];
  for (const entry of await readdir(input, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const full = join(input, entry.name);
    if (entry.isDirectory()) found.push(...(await walk(full)));
    else if (entry.isFile() && AUDIO_EXTENSIONS.has(extname(entry.name).toLowerCase()))
      found.push(resolve(full));
  }
  return found;
}

export async function discoverInputs(inputs: readonly string[]): Promise<string[]> {
  const found = (await Promise.all(inputs.map(walk))).flat();
  const unique = [...new Set(found)].sort(naturalCompare);
  if (!unique.length)
    throw new AbkError(
      'NO_INPUT_FILES',
      'No supported audio files were found.',
      'Pass audio files or a directory containing them.',
    );
  return unique;
}

export async function probe(path: string): Promise<AudioProbe> {
  let raw: string;
  try {
    raw = await outputOf([
      'ffprobe',
      '-v',
      'error',
      '-show_entries',
      'format=duration,bit_rate:format_tags:stream=codec_name,codec_type,channels,sample_rate,bit_rate,disposition,width,height',
      '-of',
      'json',
      path,
    ]);
  } catch (error) {
    throw new AbkError(
      'PROBE_FAILED',
      `Could not probe ${basename(path)}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const data = JSON.parse(raw) as {
    format?: { duration?: string; bit_rate?: string; tags?: Record<string, string> };
    streams?: Array<{
      codec_name?: string;
      codec_type?: string;
      channels?: number;
      sample_rate?: string;
      bit_rate?: string;
    }>;
  };
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  if (!audio?.codec_name || !data.format?.duration)
    throw new AbkError('PROBE_FAILED', `No audio stream in ${basename(path)}.`);
  return {
    path,
    durationMs: Math.round(Number(data.format.duration) * 1000),
    codec: audio.codec_name,
    channels: audio.channels ?? 0,
    sampleRate: Number(audio.sample_rate ?? 0),
    bitrate: Number(audio.bit_rate ?? data.format.bit_rate ?? 0) || undefined,
    tags: data.format.tags ?? {},
  };
}

function titleFromFile(path: string): string {
  return basename(path, extname(path))
    .replace(/^\d+\s*[-._]\s*/, '')
    .trim();
}

function titleFromDirectory(path: string): string {
  return basename(path).replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
}

async function findCover(inputs: readonly string[]): Promise<string | undefined> {
  const roots = [...new Set(inputs.map((input) => dirname(input)))];
  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const lower = entry.name.toLowerCase();
      if (
        entry.isFile() &&
        IMAGE_EXTENSIONS.has(extname(lower)) &&
        /^(cover|folder|artwork)/.test(lower)
      )
        return join(root, entry.name);
    }
  }
  return undefined;
}

function chaptersFromProbes(probes: readonly AudioProbe[]): Chapter[] {
  let startMs = 0;
  return probes.map((item, index) => {
    const chapter = {
      index: index + 1,
      startMs,
      endMs: startMs + item.durationMs,
      title: titleFromFile(item.path),
    };
    startMs = chapter.endMs;
    return chapter;
  });
}

async function chaptersFromText(path: string, durationMs: number): Promise<Chapter[]> {
  const text = await readFile(path, 'utf8');
  if (text.startsWith(';FFMETADATA1')) {
    const chapters: Chapter[] = [];
    const blocks = text.split(/\[CHAPTER\]\s*/).slice(1);
    for (const [index, block] of blocks.entries()) {
      const values = Object.fromEntries(
        block
          .split(/\r?\n/)
          .filter((line) => line.includes('='))
          .map((line) => line.split(/=(.*)/s) as [string, string]),
      );
      const [numerator, denominator] = (values.TIMEBASE ?? '1/1000000000').split('/').map(Number);
      const scale = (1000 * numerator) / denominator;
      chapters.push({
        index: index + 1,
        startMs: Math.round(Number(values.START) * scale),
        endMs: Math.round(Number(values.END) * scale),
        title: values.title ?? `Chapter ${index + 1}`,
      });
    }
    return chapters;
  }
  const entries = text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const match = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?\s+(.+)$/.exec(line.trim());
      if (!match) throw new AbkError('INVALID_CHAPTER_FILE', `Invalid chapter line: ${line}`);
      const [, hours, minutes, seconds, milliseconds = '0', title] = match;
      return {
        startMs:
          (Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000 +
          Number(milliseconds.padEnd(3, '0')),
        title,
      };
    });
  return entries.map((entry, index) => ({
    index: index + 1,
    startMs: entry.startMs,
    endMs: entries[index + 1]?.startMs ?? durationMs,
    title: entry.title,
  }));
}

export async function planBuild(options: BuildOptions): Promise<BuildPlan> {
  const paths = await discoverInputs(options.inputs);
  const probes: AudioProbe[] = [];
  for (const path of paths) probes.push(await probe(path));
  const codecs = new Set(probes.map((item) => `${item.codec}/${item.sampleRate}/${item.channels}`));
  if (options.noConversion && codecs.size !== 1)
    throw new AbkError(
      'REMUX_INCOMPATIBLE',
      'Cannot remux sources with differing codec, sample-rate, or channel layouts.',
      'Remove --no-conversion to normalize the inputs.',
    );
  const first = probes[0]!;
  const requested = options.inputs[0] ?? first.path;
  const requestedInfo = await stat(requested).catch(() => undefined);
  const inferredDir = requestedInfo?.isDirectory() ? resolve(requested) : dirname(first.path);
  const output = resolve(
    options.output ?? join(inferredDir, `${titleFromDirectory(inferredDir)}.m4b`),
  );
  const chapters =
    options.chapters === 'none'
      ? []
      : options.chapters === 'from'
        ? chaptersFromProbes(probes)
        : await chaptersFromText(
            options.chapters,
            probes.reduce((sum, item) => sum + item.durationMs, 0),
          );
  return {
    inputs: probes,
    output,
    title: options.title ?? titleFromDirectory(inferredDir) ?? first.tags.title,
    author: options.author ?? first.tags.artist,
    chapters,
    cover: options.cover ?? (await findCover(paths)),
    mode: options.noConversion ? 'remux' : 'transcode',
    bitrate: options.bitrate,
  };
}

function escapeConcat(path: string) {
  return path.replace(/'/g, "'\\''");
}

function escapeMetadata(value: string) {
  return value.replace(/([=;#\\\n])/g, '\\$1');
}

async function writeMetadata(plan: BuildPlan, path: string): Promise<void> {
  const lines = [';FFMETADATA1', `title=${escapeMetadata(plan.title)}`];
  if (plan.author) lines.push(`artist=${escapeMetadata(plan.author)}`);
  for (const chapter of plan.chapters) {
    lines.push(
      '',
      '[CHAPTER]',
      'TIMEBASE=1/1000',
      `START=${chapter.startMs}`,
      `END=${chapter.endMs}`,
      `title=${escapeMetadata(chapter.title)}`,
    );
  }
  await writeFile(path, `${lines.join('\n')}\n`);
}

export async function executeBuild(
  plan: BuildPlan,
  options: BuildOptions,
): Promise<{ output: string; runDir: string }> {
  const workflow = createActor(buildMachine);
  workflow.start();
  workflow.send({ type: 'START' });
  const base = options.tempDir ?? join(tmpdir(), 'abk');
  await mkdir(base, { recursive: true });
  const runDir = await mkdtemp(join(base, 'run-'));
  const log = await createRunLog(runDir, options.progress);
  await log.writeJson('plan.json', plan);
  await log.event('PLAN_RESOLVED', { inputs: plan.inputs.length, mode: plan.mode });

  const concat = join(runDir, 'inputs.txt');
  const metadata = join(runDir, 'chapters.ffmeta');
  await writeFile(
    concat,
    plan.inputs.map((input) => `file '${escapeConcat(input.path)}'`).join('\n'),
  );
  await writeMetadata(plan, metadata);
  const command = [
    'ffmpeg',
    '-y',
    '-v',
    'error',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    concat,
    '-i',
    metadata,
  ];
  if (plan.cover) command.push('-i', plan.cover);
  command.push('-map', '0:a', '-map_metadata', '1');
  if (plan.mode === 'remux') command.push('-c:a', 'copy');
  else command.push('-c:a', 'aac', '-b:a', plan.bitrate);
  if (plan.cover)
    command.push('-map', '2:v:0', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic');
  command.push('-movflags', '+faststart', plan.output);
  await run(command, join(runDir, 'assemble.log'));
  workflow.send({ type: 'ASSEMBLED' });
  await inspectFile(plan.output);
  workflow.send({ type: 'VERIFIED' });
  await log.event('BUILD_SUCCEEDED', { output: plan.output });
  const result = { v: 1, ok: true, data: { output: plan.output, runDir } };
  await log.writeJson('result.json', result);
  return { output: plan.output, runDir };
}

export async function inspectFile(path: string): Promise<InspectionReport> {
  const raw = await outputOf([
    'ffprobe',
    '-v',
    'error',
    '-show_entries',
    'format=duration,bit_rate:format_tags:stream=codec_name,codec_type,channels,sample_rate,bit_rate,width,height:stream_disposition=attached_pic:chapter=start_time,end_time:chapter_tags',
    '-of',
    'json',
    path,
  ]);
  const data = JSON.parse(raw) as {
    format?: { duration?: string; bit_rate?: string; tags?: Record<string, string> };
    streams?: Array<{
      codec_name?: string;
      codec_type?: string;
      channels?: number;
      sample_rate?: string;
      bit_rate?: string;
      width?: number;
      height?: number;
      disposition?: { attached_pic?: number };
    }>;
    chapters?: Array<{ start_time?: string; end_time?: string; tags?: Record<string, string> }>;
  };
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  if (!audio?.codec_name || !data.format?.duration)
    throw new AbkError('INSPECT_FAILED', `No audio stream in ${path}.`);
  const image = data.streams?.find((stream) => stream.disposition?.attached_pic === 1);
  const info = await stat(path);
  return {
    file: resolve(path),
    sizeBytes: info.size,
    tags: data.format.tags ?? {},
    chapters: (data.chapters ?? []).map((chapter, index) => ({
      index: index + 1,
      startMs: Math.round(Number(chapter.start_time ?? 0) * 1000),
      endMs: Math.round(Number(chapter.end_time ?? 0) * 1000),
      title: chapter.tags?.title ?? `Chapter ${index + 1}`,
    })),
    cover: {
      present: Boolean(image),
      format: image?.codec_name,
      width: image?.width,
      height: image?.height,
    },
    audio: {
      codec: audio.codec_name,
      channels: audio.channels ?? 0,
      sampleRate: Number(audio.sample_rate ?? 0),
      bitrate: Number(audio.bit_rate ?? data.format.bit_rate ?? 0) || undefined,
      durationMs: Math.round(Number(data.format.duration) * 1000),
    },
  };
}
