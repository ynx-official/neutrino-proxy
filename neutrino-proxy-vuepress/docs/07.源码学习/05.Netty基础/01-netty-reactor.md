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

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

先想象你要接住一千条 TCP 连接。按传统阻塞写法，每条连接配一个线程很直观；换成 Netty，线程数却通常不会跟连接数一起涨。那连接到底交给谁照看？我们就在项目里找答案。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

浏览器的一次访问、Java 客户端的控制连接、内网目标的连接，分别由哪个线程组处理？如果在 channelRead0 里查一个很慢的数据库，会拖住谁？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java) | `proxyServerCommonInitHandler` |
| [server / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/proxy/ProxyConfiguration.java) | `tcpServerBootstrap` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 连接很多，不等于线程很多

Reactor 可以先理解成“有事件了，再叫对应处理器做事”。在本项目的 TCP NIO 路径中，boss 接受连接，worker 管理已接入连接的读写事件。一个 EventLoop 会服务多条 Channel；所以 Handler 中的一段慢代码，可能让同一个 EventLoop 上的其他连接也排队。

先看接收访问者的线程组：

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

两个数量来自配置，并非源码里写死“一个 boss、八个 worker”。排查线程数时，要继续追配置绑定后的实际值。看到构造参数为 0，也不能解释成“不创建线程”，应核对所用 Netty 版本的默认行为。

### 把三类连接画到三个位置

| 连接 | 本项目入口 | 先关注的线程组 |
| --- | --- | --- |
| 访问者 → 服务端映射端口 | tcpServerBootstrap | tcpServerBossGroup / tcpServerWorkerGroup |
| Java 客户端 → 服务端隧道 | ProxyTunnelServer、cmdTunnelBootstrap | 服务端 tunnelBossGroup / tunnelWorkerGroup；客户端 tunnelWorkGroup |
| Java 客户端 → 内网目标 | tcpRealServerBootstrap | tcpRealServerWorkGroup |

服务端隧道的组装是这样：

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

调用链可以写成：Solon 加载结束 → startProxyServer → bind → 接受客户端连接 → initChannel → 安装 Pipeline → 收到字节 → 解码 → 分发。bind 是打开监听；后续每条连接才有自己的 Channel 和 Pipeline。

客户端也没有把全部连接硬塞进同一个对象：

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

注意“暂时先公用此配置”的含义：这里复用了线程数量配置，两个工厂方法仍分别 new 了线程组。配置相同，不等于实例相同。

### 跟着线程走一次，比背术语有效

在 TCP 默认 Pipeline 中，没有为业务 Handler 显式指定独立执行器，先按 Channel 所在 EventLoop 追踪。UDP 配置中却能看到 addLast 传入 udpServerWorkerGroup；不要把 TCP 的观察无条件套给所有协议。

这里也没有为每个消息处理器自动派发虚拟线程。后面看到同步 mapper、文件读取或长循环，要问的是“当前回调会占用多久”，而不是“用了 Netty 应该就不会阻塞”。

你可以先做一张线程草图，再用调试器验证。把连接 ID、线程名、Handler 名放到同一行，事件就容易串起来了。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：只在本地实验副本中，在 TcpVisitorChannelHandler.channelActive、客户端 RealServerChannelHandler.channelRead0 和控制连接接收处各设一个断点。用 01.01 的回环实验发起两条并行连接，记录线程名和 Channel ID；不要在共享环境挂起全部线程。

**怎么验收**：得到一张“线程名 → 多个 Channel ID”的记录，并能指出接受连接与处理读写的区别。再把断点改成只记录日志，避免暂停本身干扰心跳。本文给出源码推演；本轮未单独执行线程调度观测，01.01 的成功转发也不能证明线程模型在高负载下没有阻塞。

<span id="完善清单"></span>

## 合上代码前想一想

试着回答：两个配置相同的线程组为什么仍可能互不相同？一个 Channel 的回调有序，为什么不代表整个代理系统所有连接都按同一顺序执行？接着看 [Bootstrap 与 Future](/learn/netty-bootstrap/)，把“谁干活”连到“什么时候算干完”。
