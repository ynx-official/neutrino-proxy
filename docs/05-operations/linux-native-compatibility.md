# Linux 原生包兼容性

状态：Approved（方案已授权；运行兼容性以实际验证证据为准）

最后更新：2026-10-16

关联文档：[发版构建流](../06-delivery/release-pipeline.md)、[文档索引](../README.md)

## 已知环境与原因

用户报告的目标环境为 CentOS 7.9.2009、内核 `3.10.0-1160`、glibc `2.17`。`v2.0.6` 普通 Linux native 报 `GLIBC_2.32` / `GLIBC_2.34` 缺失，尚未在本次会话连接该机器独立复验。已确认发布流水线使用 Ubuntu 22.04 动态链接构建，不能将这个产物视为 glibc 2.17 兼容包。

本次通过新增分发方式处理，不替换目标机器的 `/lib64/libc.so.6`，不修改运行中的服务或生产配置。

## 分发文件选择

| 文件后缀 | 运行条件与用途 |
|---|---|
| `linux-x64-native.zip` | 既有 glibc 动态链接包，Ubuntu 22.04 构建；不适用于上述 CentOS 7 主机 |
| `linux-x64-musl-static.zip` | 从 `v2.0.7` 起新增，musl 全静态 x86_64 二进制；不依赖目标系统 glibc，旧内核功能仍须实测 |
| `jdk21.zip` | Java 21 JAR；只有所用 Java 21 本身兼容目标 glibc / 内核时才是可行替代 |

服务端和现有命令行客户端均提供上述三个分发方向。Windows / macOS 桌面 App 的构建方式不受 Linux libc 选择影响。

以服务端 `v2.0.7` 为例，新包名为 `neutrino-proxy-server-2.0.7-linux-x64-musl-static.zip`，目录同名（去掉 `.zip`）；目录中包含二进制、`app.yml`、`start.sh` 和许可证。下载后先用 Release 的 `SHA256SUMS` 校验，再解压并运行包内 `./start.sh`。升级实际服务前应保留原配置、证书及数据库 / 数据目录，按既有部署方式迁移；本次发版不自动操作生产主机。

## 构建与强制门禁

Linux 单独启用官方 GraalVM Action 的 `native-image-musl=true`，现有 GraalVM Community 21.0.2 与 Maven `native` profile 保留；附加 `native-musl` profile 设置：

```text
--static --libc=musl -march=compatibility
```

必须使用 musl 全静态链接；`StaticExecutableWithDynamicLibC` 仍依赖系统 libc，不作为兼容方案。CPU 使用 GraalVM 的兼容目标，避免按构建 runner 的指令集优化。

`scripts/release/linux_compatibility.py --mode inspect --tag v2.0.7` 检查最终 ZIP 解压后的 ELF，要求 ELF64 / x86_64、无动态加载器、无共享库依赖、无 GLIBC 版本依赖。证据包含 ZIP 与 ELF 哈希，进入 `release-manifest.json` 的 `linux_compatibility`；汇总及发布前再次核对 ZIP 哈希。静态检查失败不得改名或退回 glibc 包发布，`skip_tests=true` 也不跳过该门禁。

## 运行检查及证据边界

默认测试流程使用固定镜像 `docker.io/library/centos:7@sha256:dead07b4d8ed7e29e98de0f4504d87e8880d4347859d839686a31da35a3b532f`，先检查其 glibc 为 2.17，再运行包内启动脚本，复用临时 H2、管理后台 HTML / JS、隧道监听和虚构本地认证对端检查。不接触真实数据库或 License。镜像来自 Docker Library 官方 CentOS 7 Linux AMD64 manifest；固定 digest 避免标签漂移。

容器共享宿主机内核。因此容器通过只能证明旧用户态下上述流程可运行，不能证明 Linux 3.10 内核兼容。还需在已授权的 3.10 实机或完整虚拟机上，使用校验过的相同分发文件复验：启动与日志、数据库驱动、SSL 握手、TCP / UDP 实际转发、连接退出与重连。真实服务与测试夹具须分开，并保留运行版本、系统信息及结果。

`v2.0.7` 按用户指令跳过所有运行与回归测试：`centos7_container=skipped_by_request`，`kernel_3_10=not_verified`，`tls_and_full_proxy_matrix=not_verified`。静态链接检查与发布哈希校验不属于功能验收，不能据此宣称目标机器已运行成功。以后普通 tag 发布恢复默认测试，不延续本次例外。

## 官方依据

- [GraalVM 静态链接说明](https://www.graalvm.org/jdk21/reference-manual/native-image/guides/build-static-executables/)
- [GraalVM GitHub Action](https://github.com/graalvm/setup-graalvm)
