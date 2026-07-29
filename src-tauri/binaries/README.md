# Sidecar binaries

## codebase-memory (CBM)

Place platform-specific `codebase-memory` binaries here before release builds.

```bash
npm run fetch:cbm
```

Or set `LOOM_CBM_PATH` to a local `codebase-memory` executable for development.

Expected filenames (Tauri externalBin):

- `codebase-memory-x86_64-pc-windows-msvc.exe`
- `codebase-memory-x86_64-apple-darwin`
- `codebase-memory-aarch64-apple-darwin`
- `codebase-memory-x86_64-unknown-linux-gnu`
- `codebase-memory-aarch64-unknown-linux-gnu`

## whisper-cli (local STT)

Place platform-specific `whisper-cli` binaries and the tiny model before release builds.

```bash
npm run fetch:whisper
```

Or set:

- `LOOM_WHISPER_PATH` — path to a local whisper-cli / main executable
- `LOOM_WHISPER_MODEL` — path to `ggml-tiny.bin`

Expected filenames (Tauri externalBin):

- `whisper-cli-x86_64-pc-windows-msvc.exe`
- `whisper-cli-x86_64-apple-darwin`
- `whisper-cli-aarch64-apple-darwin`
- `whisper-cli-x86_64-unknown-linux-gnu`
- `whisper-cli-aarch64-unknown-linux-gnu`

Bundled model (Tauri resources):

- `src-tauri/resources/whisper/ggml-tiny.bin`
