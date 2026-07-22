# Windows 自动更新（GitHub Releases）

Loom 使用 Tauri 2 Updater，从 **正式版** GitHub Release 的 `latest.json` 检查、下载并安装 Windows 更新。

**当前应用 manifest 版本：** 与仓库 `package.json` / `src-tauri/tauri.conf.json` 一致（现为 **0.1.5**）。  
**首个带 Updater 的发行版：** **v0.1.4**（及之后）。

## 行为

- 启动且设置加载完成后，若开启「启动时检查更新」，在后台**静默检查**（**不**自动下载）。
- 设置 → **版本更新**（`UpdateContent`）可手动检查；发现新版本后需用户点击 **下载并安装**。
- 仅 **Windows x86_64**；通道为 `/releases/latest`（非 prerelease / 非 draft）。
- 更新包为 **NSIS**（`Loom_*_x64-setup.exe`）+ 对应 `.sig`；**MSI 仅作手动 / 企业安装资产**。
- 运行时状态：`useAppUpdateStore`（single-flight 检查，进度事件）；偏好：`checkForUpdatesOnStartup`。

## 客户端配置

| 项 | 位置 / 值 |
|----|-----------|
| Endpoint | `https://github.com/Lennoxsudo/loom/releases/latest/download/latest.json` |
| 公钥 | `src-tauri/tauri.conf.json` → `plugins.updater.pubkey` |
| 安装模式 | `plugins.updater.windows.installMode: "passive"` |
| 产物 | `bundle.createUpdaterArtifacts: true` |
| 权限 | `src-tauri/capabilities/default.json` → `updater:default` |

## 密钥（一次性）

本机示例路径（**勿提交私钥**）：

- 私钥：`%USERPROFILE%\.tauri\loom-updater.key`
- 公钥：`%USERPROFILE%\.tauri\loom-updater.key.pub`（内容已写入 `tauri.conf.json`）
- 私钥密码：仅本地与 GitHub Secrets，**不要写进代码或文档正文**

在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 值 |
|--------|-----|
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件全文，或 `tauri signer` 输出的私钥字符串 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时使用的密码 |

丢失私钥或密码后，已安装客户端将无法再信任新签名，只能重新发版并要求用户手动安装。

## 发布流程

### 版本对齐

同步以下字段为同一 SemVer（无 `v` 前缀）：

- `package.json` / `package-lock.json`（root / `packages[""]`）
- `src-tauri/Cargo.toml` / `Cargo.lock`（包 `loom`）
- `src-tauri/tauri.conf.json`

```bash
node scripts/check-release-version.mjs
# 若在 CI 打 tag，可设 RELEASE_TAG=v0.1.5 一并校验
```

### 推荐：标签触发 CI

1. 提交版本 bump 与变更。
2. 打标签并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`（与 manifest 一致）。
3. 工作流 `.github/workflows/release-windows.yml`：
   - 校验版本一致  
   - 用 Secrets 签名构建  
   - 上传 NSIS / MSI / `.sig` / `latest.json`  
   - 创建正式 GitHub Release（非 draft）

### 本地签名构建

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\loom-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run tauri:build
```

产物通常在：

- `src-tauri/target/release/bundle/nsis/Loom_*_x64-setup.exe` (+ `.sig`)
- `src-tauri/target/release/bundle/msi/Loom_*_x64_en-US.msi`（可选上传）

`latest.json` 示例结构（**仅** `windows-x86_64`，`signature` 为 NSIS `.sig` 全文）：

```json
{
  "version": "0.1.5",
  "notes": "…",
  "pub_date": "2026-07-22T13:45:32Z",
  "platforms": {
    "windows-x86_64": {
      "url": "https://github.com/Lennoxsudo/loom/releases/download/v0.1.5/Loom_0.1.5_x64-setup.exe",
      "signature": "<contents of Loom_0.1.5_x64-setup.exe.sig>"
    }
  }
}
```

本地可先拷到 `dist-release/`（已 gitignore），再用 `gh release create vX.Y.Z …` 上传。

### 发布后验证

1. `https://github.com/Lennoxsudo/loom/releases/latest` 指向目标 tag。  
2. `…/releases/latest/download/latest.json` 中 `version` 与 NSIS URL 正确。  
3. 已安装较低版本（≥ 0.1.4）客户端：设置 → 版本更新 → 可检查到新版本并完成签名校验与安装。

## 现有用户

| 当前版本 | 如何获得更新 |
|----------|----------------|
| ≤ **v0.1.3** | **无** Updater；须手动安装一次 ≥ v0.1.4 安装包 |
| ≥ **v0.1.4** | 应用内检查 / 启动检查 → 用户确认后下载安装 |

## 回滚

Updater **不会**自动降级。需要回滚时：

- 发布**更高版本号**的修正包，或  
- 指导用户手动安装目标版本安装包。

## 相关代码

| 路径 | 说明 |
|------|------|
| `src/stores/useAppUpdateStore.ts` | 更新状态机 |
| `src/components/settings/UpdateContent.tsx` | 设置页 UI |
| `src/App.tsx` | 启动静默检查 |
| `src-tauri/tauri.conf.json` | pubkey / endpoint |
| `.github/workflows/release-windows.yml` | 签名发版 CI |
| `scripts/check-release-version.mjs` | 版本一致性 |
