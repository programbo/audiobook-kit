import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export type RunLog = {
  runDir: string;
  event: (name: string, data?: Record<string, unknown>) => Promise<void>;
  writeJson: (name: string, data: unknown) => Promise<void>;
};

export async function createRunLog(runDir: string, mirrorToStderr = false): Promise<RunLog> {
  await mkdir(runDir, { recursive: true });
  const progressPath = join(runDir, 'progress.ndjson');
  return {
    runDir,
    async event(name, data = {}) {
      const line = `${JSON.stringify({ v: 1, event: name, ...data })}\n`;
      await appendFile(progressPath, line);
      if (mirrorToStderr) process.stderr.write(line);
    },
    async writeJson(name, data) {
      await writeFile(join(runDir, name), `${JSON.stringify(data, null, 2)}\n`);
    },
  };
}
