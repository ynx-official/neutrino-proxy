# 统一发版构建流

状态：Approved（发布规则已确认；跨平台运行结果以实际 CI 为准）

最后更新：2026-10-15

关联文档：[协作约定](../../AGENTS.md)、[桌面客户端本地运行](../05-operations/client-app-local-development.md)、[开发进展](client-app-development-status.md)

## 已确认规则

用户于 2026-10-15 授权合并发版工作流：推送以 `v` 开头的版本 tag 自动打包服务端、既有命令行客户端及启动脚本、桌面 App。所有必需产物验证通过后自动公开为正式 GitHub Release，不等待人工确认，不配置 App 开发者证书或公证。

唯一发版入口为 [release.yml](../../.github/workflows/release.yml)。两个旧 native 发版流程已合并。`desktop-client.yml` 保留分支及 PR 日常检查，不负责 tag 发布。构建失败、缺少产物或校验失败时，整个 Release 不公开。

tag 必须为可用于安装包的版本，例如 `v2.1.0` 或 `v2.1.0-rc.1`。`v*` 都会触发工作流，但 `vtest` 等非法版本在准备阶段失败；三个数字版本段不得超过 65535。按照用户要求，带 `-rc.1` 的有效 tag 也发布为正式版本，**不自动标为预发布**。

## 发布产物

下列文件使用去除 `v` 的 tag 版本，示例为 `2.1.0`。每次必须齐备 10 个安装或分发文件，另附 2 个校验与溯源文件。

| 文件 | 内容及运行条件 |
|---|---|
| `neutrino-proxy-server-2.1.0-jdk21.zip` | 服务端胖 JAR、内嵌管理后台、配置模板、`start.sh`、`start.cmd`、许可证；需要 Java 21 |
| `neutrino-proxy-client-2.1.0-jdk21.zip` | 既有客户端胖 JAR、配置模板、双平台启动脚本、许可证；需要 Java 21，可用于 Linux、Windows、macOS |
| `neutrino-proxy-server-2.1.0-linux-x64-native.zip` | Linux x64 服务端、配置与启动脚本 |
| `neutrino-proxy-client-2.1.0-linux-x64-native.zip` | Linux x64 命令行客户端、配置与启动脚本 |
| `neutrino-proxy-server-2.1.0-windows-x64-native.zip` | Windows x64 服务端、配置与启动脚本 |
| `neutrino-proxy-client-2.1.0-windows-x64-native.zip` | Windows x64 命令行客户端、配置与启动脚本 |
| `neutrino-proxy-client-app-2.1.0-windows-x64-setup.exe` | Windows x64 NSIS 安装程序，按 Tauri 默认行为安装缺失的 WebView2 |
| `neutrino-proxy-client-app-2.1.0-windows-x64-portable.zip` | Windows x64 App 可执行文件与许可证，需要系统已安装 WebView2；配置仍保存在系统应用目录 |
| `neutrino-proxy-client-app-2.1.0-macos-x64.dmg` | Intel Mac 安装镜像 |
| `neutrino-proxy-client-app-2.1.0-macos-arm64.dmg` | Apple Silicon Mac 安装镜像 |
| `release-manifest.json` | tag、提交 SHA、工作流运行链接、构建工具版本、签名状态、各产物大小及 SHA-256 |
| `SHA256SUMS` | 10 个分发文件与 manifest 的 SHA-256 |

Linux native 当前以 Ubuntu 22.04 / glibc 环境构建和验证，不承诺 Alpine/musl 或更旧 glibc 兼容。Linux ARM64、macOS Java native、Docker 镜像、一键下载安装、系统服务安装和自动更新未纳入本轮。

App 不使用开发者证书：Windows 未签名；macOS 仅使用 `-` 身份进行 ad-hoc 签名以满足平台二进制要求，不公证。系统可能显示 SmartScreen/Gatekeeper 提示或阻止首次启动；这些产物不能被称为已通过平台信任认证。这里的 App 代码签名与连接隧道的 SSL 证书是两套独立机制，不改变应用的 SSL 校验规则。

## 作业和验证顺序

1. `prepare`：校验 tag，解析其实际提交 SHA，运行打包与发布回归测试。后续构建全部检出这个 SHA，避免手动运行时混用默认分支代码。
2. `admin`：使用 Node 20.19.5、提交的 npm 锁文件及 `npm ci --legacy-peer-deps` 构建旧 Vue 管理后台。webpack 3 需要 `--openssl-legacy-provider`；该兼容选项仅限这个构建作业。`build:release` 使用生产模式和同源 `/neutrino-proxy-server` API，避免把既有 `api-prod` 占位地址打入发布包。
3. `java`：分别构建通用 JAR、Linux x64 native、Windows x64 native。管理后台只构建一次并复用；native 使用 GraalVM Community 21.0.2，Windows 初始化 MSVC。JAR 和 native 分开作业，避免 `clean` 删除待发布 JAR。发布准备阶段把后台映射设为 `classpath:static/`；外置 `app.yml` 从构建后的完整配置生成，不复用含空 `protocol` 节点的旧 `app-copy.yml`，避免覆盖协议默认值。
4. `desktop`：在 Windows、Intel macOS、ARM macOS runner 上分别执行组件测试、Rust workspace 测试、格式及 Clippy 检查；Windows 额外执行浏览器流程。生成平台图标并使用 Tauri bundler 输出 NSIS/DMG，Cargo 参数使用 `-- --locked` 传递。
5. Java 发布包解压至临时目录，通过包内启动脚本启动。服务端检查独立 H2 数据目录、HTTP 管理页面、其 JavaScript 资源和隧道端口；客户端检查虚构本地对端上的认证请求与成功响应。测试不连接用户数据库或真实服务，不使用真实 License。
6. `publish`：等待所有构建成功，核对 10 个产物的准确文件名，生成 manifest 和校验和，保存完整 Actions artifact。只有此作业拥有 `contents: write`。
7. 发布脚本重新验证本地哈希与 tag 指向。内部先创建临时私有草稿，上传并核验所有附件的服务端 SHA-256，随后**自动**设置 `draft=false`、`prerelease=false`、`make_latest=true`，无审批或等待步骤。该内部草稿只防止上传一半就公开。

版本注入仅修改 CI 临时检出目录：Maven revision、Java 内置应用版本、npm/package-lock、Tauri 配置、两个 Rust 包和 Cargo.lock 同步更新。不向仓库回写版本提交，不在构建阶段创建 tag。

## 使用与失败恢复

将工作流、脚本、配置和锁文件提交后，推送包含它们的版本 tag 即触发自动发版。例如目标提交已有这些文件时：

```sh
git tag v2.1.0
git push origin v2.1.0
```

这是操作说明，不代表 Codex 已执行提交、tag 或推送。工作流使用仓库自带 `GITHUB_TOKEN`，不需要额外 PAT、签名证书或发布 Environment 审批；仓库组织策略仍须允许该工作流写入 Releases。

Actions 页面也可手动运行 `Release`：填写已存在的 tag，默认 `publish=false`，只构建并保存完整 artifact；明确勾选 `publish` 后才公开。手动运行的工作流本身必须已存在于默认分支。

构建失败可重新运行失败作业；上传失败时保持内部草稿不公开。相同提交、由本工具创建的草稿允许重试并替换尚未公开的构建附件；其他来源的草稿拒绝修改。已公开 Release 不覆盖、不删除，修正版使用新 tag。相同 tag 的运行串行执行，不中断正在发布的任务。

下载完整分发文件后，在同目录执行 `sha256sum -c SHA256SUMS`；Windows 可用 `Get-FileHash -Algorithm SHA256` 对照校验。Actions 中间产物保存 7 天，完整汇总保存 14 天；公开 Release 附件不依赖这些临时 artifact。

## 本地验证

```powershell
python -m unittest discover -s scripts/release -p 'test_*.py' -v
actionlint .github/workflows/release.yml .github/workflows/desktop-client.yml
```

Windows 本地生成安装包时使用 `npm.cmd`，避免 PowerShell 的 npm 包装器吞掉参数：

```powershell
cd neutrino-proxy-client-app
npm.cmd run tauri -- icon src-tauri/icons/icon.png --output target/release-icons
npm.cmd run desktop:bundle -- --target x86_64-pc-windows-msvc --bundles nsis -- --locked
```

### 2026-10-15 本地实际结果

- `actionlint`：统一发布工作流及日常桌面工作流检查通过。
- Python 打包、版本、配置、压缩包权限、路径与发布失败保护回归测试 19 项通过，包括上传中断后的草稿恢复；测试使用模拟 GitHub API，不产生远程 Release。
- 旧后台使用临时 Node 20.19.5 执行 `npm ci --legacy-peer-deps` 与 `build:release` 成功。修复仅限 release 模式的构建完成退出，避免旧 webpack worker 保持进程不退出。
- 在独立验证目录注入版本、后台资源及发布配置后，`mvn verify` 成功；现有 Java 模块没有单元测试，此结果主要证明编译和打包。
- 生成并解压服务端、客户端 JAR 压缩包：服务端启动、H2 初始化、后台 HTML/JavaScript 与隧道监听通过；客户端本地认证握手通过。使用虚构 License 与临时数据目录。
- 本机 Azul JDK 21 在默认临时目录下出现 Windows Unix-domain selector 连接异常；本地上述 JAR 启动验证使用进程级 `JAVA_TOOL_OPTIONS=-Djdk.net.unixdomain.tmpdir=C:\Windows\Temp` 后通过。未把该机器路径写入发布脚本或 CI，未据此宣称 Windows GraalVM native 已验证。
- 本地 Windows NSIS 安装程序已生成，大小 3,037,752 字节；另生成便携 ZIP，未执行安装或覆盖现有客户端。此次本地构建保持源码 `0.1.0` 版本，用于验证 bundler 路径；实际 tag 构建会自动注入 tag 版本。
- 桌面组件测试 7 项、Edge 浏览器流程 6 项、Rust workspace 测试 12 项、Rust 格式检查及 Clippy（警告视为错误）通过。

Solon 2.7 的外部配置路径在含空格目录下存在既有读取差异，Java 分发包当前应解压至不含空格的目录；本轮已分别测试启动脚本的空格路径/参数处理，但不能把脚本测试等同于旧框架的完整路径兼容性。

本机没有执行 Linux/macOS 原生构建、GraalVM native 编译、App 安装及 macOS 原生窗口验证，也没有执行真实 GitHub 上传或公开。本地脚本回归测试与 YAML 检查不代替全平台 CI 或完整产品验收；尚未创建、推送 tag。

### v2.0.3 首次远端构建与修正

用户随后明确授权提交、推送及构建 `v2.0.3`。首次提交为 `9f12f375`，对应 [Actions 运行](https://github.com/ynx-official/neutrino-proxy/actions/runs/38687780250)。JAR、Linux native、Apple Silicon App 构建通过；Windows native 的服务端启动、后台资源及隧道检查通过，随后因刚退出的 exe 暂时仍被系统占用而清理失败。Windows App 的旧浏览器测试仍要求已经移除的提示文案，也未通过，因此没有公开 Release。

修正保留全部业务验证：临时目录清理在 `PermissionError` 时最多等待约 6 秒，持续失败仍终止构建；浏览器用服务器地址、连接时长、点击断开后的状态及重新连接入口验证替代过时文案。新增临时占用及持续占用回归测试，本地 21 项发布脚本测试和提交版本的 4 项浏览器流程通过。由于版本尚未公开，仅将本次新建的 tag 更新到修复提交后重建；使用旧 tag 对象的 lease 防止覆盖其他人随后更新的引用。

### v2.0.3 正式发布结果

2026-10-15 14:07（Asia/Shanghai）已自动公开 [v2.0.3 正式 Release](https://github.com/ynx-official/neutrino-proxy/releases/tag/v2.0.3)，`draft=false`、`prerelease=false`。tag 指向修复提交 `11618d4576424310ffebca96e177a6e47cad43c8`；[完整构建运行](https://github.com/ynx-official/neutrino-proxy/actions/runs/38689021698)所有作业成功。

- 服务端及命令行客户端：JAR、Linux x64 native、Windows x64 native 均构建、打包、解压并通过临时 H2 / 管理后台资源 / 本地认证握手检查；Windows 退出后的文件释放与清理验证通过。
- 桌面 App：Windows x64 NSIS 与便携 ZIP、Intel macOS DMG、Apple Silicon macOS DMG 全部生成；组件测试、Rust workspace 测试与静态检查通过，Windows 浏览器回归通过。
- Release 共有 12 个附件：10 个分发文件、`release-manifest.json` 和 `SHA256SUMS`。上传时逐个比对 GitHub 返回的 SHA-256 digest 与本地文件，全部一致后自动公开，无人工批准步骤。
- 未配置开发者签名证书或公证。远端构建成功不等同于已执行安装、macOS 原生窗口检查、长期稳定性或生产环境兼容验收。
- 本次发布只提交发版流程、必要配置和上述验证修正；工作区中另一次未提交的界面调整未加入此 tag，予以保留。

## 官方依据

- [GitHub Actions 工作流与 tag 过滤](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [GitHub 托管 runner 与 macOS 架构](https://docs.github.com/en/actions/reference/runners/github-hosted-runners)
- [GitHub Release 附件 API 与 SHA-256 digest](https://docs.github.com/en/rest/releases/assets)
- [Tauri GitHub 构建](https://v2.tauri.app/distribute/pipelines/github/)、[分发与签名](https://v2.tauri.app/distribute/)
- [node-sass 9 / Node 20 兼容表](https://github.com/sass/node-sass#node-version-support-policy)
