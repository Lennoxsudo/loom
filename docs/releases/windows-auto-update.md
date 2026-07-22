# Windows 自动更新（GitHub Releases）

Loom 使用 Tauri 2 Updater，从 **正式版** GitHub Release 的 `latest.json` 检查、下载并安装 Windows 更新。

## 行为

- 启动且设置加载完成后，若开启「启动时检查更新」，在后台静默检查（不自动下载）。
- 设置 → 常规 → **应用更新** 可手动检查；发现新版本后需用户点击 **下载并安装**。
- 仅 Windows；仅 `/releases/latest`（非 prerelease / 非 draft）。
- 更新包为 **NSIS**（`*-setup.exe`）+ 对应 `.sig`；MSI 仅作手动安装资产。

## 密钥（一次性）

本机已生成（示例路径）：

- 私钥：`%USERPROFILE%\.tauri\loom-updater.key`（**勿提交仓库**）
- 公钥：`%USERPROFILE%\.tauri\loom-updater.key.pub`（内容已写入 `src-tauri/tauri.conf.json` 的 `plugins.updater.pubkey`）
- 私钥密码：仅保存在你本地与 GitHub Secrets，**不要写进代码**

在 GitHub 仓库 Settings → Secrets and variables → Actions 配置：

| Secret | 值 |
|--------|-----|
| `TAURI_SIGNING_PRIVATE_KEY` | 私钥文件全文，或 `tauri signer` 输出的私钥字符串 |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | 生成密钥时使用的密码 |

丢失私钥或密码后，已安装客户端将无法再信任新签名，只能重新发版并要求用户手动安装。

## 发布流程

1. 同步版本号：`package.json`、`package-lock.json`（root）、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`。
2. 提交并打标签：`vX.Y.Z`（与上述版本一致）。
3. 推送标签：`git push origin vX.Y.Z`。
4. 工作流 `.github/workflows/release-windows.yml` 会：
   - 校验版本一致
   - 用 Secrets 签名构建
   - 上传 NSIS / MSI / `.sig` / `latest.json`
5. 客户端 endpoint：  
   `https://github.com/Lennoxsudo/loom/releases/latest/download/latest.json`

本地校验版本：

```bash
node scripts/check-release-version.mjs
```

本地签名构建（需已设置环境变量）：

```powershell
$env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\loom-updater.key" -Raw
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "<password>"
npm run tauri:build
```

## 现有用户

`v0.1.3` 及更早版本**没有** Updater，无法应用内升级。请让用户先手动安装首个带 Updater 的版本，之后即可自动更新。

## 回滚

Updater 不会自动降级。需要回滚时发布更高版本号的修正包，或指导用户手动安装目标版本。
