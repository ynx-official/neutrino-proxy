---
title: "01.01 项目全景与内网穿透边界"
date: 2026-10-30
permalink: /learn/project-overview/
article: false
status: Review
updated: 2026-10-30
lesson: "01.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "pom.xml"
    symbol: "<modules>"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "ProxyClientService"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    symbol: "VisitorChannelService"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "TcpVisitorChannelHandler"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "ProxyMessageConnectHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    symbol: "ProxyMessageConnectHandler"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java"
    symbol: "ProxyMessageTransferHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageDisconnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java"
    symbol: "buildTransferMessage"
sourceExcerpts:
  - path: "pom.xml"
    startLine: 19
    endLine: 23
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 93
    endLine: 103
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 59
    endLine: 66
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 101
    endLine: 106
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 54
    endLine: 64
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    startLine: 83
    endLine: 89
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 67
    endLine: 75
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java"
    startLine: 23
    endLine: 32
---

# 01.01 项目全景与内网穿透边界

状态：Review · 最后更新：2026-10-30

关联文档：[学习目录](/learn/)、[源码引用规范](/learn/authoring/)、[技术栈与依赖地图](/learn/technology-stack/)、[本地调试](/learn/local-debugging/)

先读 [01.02 技术选型](/learn/technology-stack/)，知道 Solon、Netty 和数据库各自负责什么。这一篇接着用架构与流程把它们放回项目：谁配置、谁连接、字节往哪儿走。核心表看完后再做回显实验，最后按需进入源码导读。

<span id="本篇要解决的问题"></span>

<span id="先带着几个小问题往下看"></span>

## 先认四个角色，再跑一句话

适合已经写过 Java 接口、但没系统接触过 Netty 的同学。准备 Java 21、Maven、Python 3.10+，给第一次构建和实验留出约 20～30 分钟；首次下载 Maven 依赖可能更久。

| 角色 | 在这次实验里是谁 | 负责什么 |
| --- | --- | --- |
| 访问者 | Python 脚本发起的 TCP 请求 | 向映射端口发送一句话 |
| 代理服务端 server | 项目的服务端 JAR | 接住请求，经隧道交给客户端 |
| Java 客户端 client | 项目的客户端 JAR | 主动连接服务端，并连接目标 |
| 目标服务 | Python Echo 服务 | 收到什么字节，就回什么字节 |

```text
先建立控制连接：client ──主动连接──> server

请求：访问者 → server 映射端口 → 数据隧道 → client → Echo
响应：访问者 ← server 映射端口 ← 数据隧道 ← client ← Echo
```

**这里的数据方向，不等于 TCP 建连方向。** 控制连接、数据隧道都是 client 主动连 server。server 把消息写进已经建立的连接，不需要再从公网拨一条新连接进内网。管理后台用于配置，不在这句话的转发路径中。

## 先看整体流程，再理解配置数据

![正常 TCP 转发的四个角色、隧道建连方向、请求与响应方向](/learning/normal-tcp-flow.svg)

<a href="../../learning/normal-tcp-flow.html" target="_self">打开流程图大图</a>。图的上方是建连方向，下方是已经建立连接中的数据方向。目标服务可以是 Echo、HTTP 服务或其他 TCP 服务，图中先省略 TLS、UDP 与异常分支。

业务要分两条流程看：

| 流程 | 发生什么 | 主要技术 |
| --- | --- | --- |
| 管理配置 | 用户登录 → 准备 License 与可用端口 → 创建映射 → 保存配置 | Solon、业务 Service、MyBatis-Plus、数据库 |
| 使用代理 | client 认证 → server 加载启用映射并监听 → 访问者接入 → client 连接目标与数据隧道 → 双向转发 | Netty、代理协议、内存中的连接关系 |

这里先以“client 离线时创建配置，之后再上线”的普通场景说明顺序。在线修改映射还有动态更新流程，留到 [04.06](/learn/runtime-consistency/)继续讲。

有几个业务对象需要先认识：用户回答“配置属于谁”，License 回答“客户端使用哪份业务授权”，端口池回答“哪些入口允许使用”，端口映射回答“这个入口转去哪里”。**表里的配置，需要被应用读取并转成运行中的监听和连接，才参与真实访问。**

接着读 [04.01 业务表设计与关系图](/learn/database-model/)，看清这些对象为什么拆开、用什么字段关联，再回来跑下面的实验。数据库表不会替你保存一个还活着的 TCP Socket；运行中的 Channel 关系保存在进程内存里。

## 第一次动手：只验正常回显

### 第一步 检查环境并构建

打开 PowerShell，进入仓库根目录，也就是能看到 `pom.xml` 和 `scripts` 的目录。下面用本机路径举例，仓库放在别处就换成自己的路径。

```powershell
Set-Location D:\study\neutrino-proxy
java -version
mvn -version
python --version
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
```

预期：Java 和 Maven 显示的 JDK 都是 21，Python 至少为 3.10；最后看到 Maven 的 `BUILD SUCCESS`。继续确认两个产物都存在：

```powershell
Test-Path neutrino-proxy-server/target/neutrino-proxy-server.jar
Test-Path neutrino-proxy-client/target/neutrino-proxy-client.jar
```

两行都应输出 `True`。改过 Java 源码就重新构建，这个实验运行的是 JAR。

### 第二步 发送 hello-neutrino

本次 Windows 环境使用下面的命令；Linux/macOS 去掉 `--windows-tcp-pipe`，路径按自己的终端调整。

```powershell
python scripts/learning/project_overview.py --mode demo --windows-tcp-pipe
$LASTEXITCODE
```

`demo` 只做目标直连与代理往返。脚本自动启动真实 server、client 和 Echo，在新建的临时 H2 中创建实验配置；不需要先准备 MySQL 或手工填 License。结束时停止本轮进程并清理临时状态。

预期看到的关键字段如下。这是完整输出的节选，端口数字每次不同：

```json
{
  "mode": "demo",
  "checks": [
    { "name": "direct_target", "passed": true, "bytes": 14 },
    { "name": "proxy_roundtrip", "passed": true, "bytes": 14 }
  ],
  "example": { "sent": "hello-neutrino", "received": "hello-neutrino" },
  "temporaryStateRemoved": true
}
```

**验收看三处：** 两项 `passed` 都是 `true`，发送和接收都是 `hello-neutrino`，最后的退出码是 `0`。这句话是 14 个 UTF-8 字节。脚本按长度累加接收，不假设一次 `recv` 就拿到完整结果。

[查看正常回显的实测记录](/labs/first-echo-result.json)。它证明本机真实进程的正常链路可用；公网 NAT、防火墙和跨机器 TLS 需要另外验证。

### 第三步 对照结果排错

| 停在哪里 | 怎么查 | 继续的条件 |
| --- | --- | --- |
| 找不到 java、mvn 或 python | 分别执行上面的版本命令；在新终端确认 PATH | 三个命令都能运行，Java/Maven 使用 JDK 21 |
| Maven 编译失败 | 从第一条编译错误往下看；先比较 `java -version` 与 `mvn -version` 的 Java 版本 | 构建输出 `BUILD SUCCESS` |
| 提示 `Build first` | 执行构建，再跑两个 `Test-Path` | 两个 JAR 都存在 |
| `PipeImpl` / `UnixDomainSockets.connect` 报 `Invalid argument` | Windows 使用本节命令中的兼容参数；原因见下方“Windows 本机启动兼容参数” | JVM 能继续启动到代理初始化 |
| `Local readiness timed out` 或进程提前退出 | 读终端输出的错误类型；进程提前退出时还会附脱敏日志尾部。重跑保留最早的异常；若以前成功，先检查是否构建了新 JAR | 先有 `direct_target`，再有 `proxy_roundtrip` |
| 退出码 1，且有不可达目标检查 | 核对是否漏了 `--mode demo`；默认 `full` 会执行故障检查 | 第一次先完成两项正常检查，故障结果另行阅读 |

想自己反复发消息、查看当轮端口，继续 [01.03 双终端实验](/learn/local-debugging/)。这一篇的单次实验已经结束，报告里的端口现在不能继续连接。

<details>
<summary>先试着回答，再展开参考答案</summary>

1. 谁主动建立隧道？——Java client。内网侧通常更容易向外发起连接。
2. Echo 要认识代理协议吗？——不用。client 还原业务字节，Echo 只收到 `hello-neutrino`。
3. 现在能宣称公网穿透成功吗？——还不能。本次是本机回环集成，只验证协议和转发路径。

</details>

## 第二遍阅读：把回显放回源码

接下来会遇到四类 Channel、认证和异步绑定。先记住 `Channel` 是进程里表示网络连接的对象；不熟悉的 Netty 细节可以边读边查。源码入口表用于定位，读完一条主线再回来翻就好。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

Java 节选固定在提交 `94cafdd1f36e1f64b316e10466a8f54912c75467`。本文共八段连续原样节选；方法中的其他部分没有混入教学改写。代码块用于阅读局部逻辑，完整类和外围作用域以源码链接为准。

| 模块与文件 | 本篇关注的入口 |
| --- | --- |
| [根 pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml) | Maven 聚合的三个 Java 模块 |
| [client / ProxyClientService](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | 客户端主动建连与发送认证 |
| [server / ProxyMessageAuthHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java) | License、用户和客户端身份检查 |
| [server / VisitorChannelService](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java) | 映射信息、控制连接与监听端口 |
| [server / TcpVisitorChannelHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | 访问者建链、暂停读取、请求封装 |
| [client / ProxyMessageConnectHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | 连接内网目标与绑定数据通道 |
| [server / ProxyMessageConnectHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java) | 找到访问者并完成远端绑定 |
| [client / ProxyMessageTransferHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java) | 解出业务载荷并写入目标连接 |

同名 Handler 分别位于 server 和 client 包中。阅读时始终记录“模块 + 类 + 方法”，不要只凭类名跳转。

<span id="正文提纲"></span>

## 一起顺着代码走

我们就按“为什么需要它 → 谁在干活 → 连接怎么接上 → 数据怎么回来”走一趟。看到箭头时记得留个心眼：它可能跨了进程，也可能跨了异步回调，未必是同一条 Java 调用栈。

<span id="_1-先明确内网穿透解决什么问题"></span>

### 1 内网里的服务 怎么让外面的人访问

假设一台内网机器运行了业务服务。它能访问互联网，但外部用户没有可直接访问它的公网入口，或者入站连接受 NAT、路由和防火墙限制。

Neutrino Proxy 的方案是服务端中转：内网 Java 客户端先连到外部可达的代理服务端，服务端再通过这条已有连接发送控制指令；需要承载访问者数据时，由客户端再建立到服务端的数据连接。

这要求两侧分别满足网络条件：

- 访问者能够到达服务端的映射端口。
- 内网客户端能够主动连接服务端的隧道端口，并维持连接。
- 内网客户端所在机器能够访问配置中的目标 IP 和端口。
- License、用户和映射等业务配置允许这次访问。

NAT 会为允许的出站连接维护相应状态。这里利用客户端主动建立的连接传回控制消息；服务端不需要新建一个直接拨入内网客户端的 TCP 连接。实际可达性仍取决于部署网络，代理程序无法替代防火墙放行和正确的路由配置。

学习时尤其要注意 `localhost` 的位置：映射中的 `127.0.0.1` 由 Java 客户端去连接，指向客户端所在机器。若客户端位于容器，目标也是从该容器网络空间解释的；目标服务也可以是该客户端能够访问的另一台局域网机器。

<span id="_2-模块划分与运行进程"></span>

### 2 先给这几个模块认认门

出处：`pom.xml`，第 19～23 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L19-L23)。以下连续原样节选，外围作用域见原文件。

```xml
    <modules>
        <module>neutrino-proxy-core</module>
        <module>neutrino-proxy-client</module>
        <module>neutrino-proxy-server</module>
    </modules>
```

这五行说明根工程聚合 core、client 和 server 三个 Java 模块。通常需要运行 server、client 两个 Java 进程；core 以依赖 JAR 的形式进入它们，不单独启动。

| 部分 | 职责 | 与请求的关系 |
| --- | --- | --- |
| core | 公共消息结构、编解码、分发和常量 | 保证两端按同一种帧结构通信 |
| server | Solon 管理 API、数据库业务、Netty 监听与转发 | 同一个应用内连接配置管理与网络运行状态 |
| client | 认证、目标连接、转发、心跳与重连 | 位于能访问目标服务的网络环境 |
| admin | 既有 Vue 2 管理界面 | 调用管理 API 配置用户、License、端口池和映射 |
| 目标服务 | HTTP 服务、数据库服务或本实验的 TCP Echo | 接收还原后的业务字节并返回响应 |
| 独立桌面客户端 | Rust/Tokio 内核、Tauri 宿主与 Vue 3 界面 | 作为后续选修中的另一种客户端实现 |

管理后台静态页面可以由服务端提供；前端工程目录不意味着运行时一定有一个独立 Node 进程。服务端当前使用 Solon、MyBatis-Plus 和 Netty，具体依赖版本放在[下一篇技术栈课程](/learn/technology-stack/)展开。

可以把管理配置和数据转发分别理解为管理面与数据面。这是阅读职责的方式：两者当前都包含在同一个 server Java 应用中。关闭浏览器不会结束后台转发，停止整个服务端进程则会中断它。

<span id="_3-四类端口与四类-channel"></span>

### 3 端口和 Channel 先别混成一件事

端口表示监听入口，Channel 表示某一端持有的连接对象；它们不是一对一关系。很多客户端连接可以进入同一个隧道监听端口。

| 端口角色 | 连接者 | 用途 |
| --- | --- | --- |
| 管理 Web 端口 | 管理界面或脚本 | HTTP 登录和配置操作 |
| 隧道端口 | Java 客户端 | 控制连接、数据连接；按配置区分明文与 TLS 入口 |
| 映射端口 | 外部访问者 | 访问被映射的业务服务 |
| 目标端口 | Java 客户端 | 连接实际业务服务 |

下面的名称强调连接角色。某条 TCP 连接在两端各有自己的 Channel 对象，不能把整个系统理解为只存在四个 Java 对象。

| Channel 角色 | 两端 | 连接发起者 |
| --- | --- | --- |
| CmdChannel | client ↔ server | client，传认证、心跳与控制消息 |
| VisitorChannel | 访问者 ↔ server | 访问者 |
| ProxyChannel | client ↔ server | client，承载与访问者关联的数据 |
| RealServerChannel | client ↔ 目标服务 | client |

```text
控制：Java 客户端 ──主动连接──> 代理服务端隧道入口

数据请求：
访问者 ──> server 的 VisitorChannel
       ──经 ProxyChannel 隧道──> client
       ──经 RealServerChannel──> 目标服务

响应沿上述数据路径反向返回。
```

控制连接与数据连接可以进入同一个服务端隧道端口，它们仍是不同 TCP 连接，具有不同的生命周期。服务端和客户端使用 `visitorId`、License 以及 Channel 属性关联它们。

<span id="_4-控制连接建立后-先认证再初始化映射"></span>

### 4 客户端先来报到 连上了还得过认证

客户端启动主线如下：

```text
client.ProxyClient.main
  → Solon 容器组装配置和 Bootstrap
  → ProxyClientService.init → start → connectProxyServer
  → TCP connect 成功回调 → AUTH

server.ProxyTunnelChannelHandler.channelRead0
  → Dispatcher → server.ProxyMessageAuthHandler.handle
  → 校验 License、所属用户及客户端身份
  → VisitorChannelService.initVisitorChannel
```

出处：`neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java`，第 93～103 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L93-L103)。以下连续原样节选，外围作用域见原文件。

```java
	private void connectProxyServer() throws InterruptedException {
		cmdTunnelBootstrap.connect()
			.addListener(new ChannelFutureListener() {

				@Override
				public void operationComplete(ChannelFuture future) throws Exception {
					if (future.isSuccess()) {
						channel = future.channel();
						// 连接成功，向服务器发送客户端认证信息（licenseKey）
						ProxyUtil.setCmdChannel(future.channel());
						future.channel().writeAndFlush(ProxyMessage.buildAuthMessage(proxyConfig.getTunnel().getLicenseKey(), ProxyUtil.getClientId()));
```

`cmdTunnelBootstrap.connect()` 从客户端发起连接。连接成功后，回调保存 CmdChannel 并发送 AUTH。网络握手成功只说明 TCP 连通，License 是否有效要等服务端解析认证消息。

服务端认证处理器会检查 License 是否存在、是否启用、所属用户是否有效，以及既有客户端绑定是否冲突。认证成功后会更新在线状态并调用下面的方法：

出处：`neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java`，第 59～66 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L59-L66)。以下连续原样节选，外围作用域见原文件。

```java
    public void initVisitorChannel(Integer licenseId, Channel cmdChannel) {
        List<PortMappingDO> portMappingList = portMappingMapper.findEnableListByLicenseId(licenseId);
        // 没有端口映射仍然保持连接
        ProxyUtil.initProxyInfo(licenseId, ProxyMapping.buildList(portMappingList));

        ProxyUtil.addCmdChannel(licenseId, cmdChannel, portMappingList.stream().map(PortMappingDO::getServerPort).collect(Collectors.toSet()));

        startUserPortServer(ProxyUtil.getAttachInfo(cmdChannel), portMappingList);
```

这段代码完成三个衔接：从数据库读取该 License 的启用映射，把 License 和外网端口关联到控制连接，然后初始化访问端口监听。

注意，“认证成功”“映射端口监听成功”“内网目标可连接”发生在不同步骤。这里还没有连接真正的业务目标；没有映射时，控制连接也可以保持在线。因此排障不能只看管理界面的在线标记。

若客户端离线时先创建映射，配置会留在数据库，认证后的初始化负责读取它们；在线时变更映射，则还有管理 Service 到 `VisitorChannelService` 的动态更新路径，详见[配置动态生效课程](/learn/runtime-consistency/)。

<span id="_5-访问者接入后-服务端发出-connect"></span>

### 5 访问者来了 先等后半段接好

访问者到达映射端口后：

```text
server.TcpVisitorChannelHandler.channelActive
  → 按本地映射端口查 CmdChannel
  → 取得 clientIp:clientPort
  → 暂停读取 VisitorChannel
  → 创建 visitorId 并记录关联
  → 经 CmdChannel 发送 CONNECT(visitorId, 目标地址)
```

出处：`neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java`，第 101～106 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L101-L106)。以下连续原样节选，外围作用域见原文件。

```java
        // 用户连接到代理服务器时，设置用户连接不可读，等待代理后端服务器连接成功后再改变为可读状态
        visitorChannel.config().setOption(ChannelOption.AUTO_READ, false);

        String visitorId = ProxyUtil.newVisitorId();
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.TCP, cmdChannel, visitorId, visitorChannel, sa.getPort());
        cmdChannel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId).setData(lanInfo.getBytes()));
```

`AUTO_READ=false` 暂停的是 Netty 对该 Channel 的自动读取。此时 TCP 连接已经建立，操作系统仍可能缓存对方发来的字节；它不等于让访问者无法发送任何数据。

为什么先暂停？访问者已经连上 server，但通往内网目标的后半段还没准备好。先建立关联，等客户端返回绑定信息，再恢复读取，可以让请求按建链顺序进入转发逻辑。这里体现了业务 API 中较少遇到的“连接已接入，但数据处理条件尚未满足”。

`visitorId` 让同一控制连接下的多个访问者能够被区分。它与目标地址一起告诉客户端：为哪次访问、连接哪个内网服务。

<span id="_6-客户端连接目标-并绑定数据通道"></span>

### 6 客户端去敲目标服务的门

客户端 CONNECT 处理器先解析目标地址，再异步执行 `realServerBootstrap.connect(ip, port)`。目标连接成功后暂时关闭其自动读取，再调用 `borrowTcpProxyChanel` 获取或创建数据通道。

成功借到数据通道后执行：

出处：`neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java`，第 54～64 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L54-L64)。以下连续原样节选，外围作用域见原文件。

```java
						public void success(Channel channel) {
							// 连接绑定
							channel.attr(Constants.NEXT_CHANNEL).set(realServerChannel);
							realServerChannel.attr(Constants.NEXT_CHANNEL).set(channel);

							// 远程绑定
							channel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId + "@" + proxyConfig.getTunnel().getLicenseKey()));

							realServerChannel.config().setOption(ChannelOption.AUTO_READ, true);
							ProxyUtil.addRealServerChannel(visitorId, realServerChannel);
							ProxyUtil.setRealServerChannelVisitorId(realServerChannel, visitorId);
```

这里的 `channel` 是 ProxyChannel，`realServerChannel` 是目标连接。两个 `NEXT_CHANNEL` 属性互相指向，后续处理器可以从当前连接直接找到下一跳。

客户端接着通过数据通道发送包含 `visitorId@licenseKey` 的 CONNECT。服务端会重新校验其中的业务身份，并在对应 CmdChannel 管理的访问者集合里查找该 `visitorId`。

这也是同名 CONNECT 消息在两端承担不同阶段的原因：控制连接上的消息要求客户端连接目标；数据连接上的消息告诉服务端把该数据连接绑定到某个访问者。阅读协议时需要同时看消息类型、发送方向和所在连接。

客户端随后会打开目标连接的自动读取。后续字节仍沿同一条数据连接发送，TCP 顺序以及服务端的消息处理顺序使建链帧先于后续载荷进入处理链。

<span id="_7-服务端补齐另一侧关联-再恢复访问者读取"></span>

### 7 把两端配上对 数据才知道往哪儿走

出处：`neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java`，第 83～89 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java#L83-L89)。以下连续原样节选，外围作用域见原文件。

```java
		ctx.channel().attr(Constants.VISITOR_ID).set(visitorId);
		ctx.channel().attr(Constants.LICENSE_ID).set(licenseDO.getId());
		ctx.channel().attr(Constants.NEXT_CHANNEL).set(visitorChannel);
		visitorChannel.attr(Constants.NEXT_CHANNEL).set(ctx.channel());
        visitorChannel.attr(Constants.LICENSE_ID).set(licenseDO.getId());
        // 代理客户端与后端服务器连接成功，修改用户连接为可读状态
		visitorChannel.config().setOption(ChannelOption.AUTO_READ, true);
```

服务端将数据连接和 VisitorChannel 互相写入 `NEXT_CHANNEL`，保存 License、visitorId，然后恢复访问者读取。现在两端都能通过“当前 Channel → NEXT_CHANNEL”找到下一跳。

这时一次普通 TCP 访问的四类连接才形成可转发的完整路径。实现里存在数据通道池相关方法，但正常断开的一些分支会直接关闭连接；复用效果需要对照实际关闭路径，留到[连接池与清理课程](/learn/client-pool-cleanup/)验证。

<span id="_8-业务字节如何往返"></span>

### 8 终于可以把请求送过去了

服务端接收访问者字节后，把数据装进 TRANSFER 消息：

出处：`neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java`，第 67～75 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L67-L75)。以下连续原样节选，外围作用域见原文件。

```java
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);

        // 代理通道可写，则设置访问通道可读。代理通道不可写，则设置访问通道不可读
        visitorChannel.config().setAutoRead(proxyChannel.isWritable());

        // 转发代理数据
        String visitorId = ProxyUtil.getVisitorIdByChannel(visitorChannel);
        proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));
```

数据载荷从 `ByteBuf` 复制到 `byte[]`，再与 `visitorId` 一起放入代理消息。这里的业务内容可以包含零字节、中文编码后的字节或其他二进制内容；TCP 转发主线不要求它先成为管理 API 的 JSON 请求。

同时，处理器根据 ProxyChannel 的可写状态调整访问者读取。这是背压的入口：下游写入跟不上时，减少继续从上游读取。缓冲水位、恢复事件和内存成本会在[背压课程](/learn/netty-backpressure/)细讲。

客户端收到 TRANSFER 后，把载荷写入已绑定的目标连接：

出处：`neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java`，第 23～32 行，[查看原文件](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java#L23-L32)。以下连续原样节选，外围作用域见原文件。

```java
	public void handle(ChannelHandlerContext ctx, ProxyMessage proxyMessage) {
		Channel realServerChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
		if (realServerChannel != null) {

			// 自己可写，则设置来源可读。自己不可写，则设置来源不可读
			ctx.channel().config().setAutoRead(realServerChannel.isWritable());

			ByteBuf buf = ctx.alloc().buffer(proxyMessage.getData().length);
			buf.writeBytes(proxyMessage.getData());
			realServerChannel.writeAndFlush(buf);
```

两个进程通过代理协议传输数据，内网目标收到的则是还原后的业务字节。目标不需要认识 `ProxyMessage` 或 License。

完整往返对应以下处理器：

```text
请求：
server.TcpVisitorChannelHandler.channelRead0
  → TRANSFER → client.ProxyMessageTransferHandler.handle
  → RealServerChannel → 目标服务

响应：
目标服务 → client.RealServerChannelHandler.channelRead0
  → TRANSFER → server.ProxyMessageTransferHandler.handle
  → VisitorChannel → 访问者
```

[client.RealServerChannelHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) 负责把目标响应封装回隧道，[server.ProxyMessageTransferHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java) 负责写回访问者。管理浏览器不出现在这条数据调用链中。

<span id="_9-故障边界与部署边界"></span>

### 9 哪一步卡住 就先看哪一段

| 现象 | 优先检查的位置 |
| --- | --- |
| 管理登录正常，客户端连不上 | 隧道地址、端口、网络可达性和 TLS 配置 |
| TCP 隧道连通，认证失败 | License、用户状态、clientId 冲突及认证结果 |
| 客户端在线，映射端口不可达 | 映射与端口池状态、监听结果、服务端防火墙 |
| 映射可接入，目标不可达 | 客户端视角的目标地址与端口、CONNECT 失败路径 |
| 数据传输中断或积压 | 对端关闭、异常、可写状态和背压事件 |

TLS 隧道保护的是 client 到 server 这一段；访问者到 server、client 到目标的保护需要按各段协议分别设计。License 是客户端业务认证凭证，管理登录 Token 是管理 API 凭证，两者不应混用。完整权限和威胁分析放到后续课程。

本章实验只验证本机真实进程之间的协议和转发，不能据此声称公网 NAT、防火墙、跨机器 TLS 或长时间负载已验证。

<span id="动手实验与验收"></span>

<span id="动手试一小步"></span>

## 进阶动手：观察故障边界

正常回显已经完成。下面保留完整故障实验，想继续排障时再做；这组实验当前有一项已知失败。

**动手试试**：用一个本地 TCP Echo 目标，运行真实服务端和 Java 客户端；验证字节往返，停止管理调用后的转发，并注入不可达目标与客户端退出。

### 1 准备和运行

在仓库根目录执行。前置环境为 Java 21、Maven、Python 3.10+；Python 脚本仅使用标准库，无须安装额外包。

```powershell
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
python scripts/learning/project_overview.py --mode full
```

脚本位于 `scripts/learning/project_overview.py`。它会启动两个真实 Java JAR 和 Python Echo 服务，使用新建临时目录及本地 H2，通过本地管理 API 创建独立的测试 License、端口池和两条 TCP 映射。认证值只在临时进程配置中使用，不写入结果报告。

客户端访问地址全部为 `127.0.0.1`，HTTP 调用禁用环境代理和重定向；服务端监听地址仍沿用项目本身的绑定实现。脚本不会读取或修改你现有的数据库、License 和运行配置。进程结束后停止本轮进程并删除临时状态。

管理、隧道、映射、Echo 目标端口动态分配。报告中的 `ports` 记录本次拓扑；它们不是下次运行必须沿用的配置。完整自动实验结束后，相应进程已退出，不能再用这些旧端口验证存活状态。

### 2 Windows 本机启动兼容参数

本次 Windows + Azul JDK 21.0.10 环境，默认启动在 `PipeImpl → UnixDomainSockets.connect` 报 `Invalid argument: connect`，发生于 Selector 初始化，早于代理认证。已用独立的 `Selector.open()` 小程序复现并核对本机 JDK 源码。

遇到同样的栈时，本地实验可以运行：

```powershell
python scripts/learning/project_overview.py --mode full --windows-tcp-pipe --report neutrino-proxy-vuepress/docs/public/labs/project-overview-result.json
```

该选项只给本轮 JVM 设置 `jdk.net.unixdomain.tmpdir`，指向临时目录下一个不存在的子目录，使 JDK 21 的管道建立走 TCP 回退；没有修改 Java 项目源码或全局 JDK 配置，也没有更换 NIO Provider。这是针对上述本机环境的实验参数，不作为所有 JDK 的通用启动建议。回退逻辑与目录属性可对照 [OpenJDK PipeImpl](https://github.com/openjdk/jdk21u/blob/master/src/java.base/windows/classes/sun/nio/ch/PipeImpl.java) 和 [UnixDomainSocketsUtil](https://github.com/openjdk/jdk21u/blob/master/src/java.base/windows/classes/sun/nio/ch/UnixDomainSocketsUtil.java)。

### 3 实验步骤与验收点

| 步骤 | 做什么 | 检验的边界 |
| --- | --- | --- |
| A | 直接向 Echo 发送 65,536 字节 | 先证明目标自身可用 |
| B | 经映射发送同一份二进制数据，核对内容和 SHA-256 | Visitor → 隧道 → 目标 → 原路返回 |
| C | 停止发出管理 API 请求，再经映射发送数据 | 已建立转发不依赖持续的管理 HTTP 调用 |
| D | 访问另一条指向未监听目标端口的映射，等待关闭或拒绝 | 目标连接失败能否在 3 秒内结束访问者等待 |
| E | 再访问正常映射 | 一条坏映射是否影响另一条健康映射 |
| F | 停止本轮 Java 客户端，再访问映射 | 代理不能在缺少客户端的情况下继续转发 |

脚本用循环累加 TCP 接收字节，直到达到预期长度；不假设一次 `recv` 就得到完整内容。步骤 D 保留严格的 3 秒关闭要求；超时会写入 `passed: false`，不会伪装为成功。

如果任意断言失败，脚本仍输出已完成的检查，并以退出码 1 结束；启动失败和其他未处理异常也会返回非零。正常链路通过与所有故障边界通过，应分别判断。

### 4 本次实际结果

2026-10-30 在 Windows、Java 21.0.10、Python 3.14.6 下执行，启用了上述本地 TCP 管道兼容参数。Java Maven 构建成功；Maven 日志显示三个 Java 模块均没有可执行的现有单元测试，因此下面使用的是实际进程与 Socket 的集成验证。

[查看本次脱敏 JSON 实验记录](/labs/project-overview-result.json)。报告包含执行时间、源码提交、JAR 哈希和本次动态端口。实验对应提交中的本文 Java 引用文件与节选基线一致。

| 检查 | 实际结果 |
| --- | --- |
| 直接访问 Echo | 通过，65,536 字节一致 |
| 经代理访问 Echo | 通过，65,536 字节一致 |
| 不再调用管理 API 后继续转发 | 通过 |
| 不可达目标在 3 秒内关闭访问者 | **未通过：3 秒内没有收到关闭或拒绝** |
| 坏目标之后再次访问健康映射 | 通过 |
| 客户端退出后不能继续转发 | 通过 |
| 本轮临时状态清理 | 完成 |

本次有效载荷 SHA-256 为 `7daca2095d0438260fa849183dfc67faa459fdf4936e1bc91eec6b281b27e4c2`。因为步骤 D 未满足验收，实验脚本的实际退出码为 **1**；这份记录不表示所有场景通过。

### 5 怎样沿源码分析实验中的失败

客户端目标连接失败时，[client.ProxyMessageConnectHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L78-L80) 经 CmdChannel 发送 DISCONNECT，消息 info 携带 visitorId。

对照 [server.ProxyMessageDisconnectHandler](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageDisconnectHandler.java#L25-L38)：当前处理先从收到消息的 Channel 读取 License 属性，再尝试从该 Channel 的 `NEXT_CHANNEL` 获取访问者；旧的按 visitorId 查找访问者逻辑留在注释中。这与控制连接尚未绑定到某个访问者的建链阶段存在衔接疑点。

这是根据现有分支作出的源码分析，实验已经证明的是“这次不可达目标场景在 3 秒窗口内没有结束访问者等待”。要确认根因与修复方案，还需在对应控制连接和处理器上加断点，追踪属性值与清理路径，参见[断开清理课程](/learn/server-disconnection/)。本篇保留失败记录，没有更改后端行为，也没有把 3 秒观察扩展成永远不会关闭的结论。

做完以后，拿张纸把四类 Channel 画出来，标上谁先发起连接，再把报告里的成功项和失败项分别放回图上。要是你已经知道下一步该在哪个方法打断点，这趟实验就没有白跑。

<span id="完善清单"></span>

<span id="复习与延伸"></span>

## 合上代码前想一想

给自己留半分钟，先凭刚才的理解答一下，再回代码找证据：

1. 为什么只开放管理 Web 端口，仍可能无法使用 TCP 映射？——还需要隧道、映射入口和各段网络可达性。
2. clientId、License 和 visitorId 分别对应什么？——客户端身份、业务授权和一次访问者关联。
3. 为什么同一隧道端口可以有控制与数据两类连接？——监听端口可接收多条独立 TCP 连接，消息和属性决定其角色。
4. 为什么目标地址为 localhost 时，服务端本机服务不一定被访问？——真正发起目标连接的是 Java 客户端。
5. 为什么访问者已经握手成功，仍要暂停 AUTO_READ？——目标与数据通道尚在异步建立，绑定条件未满足。
6. 管理浏览器关闭与整个 ProxyServer 停止有什么区别？——前者离开管理界面，后者停止同时承载管理与转发的进程。
7. 本机 Echo 成功能证明 NAT 和 TLS 配置正确吗？——本实验没有覆盖这两个部署边界。
8. 为什么 full 实验退出码 1 仍值得保留？——它记录了未满足的故障断言，避免把设计意图写成实际结果。

下一篇阅读[01.02 技术栈与依赖地图](/learn/technology-stack/)。希望先熟悉调试方式，可以进入[01.03 本地调试与第一条 TCP 映射](/learn/local-debugging/)；协议字段与半包问题留到[协议课程](/learn/protocol-frame/)系统展开。
