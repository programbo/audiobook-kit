export type OutputMode = 'human' | 'json';

export type BuildOptions = {
  inputs: string[];
  output?: string;
  force: boolean;
  dryRun: boolean;
  json: boolean;
  noConversion: boolean;
  bitrate: string;
  title?: string;
  author?: string;
  narrator?: string;
  series?: string;
  seriesPart?: string;
  year?: string;
  genre?: string;
  cover?: string;
  chapters: string;
  tempDir?: string;
  progress: boolean;
};

export type AudioProbe = {
  path: string;
  durationMs: number;
  codec: string;
  channels: number;
  sampleRate: number;
  bitrate?: number;
  tags: Record<string, string>;
};

export type Chapter = {
  index: number;
  startMs: number;
  endMs: number;
  title: string;
};

export type BuildPlan = {
  inputs: AudioProbe[];
  output: string;
  title: string;
  author?: string;
  chapters: Chapter[];
  cover?: string;
  mode: 'transcode' | 'remux';
  bitrate: string;
};

export type InspectionReport = {
  file: string;
  sizeBytes: number;
  tags: Record<string, string>;
  chapters: Chapter[];
  cover: { present: boolean; format?: string; width?: number; height?: number };
  audio: {
    codec: string;
    channels: number;
    sampleRate: number;
    bitrate?: number;
    durationMs: number;
  };
};

export type AbkErrorCode =
  | 'NO_INPUT_FILES'
  | 'INPUT_UNREADABLE'
  | 'OUTPUT_EXISTS'
  | 'MISSING_FFMPEG'
  | 'PROBE_FAILED'
  | 'REMUX_INCOMPATIBLE'
  | 'BUILD_FAILED'
  | 'INSPECT_FAILED'
  | 'INVALID_CHAPTER_FILE'
  | 'INVALID_ARGUMENT';

export class AbkError extends Error {
  constructor(
    readonly code: AbkErrorCode,
    message: string,
    readonly hint?: string,
  ) {
    super(message);
  }
}
