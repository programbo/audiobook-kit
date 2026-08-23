# audiobook-kit (`abk`)

Build one audiobook (`.m4b`) from ordinary audio files. `abk` is a Bun CLI
that uses system `ffmpeg` and `ffprobe`; it has one workflow for people and
agents.

> Pre-release. Track work on the [GitHub Project](https://github.com/orgs/programbo/projects/1).

## Install and requirements

```bash
bun install
bun run build
```

`ffmpeg` and `ffprobe` must be available on `PATH`.

## Use

```bash
# Discover, sort, probe, transcode, add chapters/tags/cover, and write an M4B.
abk build "~/Audiobooks/Small Gods (1992)/"

# Plan without creating audio output — preferred first step for agents.
abk build "~/Audiobooks/Small Gods (1992)/" --dry-run --json

# Avoid re-encoding compatible AAC inputs.
abk build chapters/ -o small-gods.m4b --no-conversion

# Verify the completed file.
abk inspect small-gods.m4b
abk inspect small-gods.m4b --json
```

### `build`

- Recursively discovers supported audio inputs, removes duplicates, and natural-sorts them.
- Uses source filenames as chapter titles by default.
- Accepts `--chapters none`, an FFmpeg `;FFMETADATA1` file, or plain text lines
  in `HH:MM:SS Chapter title` form.
- Auto-detects `cover.*`, `folder.*`, or `artwork.*`; `--cover` overrides it.
- `--no-conversion` requires every source to share codec, sample rate, and channels.
- `--jobs` bounds parallel input conversion work.

### Human and agent modes

`--json` writes exactly one versioned result envelope to stdout:

```json
{ "v": 1, "ok": true, "data": { "output": "/path/book.m4b" } }
```

Every non-dry build creates a run directory with `plan.json`, `progress.ndjson`,
per-input `ffmpeg-*.log`, `assemble.log`, and `result.json`. Add `--progress` to
mirror compact JSONL progress events to stderr while retaining stdout purity.

## Development

Vite+ provides Oxfmt, Oxlint, type checking, tests, and the package build. Bun
is the package manager/runtime.

```bash
bun run format
bun run lint
bun run check     # quality gate: format + lint + type check
bun run test
bun run build
```

Tests generate their own tiny AAC/cover fixtures with ffmpeg. The real
85-minute _Satan's Guide to the Bible_ source is an acceptance fixture only; it
is never part of automated tests.

## Architecture

| Piece                     | Choice                            |
| ------------------------- | --------------------------------- |
| Runtime / package manager | Bun >= 1.4                        |
| Quality/build toolchain   | Vite+ 0.2.1, Oxfmt, Oxlint        |
| CLI grammar / validation  | CAC plus zod                      |
| Workflow lifecycle        | XState v5                         |
| Media processing          | system `ffmpeg` / `ffprobe`       |
| Agent diagnostics         | JSON envelope plus JSONL run logs |

## License

TBD
