# CBM Sidecar binaries

Place platform-specific `codebase-memory` binaries here before release builds.

Run from repo root:

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
