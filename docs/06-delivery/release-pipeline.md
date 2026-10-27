# 服务端与命令行客户端发布

状态：Review
最后更新：2026-10-27

关联文档：[文档索引](../README.md)、[Linux 兼容性](../05-operations/linux-native-compatibility.md)、[历史统一发布](../99-archive/unified-release-pipeline.md)、[独立桌面仓库](https://github.com/ynx-official/neutrino-proxy-client-desktop)

## 拆分后的范围

2026-10-27 按用户要求将桌面客户端完整迁至独立仓库。主仓库只构建服务端、Java 命令行客户端和内嵌管理后台；不依赖桌面代码、Rust/npm 桌面版本注入或桌面构建结果。历史统一发布的产物与执行记录保留在归档，已公开 Release 不修改。

## 工作流与版本

`ci.yml` 在分支提交、PR、手动触发时验证 Maven 工程，并在 Windows/Linux 执行发布脚本测试。`release.yml` 支持 v* tag 和手动选择已有 tag；先校验版本、解析实际提交，后续作业全部检出该 SHA。

主仓库 tag 只注入 Maven revision、服务端和命令行客户端的应用版本；管理后台依旧使用 Node 20.19.5、npm 锁文件和 production 同源 API。Java 构建使用 JDK 21，native 使用 GraalVM 21.0.2。桌面仓库的 package.json、Cargo.lock、Tauri 和 tag 独立维护。

## 必需产物

每版必须有八份分发 ZIP，示例 2.1.0，另附 SHA256SUMS 与 release-manifest.json，共十个公开附件。

| 平台/形式 | 服务端 | 命令行客户端 |
|---|---|---|
| Java 21 | neutrino-proxy-server-2.1.0-jdk21.zip | neutrino-proxy-client-2.1.0-jdk21.zip |
| Linux x64 glibc native | neutrino-proxy-server-2.1.0-linux-x64-native.zip | neutrino-proxy-client-2.1.0-linux-x64-native.zip |
| Linux x64 musl 全静态 | neutrino-proxy-server-2.1.0-linux-x64-musl-static.zip | neutrino-proxy-client-2.1.0-linux-x64-musl-static.zip |
| Windows x64 native | neutrino-proxy-server-2.1.0-windows-x64-native.zip | neutrino-proxy-client-2.1.0-windows-x64-native.zip |

ZIP 包含可执行文件/JAR、构建后完整 app.yml、适用平台的启动脚本及 LICENSE。服务端包含一次构建并复用的管理后台；不使用含空协议分组的旧 app-copy.yml 作为完整分发配置。

Linux glibc native 不适用于 glibc 2.17。musl 作业保留 --static、--libc=musl、-march=compatibility，以及最终包内 ELF 的架构、INTERP、DT_NEEDED、GLIBC 版本依赖检查；静态检查始终必需，不受 skip_tests 影响。CentOS 7 容器共享 runner 内核，不能作为 Linux 3.10 实机验收。

## 发布顺序与保护

1. prepare：校验 tag、解析固定提交并运行发布脚本回归。
2. admin：构建管理后台，上传临时 artifact。
3. java：分别构建 JAR、Linux glibc、Linux musl、Windows native；打包并执行相应启动/协议冒烟，musl 验证全静态与容器用户态。
4. publish：只等待 prepare 和 java，汇总八个分发包，校验准确清单、非空文件、静态链接证据和哈希，生成 manifest 与校验和。
5. 上传前再次校验版本、提交、远程 tag 和文件哈希；上传到内部草稿并逐一核对 GitHub digest，全部完成后自动公开正式 Release。只有该作业有 contents:write。

上传中断不公开半套产物，只恢复同提交、本工具创建的草稿；已公开 Release 不覆盖。主仓库保留现有正式发布规则，带预发布标识的有效 tag 也按原规则发布为正式版本；独立桌面仓库按自身文档处理 prerelease。

## 使用与验证

推送 v* tag 自动构建并发布。手动 Release 默认 publish=false，只构建；publish、skip_tests 必须在当次输入中明确选择。skip_tests 默认关闭，manifest 记录实际选择；构建、静态 ELF、准确产物、哈希和 tag 校验不跳过。

以下只是维护命令，不代表本次已提交或发布：

```sh
python -m unittest discover -s scripts/release -p 'test_*.py' -v
mvn -B -ntp test
```

本轮发布回归在 Windows 执行 26 项，25 项通过、1 项因无 POSIX shell 跳过；Linux CI 保留该用例。Maven reactor 的 test 命令成功，当前 Java 模块没有测试源码，不能据此声称 Java 单测覆盖。两份 Actions YAML 通过 actionlint。完整 native 打包、Linux 容器和远端 Actions 未在本次拆分中运行。

工作流使用 GitHub 内置 GITHUB_TOKEN，无额外 PAT；本次未提交、推送、创建 tag 或发布。历史授权和结果见[归档](../99-archive/unified-release-pipeline.md)。
