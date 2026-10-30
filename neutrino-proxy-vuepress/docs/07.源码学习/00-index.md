---
title: "源码学习目录与学习路线"
date: 2026-10-30
permalink: /learn/
article: false
status: Review
updated: 2026-10-30
---

# 源码学习目录与学习路线

状态：Review · 最后更新：2026-10-30
关联文档：[文章写作与源码引用规范](/learn/authoring/)、[快速上手](/pages/793dcb/)、[既有实现原理](/pages/dd027d/)

如果你写过一阵 Java 接口，想找个项目把网络、协议和长连接串起来，我们就拿 Neutrino Proxy 一起拆。每次从一个小困惑出发，先猜猜它会怎么做，再去真实代码里找答案，最后做个小实验看看猜得对不对。不必先把所有术语背下来，碰到哪一个，我们就顺手讲哪一个。

## 当前进度与阅读方式

这里有 **12 个专题、60 篇章节**：Java 主线 56 篇，独立桌面客户端进阶 4 篇，现均已补成正文并标为 **Review**。每篇从一个具体问题开始，顺着真实调用链读代码，再留一个可以动手的小实验。Review 表示正文与源码已核对；哪些实验跑过、哪些还没跑，会在文中分清楚。

建议主线 12 周、每周 8～10 小时；Java 与网络基础按需补齐，桌面选修另加 2 周。当前工作经验来自其他语言时，可增加 Java 补课时间。周数是安排建议，验收结果决定是否进入下一阶段。

## 源码与知识边界

- 本仓库代码基线：`94cafdd1f36e1f64b316e10466a8f54912c75467`。后续正文若采用新代码，应同步更新该篇的来源与差异说明。
- 技术基线：Java 21、Solon 父 POM 2.7.6、Netty 4.1.100.Final、MyBatis-Plus、HikariCP，以及 H2/MySQL/MariaDB；以 POM 和实际调用为依据。
- 管理后台为既有 Vue 2 工程；文档目录保留 vuepress 名称，当前使用 VitePress。
- Java 客户端承担学习主线。Rust/Tokio、Tauri 2 与 Vue 3 桌面端位于独立仓库，作为进阶对照，选修节选固定在提交 `eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c`；本站构建不依赖相邻桌面检出。
- 学习实验使用本地目标、测试数据和虚构凭证，不使用真实 License 或生产连接信息。

## 12 周安排

| 阶段 | 专题 | 阶段产出 |
| --- | --- | --- |
| 第 1 周 | 项目导读 | 理解模块、端口与源码阅读方法 |
| 第 1 周按需补齐 | Java与Maven | 只补阅读当前项目需要的语言与工程知识 |
| 第 2 周 | Solon启动与API | 读懂应用组装、启动和 HTTP 边界 |
| 第 3 至 4 周 | 管理业务与数据 | 从数据模型贯通 API 和运行状态 |
| 第 5 周 | Netty基础 | 为真实代理链路补齐网络编程基础 |
| 第 6 周 | 协议与分发 | 逐字节理解帧结构和处理器路由 |
| 第 7 周 | 服务端TCP链路 | 追踪认证、建链、转发与关闭 |
| 第 8 至 9 周 | Java客户端设计 | 以实际 Java 实现为主线拆解客户端 |
| 第 10 周 | UDP与HTTP安全 | 扩展协议与识别传输边界 |
| 第 11 周 | 测试与稳定性 | 用可复现证据检验代理系统 |
| 第 12 周 | 构建与交付 | 理解从源码到可运行分发包 |
| 选修另加 2 周 | 桌面客户端进阶 | 对照独立仓库理解跨语言内核与宿主边界 |

## 详细文章目录

下面的链接都能打开，也都有正文。熟悉的基础部分可以跳过，遇到卡住的概念再回来补。先跟通一条正常链路，再带着失败场景回读，通常比一次记住全部类名更有收获。

### 01 项目导读

理解模块、端口与源码阅读方法。建议阶段：第 1 周。

- [01.01 项目全景与内网穿透边界](/learn/project-overview/)：业务场景与网络边界、模块依赖与运行进程、一条请求的参与者。
- [01.02 技术栈与依赖地图](/learn/technology-stack/)：父子 POM 与依赖管理、框架和组件职责、版本与源码核对方法。
- [01.03 本地调试与第一条 TCP 映射](/learn/local-debugging/)：开发环境与测试配置、最小目标服务、启动、断点与关闭顺序。
- [01.04 调用链阅读与断点记录方法](/learn/source-reading-method/)：模块与包名定位、事件回调和调用链、日志、断点及证据记录。

### 02 Java与Maven

只补阅读当前项目需要的语言与工程知识。建议阶段：第 1 周按需补齐。

- [02.01 接口 泛型 注解与消息分发](/learn/java-abstractions/)：Handler 接口与类型参数、Match 注解与反射、注册和查找边界。
- [02.02 并发容器 可见性与复合操作](/learn/java-concurrency/)：线程与共享状态、容器和队列、锁与复合操作。
- [02.03 字节 编码 异常与资源所有权](/learn/java-bytes-resources/)：整数和字节序、字符串编码、ByteBuf 与流的生命周期。
- [02.04 Maven 多模块 依赖与构建阶段](/learn/maven-modules/)：聚合与继承、dependencyManagement、插件阶段与 profile。

### 03 Solon启动与API

读懂应用组装、启动和 HTTP 边界。建议阶段：第 2 周。

- [03.01 从 main 到应用加载完成](/learn/solon-startup/)：Solon.start 入口、初始化与加载完成事件、服务监听与失败路径。
- [03.02 配置绑定 依赖注入与 Bean 组装](/learn/solon-injection/)：配置键与对象、Component 和 Configuration、具名 Bootstrap 与依赖方向。
- [03.03 HTTP 路由 参数与响应包装](/learn/solon-http-api/)：路由和方法映射、Req 与 Res、异常和响应转换。
- [03.04 登录上下文 拦截器与清理边界](/learn/solon-request-context/)：路由拦截顺序、SystemContextHolder、上下文生命周期。

### 04 管理业务与数据

从数据模型贯通 API 和运行状态。建议阶段：第 3 至 4 周。

- [04.01 用户 License 与映射数据模型](/learn/database-model/)：用户与 License、端口池和端口映射、域名、安全组与记录表。
- [04.02 数据源 Mapper 与数据库初始化](/learn/persistence-initialization/)：HikariCP 与驱动选择、Mapper 和 XML、建表、初始数据与升级脚本。
- [04.03 登录 Token 与资源权限](/learn/login-authorization/)：登录和 Token 生命周期、管理员限制、业务对象权限检查。
- [04.04 License 与端口池业务规则](/learn/license-port-pool/)：License 生命周期、端口池分配、客户端认证与运行状态。
- [04.05 端口映射 CRUD 完整纵向切片](/learn/port-mapping-crud/)：参数和业务规则、持久化操作、缓存及运行资源变更。
- [04.06 配置动态生效与运行状态一致性](/learn/runtime-consistency/)：数据库与内存映射、动态监听增删、失败、重试和补偿分析。

### 05 Netty基础

为真实代理链路补齐网络编程基础。建议阶段：第 5 周。

- [05.01 NIO Reactor 与 EventLoop 线程模型](/learn/netty-reactor/)：接入与工作线程、事件循环、阻塞调用的影响。
- [05.02 Bootstrap Channel 与异步 Future](/learn/netty-bootstrap/)：Bootstrap 配置、connect 和 bind、Future、回调和异常。
- [05.03 Pipeline 入站 出站与 Handler 生命周期](/learn/netty-pipeline/)：Pipeline 组装、入站与出站方向、事件传播与处理器生命周期。
- [05.04 ByteBuf 引用计数与释放责任](/learn/netty-bytebuf/)：读写索引、引用计数与派生缓冲、正常和异常释放路径。
- [05.05 写缓冲水位与 AUTO_READ 背压](/learn/netty-backpressure/)：高低水位、isWritable 和事件、双向读取控制。

### 06 协议与分发

逐字节理解帧结构和处理器路由。建议阶段：第 6 周。

- [06.01 ProxyMessage 帧结构与消息类型](/learn/protocol-frame/)：长度与字节序、消息字段、消息类型与使用方向。
- [06.02 编码器如何计算长度并写入字段](/learn/protocol-encoder/)：固定字段长度、可变字段字节数、字段写入顺序。
- [06.03 长度字段拆包与增量解码](/learn/protocol-decoder/)：五个拆包参数、固定头解析、最大帧和截断边界。
- [06.04 从消息类型到 Handler 的分发](/learn/protocol-dispatcher/)：注解注册、类型匹配、分发和未匹配行为。
- [06.05 协议边界与跨语言测试向量](/learn/protocol-boundary-tests/)：往返与固定向量、分片和多包、长度、编码和异常边界。

### 07 服务端TCP链路

追踪认证、建链、转发与关闭。建议阶段：第 7 周。

- [07.01 隧道监听与控制数据连接入口](/learn/server-tunnel/)：明文与 TLS 监听、公共处理链、消息路由入口。
- [07.02 License 认证与客户端绑定](/learn/server-authentication/)：认证报文解析、用户和 License 检查、在线状态与监听初始化。
- [07.03 映射监听与访问者连接管理](/learn/server-listeners/)：加载启用映射、监听与绑定关系、动态增删。
- [07.04 VisitorId 与数据通道绑定](/learn/server-connect-binding/)：生成 visitorId、CONNECT 往返、NEXT_CHANNEL 双向绑定。
- [07.05 请求响应的双向数据转发](/learn/server-transfer/)：请求封装、目标写入和响应、流量计数与背压。
- [07.06 断开 异常与连接关系清理](/learn/server-disconnection/)：访问者退出、控制连接退出、数据通道异常与解绑。

### 08 Java客户端设计

以实际 Java 实现为主线拆解客户端。建议阶段：第 8 至 9 周。

- [08.01 启动参数 配置优先级与 ClientId](/learn/client-configuration/)：命令行别名、配置校验、客户端身份来源。
- [08.02 控制会话与认证结果处理](/learn/client-session/)：控制连接创建、认证请求与响应、状态表达和失败路径。
- [08.03 内网目标连接与异步绑定](/learn/client-target-connection/)：目标解析、异步连接和失败、绑定与读取开关。
- [08.04 TCP 转发与多访问者隔离](/learn/client-forwarding/)：visitorId 映射、NEXT_CHANNEL、并发会话与数据方向。
- [08.05 读写空闲 心跳与超时语义](/learn/client-heartbeat/)：IdleStateHandler、心跳发送、各类空闲事件分支。
- [08.06 定时重连 可见性与并发边界](/learn/client-reconnection/)：调度器和间隔、连接状态判断、失败和重复触发分析。
- [08.07 通道池 连接关闭与资源所有权](/learn/client-pool-cleanup/)：借用和归还、实际关闭路径、缓存引用与所有者。
- [08.08 从现有回调整理客户端状态机](/learn/client-state-machine/)：状态和事件清单、资源不变量、精简客户端职责划分。

### 09 UDP与HTTP安全

扩展协议与识别传输边界。建议阶段：第 10 周。

- [09.01 UDP 封装 会话隔离与回包路径](/learn/udp-forwarding/)：数据报元信息、隧道与本地 UDP、会话隔离。
- [09.02 UDP 端口分配 响应次数与超时](/learn/udp-lifecycle/)：端口范围和分配、proxyResponses、proxyTimeoutMs 与回收。
- [09.03 HTTP 域名选择与首包转发](/learn/http-domain-routing/)：域名和映射缓存、首次请求、建链后释放暂存数据。
- [09.04 HTTPS 与隧道 TLS 的不同边界](/learn/tls-boundaries/)：HTTPS 入口、隧道 TLS、JKS、信任与握手策略。
- [09.05 安全组 访问规则与流量限制](/learn/security-rate-limiting/)：规则匹配、安全 Handler 顺序、限流和背压的关系。

### 10 测试与稳定性

用可复现证据检验代理系统。建议阶段：第 11 周。

- [10.01 单元 集成与真实网络测试分层](/learn/testing-strategy/)：协议单元测试、本地网络集成、业务与数据库约束。
- [10.02 连接故障矩阵与恢复验证](/learn/fault-matrix/)：故障注入位置、超时和错误结果、恢复与清理断言。
- [10.03 慢消费者 大文件与并发压力](/learn/slow-consumer-load/)：负载模型、延迟吞吐与缓冲、完整性和资源曲线。
- [10.04 线程 Channel 与内存排障](/learn/resource-diagnostics/)：日志关联、线程与 Socket 快照、引用计数和重复连接。
- [10.05 流量计数 定时汇总与数据清理](/learn/flow-jobs/)：计数入口、分钟到长期汇总、重启和重复执行风险。

### 11 构建与交付

理解从源码到可运行分发包。建议阶段：第 12 周。

- [11.01 多模块构建 胖 JAR 与启动验证](/learn/jar-build/)：模块构建顺序、资源和配置、隔离目录启动。
- [11.02 Solon AOT 与 Native Image 元数据](/learn/native-aot/)：可达性与反射注册、构建期和运行期、配置与资源。
- [11.03 glibc musl 与跨平台兼容边界](/learn/native-platforms/)：glibc 版本、musl 全静态、平台验收与限制。
- [11.04 CI 产物完整性 哈希与发布规则](/learn/release-integrity/)：构建矩阵、完整性和哈希、验证与正式发布边界。

### 12 桌面客户端进阶

对照独立仓库理解跨语言内核与宿主边界。建议阶段：选修另加 2 周。

- [12.01 Java 与 Rust 的协议兼容](/learn/desktop-protocol/)：字段和编码对应、Java 测试向量、错误与边界语义。
- [12.02 Netty 到 Tokio 的异步内核映射](/learn/desktop-async-core/)：会话任务、双向缓冲与背压、取消和资源所有权。
- [12.03 通信内核 Tauri 与 Vue 的职责边界](/learn/desktop-host-ui/)：IPC 命令与事件、宿主和托盘、内核与 UI 生命周期。
- [12.04 配置导入 凭证存储与诊断日志](/learn/desktop-storage/)：配置版本和导入、系统凭证存储、日志脱敏与兼容验证。

<span id="逐篇完善顺序"></span>

## 第一次读，推荐这样走

先读 01.01 项目全景、01.02 技术栈、01.03 本地调试和 01.04 阅读方法，再进入 Solon 启动与端口映射这条纵向链路。第 02 专题按需补课。跟完 Netty、协议和服务端 TCP，再集中读第 08 专题的八篇 Java 客户端课程；最后用测试、交付和桌面对照检查自己的理解。

每篇遵循“问题 → 必要概念 → 项目代码节选 → 调用链与取舍 → 本地实验 → 复习与验收”的顺序，具体要求见[文章写作与源码引用规范](/learn/authoring/)。
