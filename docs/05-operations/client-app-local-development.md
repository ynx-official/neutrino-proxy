# 桌面客户端本地开发与运行

状态：Review  
最后更新：2026-10-15  
关联文档：[开发进展](../06-delivery/client-app-development-status.md)、[实施计划](../06-delivery/client-app-implementation-plan.md)、[界面设计](../02-design/client-app-ui.md)

## 运行已构建的 Windows 程序

本机构建输出位于 `neutrino-proxy-client-app/target/release/neutrino-proxy-client-app.exe`。可直接打开该文件；它已经包含前端资源，不需要先启动 Vite，也不依赖 Java。

第一次打开不会自动连接。进入“设置”，填写服务器地址、对应的隧道端口和 License，选择是否启用 SSL，然后“保存并连接”。填写真实连接信息前，请确认服务器及 License 的使用权限；开发验证使用本地测试对端和虚构凭证。

关闭窗口后应用仍在托盘运行，再次打开同一个 exe 会恢复主窗口。完全结束应用使用托盘菜单的“退出应用”。重新构建 exe 前先退出测试实例，避免 Windows 文件占用导致替换失败。

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
cargo test -p neutrino-client-core
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
npm run test:e2e
```

浏览器流程测试使用本机 Edge，并由 Playwright 临时启动 Vite；结束后自动关闭服务器。测试替身仅在开发构建允许注入，Release 构建不能通过浏览器测试标志伪造连接状态。浏览器截图不替代桌面窗口验证。

本机首次 npm 10.9 安装出现依赖解析错误，随后用临时运行的 npm 11.6.2 完成安装；Vue 固定为 3.5.22，避免仓库返回不完整的新版本依赖。没有修改全局 npm。其他环境优先使用锁文件执行 `npm ci`。

## 配置与凭证

普通配置写入 Tauri 的应用配置目录；Windows 通常为 `%APPDATA%/fun.neutrino.proxy.desktop/config.json`。License 与 JKS 密码写入系统安全存储，JSON 中只有凭证引用。系统安全存储失败时，保存操作返回错误，不降级为明文保存。

导入 YAML 会先显示脱敏预览，用户确认后才保存。自定义协议帧参数、水位线或全空闲超时尚未完整迁移时，导入明确拒绝应用这些配置；不能把导入基本字段成功等同于全部配置已兼容。

SSL 会校验证书链、有效期与服务器名称。旧 Java 客户端未显式启用名称验证，部分旧证书可能无法直接使用；当前不提供忽略证书错误的开关，兼容差异仍需专项验证。
