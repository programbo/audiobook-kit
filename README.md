# audiobook-kit (`abk`)

Build audiobooks (`.m4b`) from ordinary audio files. A Bun + ffmpeg CLI designed for humans and agents.

> 🚧 Pre-release — under active development. Tracking happens on the [project board](https://github.com/orgs/programbo/projects/1).

```text
abk build "~/Audiobooks/Small Gods (1992)/"        # folder → Small Gods.m4b
abk inspect "Small Gods.m4b"                       # verify tags, chapters, cover
```

## Design principles

- **Infer maximum, pre-fill best values.** `abk build .` scans, natural-sorts,
  infers title/author from names, auto-detects cover art, picks a sane bitrate.
- **Omitted stays omitted.** Metadata is never fabricated beyond title/author inference.
- **Errors prevented by constraints, not warnings** — invalid plans fail fast, before any work starts.
- **Two audiences, one binary**: rich TTY output for humans; stable versioned JSON
  (`{ v: 1, ok: true, data }`), NDJSON progress on stderr, and run-dir logs for agents.

## Architecture

| Piece | Choice |
|---|---|
| Runtime | Bun ≥ 1.4 |
| Transcoding | system `ffmpeg` / `ffprobe` (only media dependency) |
| Arg parsing | CAC + zod validation + custom grouped help renderer |
| MP4 tags & chapters | taglib-wasm |
| Cover art | built-in `Bun.Image` |

Chapter input formats: ffmetadata (`.ffmeta`), plain text (`00:31:15 Chapter title`),
with CSV/JSONL planned via a shared canonical IR.

## Status

See the [Roadmap view](https://github.com/orgs/programbo/projects/1) — six phases,
from CLI skeleton through agent ergonomics.

## License

TBD
