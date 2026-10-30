---
title: "05.01 NIO Reactor 与 EventLoop 线程模型"
date: 2026-10-30
permalink: /learn/netty-reactor/
article: false
status: Review
updated: 2026-10-30
lesson: "05.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    symbol: "proxyServerCommonInitHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/proxy/ProxyConfiguration.java"
    symbol: "tcpServerBootstrap"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/proxy/ProxyConfiguration.java"
    startLine: 52
    endLine: 64
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    startLine: 65
    endLine: 73
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 43
    endLine: 54
---

# 05.01 NIO Reactor 与 EventLoop 线程模型

状态：Review · 最后更新：2026-10-30

关联阅读：[01.03 双终端实验](/learn/local-debugging/)、[源码引用规范](/learn/authoring/)、[学习目录](/learn/)

假设来了两条 TCP 连接，需要两条工作线程吗？这次先别背 Reactor 定义。我们启动真实 server/client，让两个请求同时经过代理，再把回调所在的线程记下来。读完你会看到：连接不同，干活的线程可以相同。

<span id="本篇要解决的问题"></span>

<span id="先带着一个问题读下去"></span>

## 先把四个词分开

| 名称 | 可以先这样理解 | 本项目里的例子 |
| --- | --- | --- |
| 进程 | 一个正在运行的 Java 程序 | server 与 client 是两个 JVM |
| Channel | 当前进程里表示网络连接的对象 | server 上每条访问者连接有自己的 Channel |
| EventLoop | 持续处理注册连接的事件和任务 | 执行 `channelActive`、`channelRead0` 等回调 |
| EventLoopGroup | 一组 EventLoop | `tcpServerWorkerGroup` 把不同连接分配给组内的 EventLoop |

NIO 路径可以先记成：boss 接受新连接，worker 处理已接入连接的读写。一个 Channel 注册到一个 EventLoop，一个 EventLoop 可以服务多个 Channel。**所以连接数增加，不要求线程数跟着一比一增加。**

下面观察的是本项目默认 TCP Pipeline。它没有给这些业务 Handler 配独立执行器；UDP 的部分组装方式不同，别把这次结论直接套过去。

<span id="动手实验与验收"></span>

<span id="动手试一小步"></span>

<span id="跟着线程走一次-比背术语有效"></span>

## 动手：让两条连接共用一个 worker

**动手试试**：准备 Java 21 **JDK**、Maven、Python 3.10+ 和两个 PowerShell 终端。需要 JDK 是因为观察工具使用 JDK 自带的 `jdk.jdi` 调试接口，不需要另外安装 Java 库。

### 1 终端 A 启动带调试端口的实验

如果上一节还在运行，先停止旧会话。两个终端都进入仓库根目录：

```powershell
Set-Location D:\study\neutrino-proxy
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
$sessionFile = Join-Path $env:TEMP "np-reader-session.json"
python scripts/learning/project_overview.py --mode demo --windows-tcp-pipe --keep-alive 600 --debug --session-file $sessionFile
```

等 `LAB_READY`，同时应看到下面格式的两行：

```text
mapping=127.0.0.1:业务映射端口 target=127.0.0.1:目标端口
JDWP server=127.0.0.1:服务端调试端口 client=127.0.0.1:客户端调试端口
```

Linux/macOS 去掉 Windows 兼容参数并换成对应 shell 写法。本轮工具通过启动参数将**服务端 TCP 访问者 worker 数量设为 1**，方便稳定观察“一个线程服务多个连接”。这是实验配置，不代表生产建议，也不代表项目默认值。客户端的目标连接组仍设为 2，因此客户端两条连接可能落在不同线程。

`--debug` 为两个 JVM 加入 JDWP，使用 `suspend=n`，所以启动时不等待调试器；地址限定为 `127.0.0.1`。调试端口与隧道、映射端口是不同用途，参数含义见 [JDK 21 调试连接说明](https://docs.oracle.com/en/java/javase/21/docs/specs/jpda/conninv.html)。

### 2 终端 B 运行线程观察工具

先不要用 IDE 占用调试端口。工具自己会附加这两个 JVM，并发出两条真实请求：

```powershell
Set-Location D:\study\neutrino-proxy
$sessionFile = Join-Path $env:TEMP "np-reader-session.json"
$s = Get-Content $sessionFile -Raw | ConvertFrom-Json
java --add-modules jdk.jdi scripts/learning/TraceChannels.java $s.debugPorts.server $s.debugPorts.client $s.ports.mapping
$LASTEXITCODE
```

工具是源码文件启动，无需手工编译。预期退出码为 `0`，最后打印：

```text
TRACE_PASS visitors=2 serverWorkerThreads=1 clientResponseObserved=true
```

在此之前会有类似的回调记录。以下是本次实测中的部分行，你本机的线程编号和对象编号可以不同：

```text
server | channelActive | thread=nioEventLoopGroup-2-1 | handlerObject=4
server | channelActive | thread=nioEventLoopGroup-2-1 | handlerObject=5
server | channelRead0 | thread=nioEventLoopGroup-2-1 | handlerObject=4
server | channelRead0 | thread=nioEventLoopGroup-2-1 | handlerObject=5
client | channelRead0 | thread=nioEventLoopGroup-2-2 | handlerObject=4
```

### 3 读懂观察结果

| 看哪一列 | 这次能得出什么 |
| --- | --- |
| 两条 server `channelActive` 的 `handlerObject` 不同 | 创建了两个访问者 Handler，分别服务两条连接 |
| 它们的 `thread` 相同 | 两条访问者连接被同一个 worker 处理 |
| 同一对象还有 `channelRead0` | 接入以后确实读到了业务字节 |
| client 出现 `channelRead0` | 目标响应进入了客户端目标连接处理器 |
| `TRACE_PASS` 与退出码 0 | 工具同时检查了两条真实回显及上述观测条件 |

`handlerObject` 是调试器给对象分配的编号，**不是 Netty Channel ID**。能用它区分本次连接，是因为项目的两个 ChannelInitializer 都为每条连接 `new` 一个对应 Handler。若以后改成共享 Handler，就要更换观察方法。server 与 client 是两个 JVM，对象编号、线程名都可能碰巧相同，比较时必须带上角色。

[查看本次线程与回显实测记录](/labs/reader-session-result.json)。这只是两条连接的小实验，不代表高负载、任务公平性或阻塞影响已经做过压测。

### 4 停止会话

```powershell
python scripts/learning/lab_request.py --session-file $sessionFile --stop
```

等待 A 结束。预期会话文件的 `state` 为 `stopped`，最终报告的 `temporaryStateRemoved` 为 `true`。工具正常退出会解除调试附加；整个实验最多保留 600 秒。

<span id="正文提纲"></span>

<span id="一起顺着代码走"></span>

<span id="项目源码入口"></span>

<span id="这次先打开哪几个文件"></span>

## 回源码：线程组在哪里创建、在哪里使用

源码固定于提交 `94cafdd1f36e1f64b316e10466a8f54912c75467`。先看创建组，再看 Bootstrap 把组交给哪类连接，不用先通读所有配置类。

### 连接很多，不等于线程很多

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/proxy/ProxyConfiguration.java#L52-L64)（原文件 52～64 行，连续原样节选）：

```java
    @Bean("tcpServerBossGroup")
    public NioEventLoopGroup tcpServerBossGroup(@Inject ProxyConfig proxyConfig) {
        ProxyConfig.Server server = proxyConfig.getServer();
        ProxyConfig.Tcp tcp = server.getTcp();
        return new NioEventLoopGroup(tcp.getBossThreadCount());
    }

    @Bean("tcpServerWorkerGroup")
    public NioEventLoopGroup tcpServerWorkerGroup(@Inject ProxyConfig proxyConfig) {
        return new NioEventLoopGroup(proxyConfig.getServer().getTcp().getWorkThreadCount());
    }

    @Bean("tcpServerBootstrap")
```

`new NioEventLoopGroup(...)` 的数量来自绑定后的配置。实验工具明确传入 1，所以两条访问者连接都进入这一组的同一个 EventLoop。直接运行自己的 JAR 时，先确认实际配置值，不能照抄实验里的线程数。

这里的 boss 负责接受连接；下面 `tcpServerBootstrap` 的 `.group(tcpServerBossGroup, tcpServerWorkerGroup)` 把已接入连接交给 worker。你看到的 `channelRead0` 是 worker 上的业务处理，不是 boss 在替每个请求读写。

### 把三类连接画到三个位置

| 连接 | Bootstrap 或服务入口 | 使用的线程组 |
| --- | --- | --- |
| 访问者 → server 映射端口 | server `tcpServerBootstrap` | `tcpServerBossGroup` / `tcpServerWorkerGroup` |
| client → server 隧道入口 | server `ProxyTunnelServer` | `tunnelBossGroup` / `tunnelWorkerGroup` |
| client 发起控制或数据隧道 | client `cmdTunnelBootstrap` / `tcpProxyTunnelBootstrap` | `tunnelWorkGroup` |
| client → 真实目标 | client `realServerBootstrap` | `tcpRealServerWorkGroup` |

名称容易记串：目标连接的 Bean 叫 **`realServerBootstrap`**，目标连接线程组才叫 `tcpRealServerWorkGroup`。查源码时以完整模块和 Bean 名为准。

服务端接收隧道的入口如下，字段 `serverBossGroup/serverWorkerGroup` 分别注入的是 `tunnelBossGroup/tunnelWorkerGroup`：

看这段 [ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java#L65-L73)（原文件 65～73 行，连续原样节选）：

```java
		bootstrap.group(serverBossGroup, serverWorkerGroup).channel(NioServerSocketChannel.class).childHandler(new ChannelInitializer<SocketChannel>() {

			@Override
			public void initChannel(SocketChannel ch) throws Exception {
				proxyServerCommonInitHandler(ch);
			}
		});
		try {
			bootstrap.bind(proxyConfig.getTunnel().getPort()).sync();
```

调用关系是：Solon 加载结束 → `startProxyServer` → `bind` 打开监听 → 新连接到来 → `initChannel` 安装 Pipeline → 收字节、解码与分发。`bind` 完成，不代表未来每条连接都已经建好。

客户端的两个组又是什么关系？

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L43-L54)（原文件 43～54 行，连续原样节选）：

```java
    @Bean("tunnelWorkGroup")
    public NioEventLoopGroup tunnelWorkGroup(@Inject ProxyConfig proxyConfig) {
        return new NioEventLoopGroup(proxyConfig.getTunnel().getThreadCount());
    }

    @Bean("tcpRealServerWorkGroup")
    public NioEventLoopGroup tcpRealServerWorkGroup(@Inject ProxyConfig proxyConfig) {
        // 暂时先公用此配置
        return new NioEventLoopGroup(proxyConfig.getTunnel().getThreadCount());
    }

    @Bean("udpServerGroup")
```

两个工厂方法都读 `tunnel.threadCount`，却各自 `new` 一个组。“共用配置”说明数量来源相同，**不说明两个组是同一个实例**。这也解释了为什么隧道与目标连接可以分别在不同线程运行。

## 选做：在 IDE 亲自看一次

这一部分是操作指引，未把 IDE 图形界面操作算作本次实测。先完成前面的命令行观察，确保实验与 JDWP 都能正常运行。

1. 重新启动带 `--debug` 的会话，等 `LAB_READY`。在 IDEA 打开仓库、加载 Maven 工程；若改过 Java，先重新构建 JAR 再启动。
2. 在 **Run → Edit Configurations → + → Remote JVM Debug** 新建两个配置，模式选 Attach，主机填 `localhost`；端口分别填会话中的 `$s.debugPorts.server` 和 `$s.debugPorts.client`。操作入口见 [IDEA 官方远程调试教程](https://www.jetbrains.com/help/idea/tutorial-remote-debug.html)。
3. server 的 `TcpVisitorChannelHandler.channelActive` 中，在 `ProxyUtil.addVisitorChannelToCmdChannel(...)` 那行设置行断点；client 的 `RealServerChannelHandler.channelRead0` 中，在 `Channel realServerChannel = ctx.channel();` 那行设断点。
4. 把断点的 Suspend 设为 **Thread**，避免暂停整个 JVM；分别启动两个 Attach。终端 B 执行下面命令，给手工观察留出 60 秒的读取等待：

```powershell
python scripts/learning/lab_request.py --session-file $sessionFile --connections 2 --timeout 60
```

停住后检查 `Thread.currentThread().getName()`、`ctx.channel().id().asShortText()`，server 还可以看 `visitorId`。记录“进程、处理器、线程名、Channel ID”四列，再继续执行。两个连接若共用一个 worker，暂停其中一个回调时，另一个也会排队。

手工停顿可能触发心跳或其他超时。要稳定记录，可把断点改为只记录表达式、不暂停，选项见 [IDEA 断点说明](https://www.jetbrains.com/help/idea/using-breakpoints.html)。这里不需要在业务代码中插入 sleep 或改线程实现。

## 常见问题怎么拆

| 现象 | 先检查 | 处理方式 |
| --- | --- | --- |
| `jdk.jdi` 找不到 | `java -version` 是否使用完整 JDK 21 | 切到 JDK，再启动 A/B |
| 调试连接被拒绝 | A 是否加 `--debug`，会话是否仍活动 | 重启后重新读取动态调试端口 |
| 附加握手失败、端口已使用 | IDE 是否已附加同一个 JVM | 停掉那次调试，再运行观察工具；一个端口一次供一个调试器使用 |
| 断点不命中、源码位置对不上 | IDE 源码与被运行的 JAR 是否一致 | 停会话、重新 Maven 构建、重启并重新附加 |
| `TRACE_PASS` 没出现 | 读工具错误；确认没有手工暂停线程、会话没到期 | 先做普通回显，再重启干净会话重试；非零不算观察通过 |
| 两条连接没有同一线程 | 是否运行了本篇工具启动的实验 | 它显式设访问者 worker=1；自行部署的多 worker 环境不保证相同 |

<span id="完善清单"></span>

<span id="合上代码前想一想"></span>

## 自测与参考答案

<details>
<summary>1. 两条连接共用一个 worker，还能算并发吗？</summary>

可以同时保持连接，事件由线程轮流处理；不要求每个连接独占一条线程。某个回调执行期间，同一 EventLoop 的其他任务要等待它结束。

</details>

<details>
<summary>2. 为什么在 channelRead0 里同步查慢数据库会影响别人？</summary>

默认 TCP 业务回调运行在该 Channel 的 EventLoop 上。慢查询会占住线程，让同一个 EventLoop 服务的其他连接也延迟。这次没有做慢查询压测，结论来自执行方式；是否移交业务执行器还要考虑消息顺序、线程安全和回写。

</details>

<details>
<summary>3. 两个线程组读取同一个数字，为什么仍然不同？</summary>

配置值相同，但创建了两个对象。两个组分别拥有自己的 EventLoop，线程名也可能相似；不能用配置键或线程名字相似来证明实例共享。

</details>

<details>
<summary>4. 一个 Channel 的回调有序，等于整个系统按一条调用栈运行吗？</summary>

不等于。不同连接可以在不同 EventLoop 上，server/client 更是不同进程。CONNECT、目标建连、隧道绑定通过消息和异步回调衔接，要按阶段与 visitorId 追，不能当成同步方法嵌套。

</details>

接着看 [05.02 Bootstrap 与 Future](/learn/netty-bootstrap/)，把“谁来干活”接到“什么时候干完”。
