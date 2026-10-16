# 桌面客户端本地开发与运行

状态：Review  
最后更新：2026-10-16

关联文档：[开发进展](../06-delivery/client-app-development-status.md)、[实施计划](../06-delivery/client-app-implementation-plan.md)、[界面设计](../02-design/client-app-ui.md)

## 运行已构建的 Windows 程序

本地 Windows 开发构建默认输出 `neutrino-proxy-client-app/target/release/neutrino-proxy-client-app.exe`，包含前端资源，不需要先启动 Vite，也不依赖 Java。当前修订、构建结果及文件哈希以[开发进展](../06-delivery/client-app-development-status.md)为准。

切换到本地修正版时，先从托盘退出正在运行的旧版，再打开新程序并连接。仅关闭主窗口会保留旧进程，单实例机制会恢复旧进程的界面。构建本身不会退出已安装的客户端或修改其配置。

本轮托盘浮层的自动化检查和 Windows 构建已通过；原生交互复验在用户按 Escape 停止后保留待验，完整边界见[开发进展](../06-delivery/client-app-development-status.md)。

第一次打开不会自动连接。进入“设置”，填写服务器地址、对应的隧道端口和 License，选择是否启用 SSL，然后“保存并连接”。填写真实连接信息前，请确认服务器及 License 的使用权限；开发验证使用本地测试对端和虚构凭证。

关闭窗口后应用仍在托盘运行，再次打开同一个 exe 会恢复主窗口。单击或右击托盘图标打开浮层，可查看状态和服务器、打开主窗口或日志，并按状态连接、取消、停止重连或断开。Escape 或点击外部关闭浮层；完全结束应用使用“退出应用”。重新构建 exe 前先退出测试实例，避免 Windows 文件占用导致替换失败。

## 开发环境

在 `neutrino-proxy-client-app/` 目录执行命令。需要 Node 22.12+（CI 使用 Node 22 的当前维护版本）、npm、Rust stable；Windows 还需要 C++ Build Tools 和 WebView2。macOS 需要 Xcode Command Line Tools。

首次安装依赖：

```powershell
npm ci
```

启动桌面开发窗口：

```powershell
npm run desktop:dev
```

编译包含前端的原生可执行程序：

```powershell
npm run desktop:build
```

此命令暂不生成安装程序，也不执行签名、公证或发布。Windows 输出 exe；macOS 的原生构建与运行结果必须在 macOS 环境验证。

## 验证命令

```powershell
npm test
npm run build
cargo test --workspace
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
npm run test:e2e
```

浏览器流程测试使用本机 Edge，并由 Playwright 临时启动 Vite；结束后自动关闭服务器。测试替身仅在开发构建允许注入，Release 构建不能通过浏览器测试标志伪造连接状态。浏览器截图不替代桌面窗口验证。

本机首次 npm 10.9 安装出现依赖解析错误，随后用临时运行的 npm 11.6.2 完成安装；Vue 固定为 3.5.22，避免仓库返回不完整的新版本依赖。没有修改全局 npm。其他环境优先使用锁文件执行 `npm ci`。

## 配置与凭证

普通配置写入 Tauri 的应用配置目录；Windows 通常为 `%APPDATA%/fun.neutrino.proxy.desktop/config.json`。License 与 JKS 密码写入系统安全存储，JSON 中只有凭证引用。系统安全存储失败时，保存操作返回错误，不降级为明文保存。

导入 YAML 会先显示脱敏预览，用户确认后才保存且不会自动连接。旧官方 `neutrino.proxy.client` 与新版 `neutrino.proxy.tunnel` 均可导入，兼容嵌套及点分键。预览只显示本次文件实际读取的字段，不把本机保留值显示为已导入。只将有效且支持的字段合并到现有配置；缺少 `neutrino.proxy.tunnel` 等分组、字段为空或无效时跳过，已有地址和 License 等值保留。首次使用可先导入部分字段，之后在设置中补齐必填信息再连接。无可用字段仅提示“未发现可导入的配置”，不报缺失分组错误。自定义协议帧参数、水位线或全空闲超时等暂不支持项列为已跳过，其他字段继续导入；这不代表全部旧配置已兼容。格式无效、文件不可读和超过 1 MiB 仍返回错误。

SSL 会校验证书链、有效期与服务器名称。旧 Java 客户端未显式启用名称验证，部分旧证书可能无法直接使用；当前不提供忽略证书错误的开关，兼容差异仍需专项验证。

## 图标资源维护

原 Logo 位于 `assets/logo/logo.png`（仓库根目录）；窗口及托盘浮层使用它的副本，托盘使用等比透明小图。桌面图标母版为 `src-tauri/icons/app-icon.png`（App 目录），平台资源通过现有 CLI 导出：

```powershell
npm run tauri -- icon src-tauri/icons/app-icon.png --output target/release-icons
```

发布流水线使用相同母版和命令；日常构建直接读取已保存的 `.ico`、`.icns` 和 `.png`。本轮未更改安装签名、发布授权或实际发布版本。
