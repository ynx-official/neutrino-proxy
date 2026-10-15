# 桌面客户端开发进展与验证记录

状态：Review  
最后更新：2026-10-15  
关联文档：[总体方案](../00-project/client-app-proposal.md)、[界面设计](../02-design/client-app-ui.md)、[架构设计](../03-architecture/client-app-architecture.md)、[完整验收计划](../04-quality/client-app-acceptance.md)、[本地运行](../05-operations/client-app-local-development.md)

## 2026-10-15 项目 Logo 图标与目录清理（当前）

用户指定 `assets/logo/logo.png` 为图标来源，授权加工适配 Windows / macOS，同时明确删除根目录 `.idea`、`.workflow`。本轮以原蓝橙标识制作浅色圆角底座母版，导出 `.ico` / `.icns` / PNG，更新默认窗口、托盘、页面品牌及发布流水线的图标来源。原 Logo 文件保持不变；页面使用逐字节副本，托盘使用直接从原图等比导出的透明小图，连接状态角标预生成并缓存。

目录清理：原生 PowerShell 的直接递归删除被自动审批以 `blocked by policy` 拦截。核对两个绝对路径均在项目根目录、不是重解析点且没有嵌套链接后，改用可恢复的系统回收站删除，调用成功；两个目录均已不存在。Git 记录对应 `.idea/icon.png` 和 `.workflow/pipeline-docs-build.yml` 的删除，`.github/workflows` 保留。未清理其他工作区修改。

已验证：

- Tauri CLI 实际导出成功；PNG 母版 1254 × 1254、运行时 PNG 512 × 512、托盘 PNG 64 × 64，均为 RGBA；ICO 含 16 / 24 / 32 / 48 / 64 / 256 图层；ICNS 含 `ic10` 1024 图层，各块长度有效。
- `npm test`：13 项通过；`npm run test:e2e`：8 个流程通过；浏览器中实际检查主页面与托盘的新 Logo，[连接页](../04-quality/assets/client-app-project-logo-connected.png)、[托盘](../04-quality/assets/client-app-project-logo-tray.png)使用开发 IPC 测试替身。
- `cargo test --workspace`：15 项通过；Rust Clippy 通过。
- `python -m unittest discover -s scripts/release -p test_release.py`：9 项中 8 项通过、1 项按原条件跳过。

Windows Release 构建通过：`neutrino-proxy-client-app/target/ui-refresh/release/neutrino-proxy-client-app.exe`，12064768 字节，SHA-256：`cb41a7ae9202d7ccaff8a8f923d8046b2372861bc9b7fff4ef8ff44e0896156c`。核对 ICO 的六个图层字节均存在于 EXE 资源，确认已嵌入新图标。

当前程序在常规 `target/release` 路径运行，本轮使用 `target/ui-refresh` 构建，不退出或覆盖正在运行的实例。未启动新的原生 UI 测试；上一轮托盘 Windows 交互复验与 macOS 原生验证的待办仍保留，不能用本轮图标导出代替它们。

## 2026-10-15 托盘浮层实现

用户已明确批准[托盘样图](../02-design/assets/client-app-tray-preview.png)。已替换旧的静态原生菜单：新增按需创建的本地 Vue 浮层，显示应用名、真实连接状态及服务器；提供打开主窗口、查看日志、随状态切换的单一连接动作与独立退出项。连接中可取消，等待重连可停止，断开中禁用操作；宿主复查状态，拒绝过时的相反动作。未配置时连接入口跳转设置。托盘图标角标及悬停文字随状态更新。

主窗口和托盘分别接收对应事件；托盘摘要不包含日志或凭证。主窗口导航使用待消费路径，在窗口重建后也能打开日志；已有页面仍通过 Router guard 确认未保存修改。浮层失焦、Escape 或操作完成后销毁，不保留隐藏的托盘 WebView。未修改服务端、Rust 网络协议或用户保存的连接配置，未自动提交或发布。

已执行：

- `npm test`：13 个测试通过，新增托盘互斥动作、实时更新、初始化快照竞态、断开禁用、重复点击和失败反馈覆盖。新增组件在尚未实现时测试失败，接入后通过。
- `cargo test --workspace`：15 个测试通过，其中托盘宿主 3 个，原内核 12 个；覆盖状态与过时动作、实际活动地址、摘要脱敏、屏幕工作区和缩放坐标计算。
- `npm run test:e2e`：8 个流程通过，新增 288 × 342 浮层的两种状态、无溢出、动作分发、Escape 与未保存编辑确认。数据来自开发 IPC 替身，见[已连接](../04-quality/assets/client-app-tray-connected.png)、[未连接](../04-quality/assets/client-app-tray-idle.png)。
- `cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `npm run build`：主窗口与托盘两个入口构建通过；产物未包含开发 IPC 测试桥接。

Windows 原生验证边界：使用独立应用标识与虚构本机地址，实际打开主窗口和未连接托盘，确认布局、状态、地址与四个操作显示。首次交互暴露窗口卡顿；检查本地 Tauri 2.12.4 文档后，按其 Windows 已知问题说明将同步原生事件回调中的 WebView 创建移入既有阻塞任务池，并串行化托盘创建请求；失焦销毁另改为离开回调后执行。自动化检查和编译不能代替原生复验。随后用户按物理 Escape 停止 Computer Use，已停止全部原生 UI 操作并结束本轮测试实例。**修复后的失焦、Escape、窗口恢复、连接/断开及退出原生流程尚未复验，不得视为原生交互验收通过。**

Windows Release 构建成功，程序：`neutrino-proxy-client-app/target/release/neutrino-proxy-client-app.exe`；大小 11994624 字节，SHA-256：`d1dce09a00ef354d4ff9d2a08b16ec9f92062c70f4feea67a3865425bb9a6476`。确认 Release 中不包含 `--preview-tray` 调试入口。没有自动启动新版或替换正在运行的日常实例。

调试构建的单实例入口接受 `--preview-tray` 以调用真实浮层创建路径，便于在无法自动化系统任务栏时验证界面；该调试入口通过条件编译从 Release 中移除。macOS 原生测试和长期内存测量未执行。

## 2026-10-15 默认窗口与托盘预览

用户要求默认使用原最小窗口尺寸。本轮将主窗口配置设为 860 × 620，最小尺寸维持 860 × 620；托盘恢复窗口改为复用同一窗口配置，避免关闭后重建又变回 1040 × 720。窗口配置回归先在旧尺寸失败，再在修改后通过，`npm test` 共 9 个测试通过。Windows Release 构建通过，新程序为 `neutrino-proxy-client-app/target/release/neutrino-proxy-client-app.exe`；大小 11918848 字节，SHA-256 为 `70d2e53a2c8e022c2d332ef714e0bb82c84a32b9200e6f92d50812e67cfbcd81`。当前运行程序未被重启。

托盘本轮交付为[设计预览](../02-design/client-app-ui.md)，展示已连接与未连接的互斥操作；尚未改变实际托盘菜单，避免把生图当成已实现功能。当前运行中的连接保留。

## 2026-10-15 首页事件数量调整

按用户要求，首页最近事件由五条改为仅显示最新三条；新事件到达后自动更新这三条，不修改原日志数组或日志页查看范围。回归用例已先在五条实现下失败，再在修改后通过；`npm test` 共 8 个测试通过，生产前端构建通过。Windows Release 已构建通过，更新程序为 `neutrino-proxy-client-app/target/ui-refresh/release/neutrino-proxy-client-app.exe`；大小 11920896 字节，SHA-256 为 `ba42f724659405fc2819103b4fc5a825e1a1ae5ba5bd06acb1394234a23fd49c`。当前运行中的旧程序未被替换或重启，退出托盘后打开这个更新程序即可应用三条事件上限。

## 2026-10-15 简约样图落地

用户已明确确认[简约样图](../02-design/assets/client-app-minimal-approved.png)，本轮将连接、设置和日志统一为顶部导航、白色画布、细分隔线与无卡片布局，删除旧侧栏、色块和装饰。页面真实状态、错误、重连操作、凭证保留与保存生效语义继续使用现有逻辑。根目录 AGENTS.md 与[界面设计](../02-design/client-app-ui.md)已同步视觉基线，旧色块设计归档。

- `npm test`：7 个组件测试通过。
- `npm run test:e2e`：6 个浏览器流程通过；新增水平导航与三页可达检查，旧侧栏稳定失败后在新布局通过。小窗口检查另复现保存栏遮挡高级入口，增加实际命中区域回归并收紧小窗口间距。
- `npm run build`：生产前端构建通过，确认产物不包含开发 IPC 测试桥接入口。
- Windows Release：简约版构建通过，独立输出为 `neutrino-proxy-client-app/target/ui-refresh/Neutrino-Proxy.exe`；大小 11920896 字节，SHA-256 为 `5ceb2b7cfb36161abb5edef036b7c3798dc89c5816385a1ea66e064d21c8443c`。
- Windows 原生预览：已实际打开独立标识的简约预览，检查连接、设置和日志三页、顶部导航及基础控件。预览使用空配置，没有连接真实服务器或修改用户配置；检查后已关闭，仅保留原有正在运行的客户端。

[原生设置页截图](../04-quality/assets/client-app-minimal-windows.jpg)。已连接状态与日志筛选使用浏览器 IPC 测试替身验证，本轮不把样例数据视为真实服务器认证结果。
- 旧版当前正在保持连接；构建使用独立输出目录，未退出旧进程、未修改用户配置或凭证。

## 上一轮色块方案（已替代）

用户反馈旧界面缺少设计感、说明文字过多。本轮已重做导航、连接状态面板、设置表单和日志列表：采用奶油色导航与深绿状态面板，收紧字级和间距，删除常驻教程与重复说明，保留错误、未保存和配置生效时间等必要反馈。网络内核及配置含义不变。当前视觉基线和实际页面截图见[界面设计](../02-design/client-app-ui.md)；原概念方案保存在[初稿归档](../99-archive/client-app-ui-initial.md)。

该轮验证记录：

- `npm test`：7 个组件测试通过，包括重连操作、活动配置与待应用配置的显示区分。
- `npm run test:e2e`：5 个 Edge 浏览器流程通过，覆盖首次配置、连接状态、日志筛选、860 × 620 小窗口与长地址、SSL 和高级设置。
- `npm run build`：生产前端构建通过；确认 Release 资源不包含开发测试桥接入口。
- Windows Release：原生构建通过，已将新版更新到原启动路径并实际打开。通过 computer-use 读取连接页、导航与设置页，确认原有配置和已保存凭证状态正确加载；本轮没有修改或保存用户连接参数。
- 本轮原生检查覆盖未连接页和设置页；已连接页面使用浏览器 IPC 替身核对。本轮未操作真实服务器连接，不把历史原生认证结果算作本轮验证。

新版启动路径：`neutrino-proxy-client-app/target/release/neutrino-proxy-client-app.exe`。同一构建另保留在 `target/ui-refresh/release/`。文件大小 11,924,992 字节，SHA-256：`5b19f36315198670309e02da63d6effc25a467044556516144ae0cec70abeda9`。本轮没有修改依赖、Rust 内核、配置结构或服务端代码。

以下保留初次可运行里程碑的测试与截图，不能将历史截图当成本轮页面。

## 初次可运行里程碑

用户本轮要求为“开始重写客户端，直到软件能打开，页面一致”。在独立的 `neutrino-proxy-client-app/` 中实现 Rust / Tokio 内核、Tauri 2 宿主和 Vue 3 页面，形成 Windows 可直接运行的开发版本。当前版本为 0.1.0，用户于 2026-10-15 授权将源代码提交至 [GitHub 仓库](https://github.com/ynx-official/neutrino-proxy)。Windows 构建产物保留在本地工作区，尚未正式发布。

这份记录只说明当前实现与已执行的验证。完整迁移方案中的旧证书兼容、全部非默认参数、长期资源测试、macOS 原生验收及安装包发布仍需后续完成。

## 已实现

| 部分 | 当前行为 |
|---|---|
| 桌面程序 | Windows 原生 exe，内嵌前端资源；启动不依赖 Vite、命令行窗口或 Java |
| 页面 | 按 `airtable` 样图实现连接、日志、设置三页；浅色导航、连接摘要、最近事件、基础表单和高级折叠区 |
| 配置 | 地址、端口、License、SSL、证书、客户端 ID、重连间隔、心跳、读超时、UDP 范围；Rust 再次校验输入 |
| 本地持久化 | 原子替换普通配置文件；License 和 JKS 密码使用系统安全存储；界面只接收掩码摘要 |
| 通信内核 | 原有二进制帧格式、认证、心跳、读超时、网络重连、认证失败停止、手动断开和取消；TCP / UDP 双向转发 |
| 资源边界 | 共享 2 个异步工作线程，阻塞任务池最多 4 个线程；连接任务、日志和事件有界，数据包不推送到前端 |
| 桌面生命周期 | 单实例；关窗销毁 WebView、Rust 保持运行；重复打开 exe 恢复窗口和状态；托盘提供连接、断开及退出入口 |
| 日志 | 当前会话脱敏日志、筛选、暂停视图更新、导出；当前内存最多 500 条、单条最多 512 字符 |
| 导入 | YAML 脱敏预览并显式确认；读取基本连接配置与部分高级参数，不修改原文件；已知不支持的协议参数阻止应用 |
| 开发基础 | npm / Cargo 锁文件、组件与浏览器测试、Rust 测试和 Clippy、Windows/macOS CI 工作流 |

## 初次里程碑已执行的验证

| 检查 | 本机结果 | 覆盖与限制 |
|---|---|---|
| `cargo test -p neutrino-client-core` | 12 个测试通过 | 原字节格式、半包、Unicode / 二进制、异常长度、配置错误、内置 JKS 读取、短凭证掩码、认证与取消、TCP / UDP 回传 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 | Rust 静态检查，不等同于网络兼容性或内存测试 |
| `cargo fmt --all --check` | 通过 | Rust 格式检查 |
| `npm test` | 5 个测试通过 | 首次配置校验、保持已存凭证、异步加载配置、初始状态、断开操作 |
| `npm run test:e2e` | 4 个流程通过 | 表单与导航、已连接信息层级和日志筛选、最小尺寸与长地址、默认配置页无需多余滚动；使用明确的 IPC 测试替身 |
| `npm run desktop:build` | Windows Release 构建成功 | 生成可直接运行的 exe；不是安装包签名或发布验收 |
| Windows 原生窗口 | 已实际打开并检查 | `computer-use` 读取真实窗口和控件；核对页面、表单、状态和导航 |
| 原生保存并连接 | 本地测试对端认证成功 | 从实际窗口填入虚构 License；确认状态由 Rust 认证结果驱动，配置文件不包含凭证明文 |
| 关窗和恢复 | 通过 | 关闭后窗口从原生窗口列表消失，Rust 进程及本地 TCP 连接仍在；重开 exe 保持同一进程、原连接及持续时间 |
| 整个程序重启 | 通过 | 保留连接参数与安全存储凭证，不自动连接；点击连接可再次认证成功 |

最小窗口回归测试曾复现保存按钮底部超出 620 像素，修正为固定可见的操作区后通过；默认窗口另有回归测试确认折叠状态的完整配置表单不产生多余滚动。断开与重连生命周期测试没有通过删除用例或跳过断言获得通过。认证帧固定向量依据所读 Java 编码代码构造，尚未建立完整的 Java 客户端对照矩阵。

本次原生测试对端仅监听 `127.0.0.1`，属于测试夹具，不是服务端产品改造。测试后已停止夹具，删除本次创建的测试配置与对应安全存储条目，让 App 回到未配置状态；没有使用真实 License 或连接生产服务。

## 初次里程碑运行截图

初次 Windows Release 已重新打开，停留在干净的配置页；完整基础表单在默认窗口内显示，没有多余滚动条：

![最终 Windows 原生配置页](../04-quality/assets/client-app-windows-setup.jpg)

初次里程碑 exe：`neutrino-proxy-client-app/target/release/neutrino-proxy-client-app.exe`，SHA-256 为 `906229aa3f098361c1dd69808bc7152240dadf448cb8e1216cfb478058695ac0`。

Windows 原生窗口通过本地测试对端认证后的状态：

![Windows 原生客户端已连接](../04-quality/assets/client-app-windows-connected.jpg)

截图中的地址、端口与凭证均为本机测试数据，与设计样图中的示例域名不同。运行截图证明页面和状态已在原生窗口中呈现，不能据此推导出真实服务兼容、吞吐或长期内存表现。

## 后续迁移与验收

- macOS 源码路径与 CI 已准备，但本机为 Windows，尚未执行 macOS 构建、菜单栏、窗口及系统安全存储验证；远程构建结果以 [GitHub Actions](https://github.com/ynx-official/neutrino-proxy/actions) 的实际运行记录为准。
- JKS 可直接读取，但当前 TLS 按证书链、有效期和服务器名称验证。旧 Java 行为差异仍需真实的脱敏证书矩阵验证，不提供忽略证书错误的开关。
- 当前未完整迁移自定义帧布局、水位线、全空闲超时和所有框架专用参数；不能宣称旧配置已经全部无损兼容。
- 当前不复用空闲数据隧道池；TCP / UDP 基础转发已验证，但池化、并发容量、慢连接压力、异常 UDP 回收和全部路由场景仍需扩大测试。
- 当前日志为内存记录与手动导出，退出后不会保留完整历史；尚未实现滚动日志文件和系统登录自动启动。
- 托盘退出当前直接结束连接，活动传输确认和更细的托盘状态操作仍需补齐。
- 未运行 72 小时稳定性、Java 对照基线、完整进程树内存和吞吐测试；不承诺固定 MB 占用或性能提升比例。
- 尚未生成安装程序、签名、公证、自动更新或正式发布。

## 下一阶段顺序

按[实施计划](client-app-implementation-plan.md)补全旧配置与 TLS 兼容测试、转发并发和资源回收，再执行双平台及长期运行验收。当前可运行里程碑的完成不代表全部阶段已经完成。
