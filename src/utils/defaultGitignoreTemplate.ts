/**
 * 新项目常用忽略规则（Node / Vite / React / Tauri 等）。
 * 用户可在创建后按需增删。
 */
export const DEFAULT_GITIGNORE_TEMPLATE = `# Dependencies
node_modules/

# Build
dist/
dist-ssr/
build/
*.tsbuildinfo

# Vite cache
.vite/

# Rust / Tauri
src-tauri/target/

# Environment & local config
.env
.env.*
!.env.example

# Logs & caches
*.log
logs/
.npm-cache/
.pnpm-debug.log*
.yarn/cache
.cache/
.parcel-cache/
.turbo/

# Coverage & tests
coverage/
*.lcov
.nyc_output/

# OS
.DS_Store
Thumbs.db

# Editors (按需取消注释)
# .idea/
# .vscode/*
# !.vscode/extensions.json
`;
