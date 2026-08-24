# Excalicast macOS 桌面端发布与分发

## 正式安装包放在哪里

正式的 `Excalicast-mac-arm64.dmg` 放在 **GitHub Releases**，而不是 Supabase Storage。

- GitHub Release 是版本化安装包、`SHA256SUMS.txt` 和发布说明的唯一发布源。
- Web 端下载入口应指向固定 release、GitHub 的 latest download 地址，或由服务端下载接口重定向到对应的 GitHub Release asset。
- Supabase 只保存可查询的发布元数据，例如版本、最低 macOS 版本、release asset URL、SHA-256、发布时间和是否强制升级。它不保存 Developer ID 私钥、App Store Connect API key，也不作为正式 DMG 的主存储。
- 若未来下载量要求独立 CDN，可把已签名、公证且校验和一致的 Release asset 镜像到对象存储；GitHub Release 仍是发布事实源。

这种分工让安装包与 Git tag、Release notes、校验和天然绑定，同时避免业务数据库和大文件分发耦合。

## 发布流水线

工作流文件：`.github/workflows/desktop-macos-release.yml`

触发方式：

1. 推送符合 `desktop-v*` 的 tag，例如 `desktop-v0.2.0`。
2. 在 GitHub Actions 手动运行，并填写 `desktop-vX.Y.Z` 格式的 `release_tag`。

流水线会执行：

1. `npm ci` 按 lockfile 安装依赖。
2. 桌面 TypeScript 检查与 Swift 原生契约测试。
3. 将 Swift 原生媒体引擎显式编译为 `arm64-apple-macosx`，并验证二进制架构。
4. 构建 Electron arm64 App/DMG，使用 Developer ID Application 签名并通过 Apple 公证。
5. 校验 App 签名、DMG 公证票据和 Gatekeeper 评估。
6. 固定输出 `Excalicast-mac-arm64.dmg`，生成并复验 `SHA256SUMS.txt`。
7. 上传 Actions artifact，并发布到 GitHub Release。

正式工作流不存在“未签名继续发布”的降级路径：任一签名或公证 secret 缺失、签名校验失败、公证票据缺失时，任务立即失败，GitHub Release 不会执行。

原生包使用 Swift Tools 6.0，因此 GitHub runner 必须使用带 Swift 6 的 `macos-15`（或显式安装并选择 Swift 6 工具链）。`macos-14` 默认 Swift 5.10，无法解析当前 package，不能通过降低 `swift-tools-version` 规避。

## GitHub 环境和 Secrets

在仓库 Settings → Environments 创建受保护环境 `macos-production`，建议要求 maintainer 审批，并把下列 secrets 放在该环境中：

| Secret | 内容 |
|---|---|
| `MACOS_CERTIFICATE_P12_BASE64` | Developer ID Application `.p12` 文件的 base64 内容 |
| `MACOS_CERTIFICATE_PASSWORD` | `.p12` 导出密码 |
| `APPLE_API_KEY_P8` | App Store Connect API key `.p8` 的原始文本 |
| `APPLE_API_KEY_ID` | App Store Connect API key ID |
| `APPLE_API_ISSUER` | App Store Connect issuer ID |

证书应为 `Developer ID Application` 类型。API key 只授予完成 notarization 所需的最低权限。不要把 `.p12`、`.p8`、密码或解码后的临时文件提交到仓库，也不要在 Actions 日志中打印它们。

配置前可在准备导出证书的 Mac 上只读检查签名身份：

```bash
security find-identity -v -p codesigning
```

输出必须至少包含一个有效的 `Developer ID Application` 身份。若显示 `0 valid identities found`，需要先在 Apple Developer Certificates 创建并下载该证书，并确保对应私钥同时存在于钥匙串；只有证书而没有匹配私钥也无法导出可用的 `.p12`。

生成证书 secret 的示例（在可信 Mac 本地执行）：

```bash
base64 -i DeveloperIDApplication.p12 | pbcopy
```

流水线仅在 runner 临时目录解码密钥，设置权限为 `0600`，结束时无论成功或失败都会删除临时文件。

全部 secrets 配置在 `macos-production` 的 **Environment secrets** 后，可以在失败的 Actions run 中选择 `Re-run jobs → Re-run failed jobs`。若环境启用了 Required reviewers，还需在 `Review deployments` 中人工批准；私钥和密码不要发送到 issue、PR、聊天或普通仓库变量。

## 发布操作

正式版本：

```bash
git tag -a desktop-v0.2.0 -m "Excalicast Desktop 0.2.0"
git push origin desktop-v0.2.0
```

测试版本使用带后缀 tag，并在手动触发时勾选 pre-release，例如 `desktop-v0.2.0-beta.1`。

GitHub 的 `releases/latest/download/...` 通常只解析最新正式 Release，不保证指向 pre-release。Beta 验收应使用该 tag 对应的直接 asset URL；Web 导航继续只暴露已签名、公证的稳定版本。

发布后至少核对：

- Release 中同时存在 `Excalicast-mac-arm64.dmg` 和 `SHA256SUMS.txt`。
- 下载后执行 `shasum -a 256 -c SHA256SUMS.txt` 成功。
- 在未安装开发证书的 Apple Silicon Mac 上首次打开不出现“无法验证开发者”。
- 屏幕录制、系统音频、麦克风和摄像头权限提示与录制均正常。

## Web 下载入口

Web 导航不要硬编码某次 Actions artifact URL，因为 Actions artifact 有保留期限且通常要求登录。应使用公开 GitHub Release asset URL，或使用服务端接口读取 Supabase 的当前稳定版本元数据后执行 `302/307` 重定向。

推荐元数据字段：

| 字段 | 示例 |
|---|---|
| `platform` | `macos` |
| `arch` | `arm64` |
| `channel` | `stable` |
| `version` | `0.2.0` |
| `download_url` | GitHub Release asset URL |
| `sha256` | `SHA256SUMS.txt` 对应值 |
| `minimum_os_version` | 产品支持的最低 macOS 版本 |
| `published_at` | Release 发布时间 |

下载接口只返回已签名、公证且 checksum 已登记的版本，避免 Web 端链接到构建中的候选包。
