---
title: "03.02 配置绑定 依赖注入与 Bean 组装"
date: 2026-10-30
permalink: /learn/solon-injection/
article: false
status: Review
updated: 2026-10-30
lesson: "03.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java"
    symbol: "dataSource"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfig.java"
    symbol: "ProxyConfig"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "ProxyClientService"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfig.java"
    startLine: 19
    endLine: 25
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 66
    endLine: 79
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 27
    endLine: 33
---

# 03.02 配置绑定 依赖注入与 Bean 组装

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

一眼看到好几个 Bootstrap，还都叫“客户端配置”，确实容易串。与其把注解名字背一遍，不如追一个具体对象：cmdTunnelBootstrap 是谁创建的，它读了哪份配置，又被交给谁使用？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

同一个类型注册了好几份对象时，只写一个类型名够不够？你会怎么告诉容器“这次我要控制连接用的那一份”？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / DbConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java) | `dataSource` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |
| [client / ProxyConfig.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfig.java) | `ProxyConfig` |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `ProxyClientService` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先看配置是怎样进对象的

看这段 [ProxyConfig.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfig.java#L19-L25)（原文件 19～25 行，连续原样节选）：

```java
public class ProxyConfig {
	@Inject("${neutrino.proxy.protocol}")
	private Protocol protocol;
	@Inject("${neutrino.proxy.tunnel}")
	private Tunnel tunnel;
	@Inject("${neutrino.proxy.client}")
	private Client client;
```

Protocol、Tunnel、Client 分别对应三块配置。这里是把配置片段注入到对象字段，再由其他组件读取。名字相近时，包名和嵌套类型可以帮你认路。

有个值得保持的小警觉：看见字段存在，并不等于当前运行值一定有效。配置可能缺失、值可能不在业务允许范围，使用处仍需要检查。客户端的 start 就会检查必要的服务端地址和 License 等字段。

读配置时，最好一次只追一个键。比如从 tunnel.server-port 走到 Tunnel.serverPort，再走到 Bootstrap.remoteAddress；别一上来试图把所有可选参数都塞进脑袋。

### 配置类负责组装网络对象

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L66-L79)（原文件 66～79 行，连续原样节选）：

```java
    @Bean("cmdTunnelBootstrap")
    public Bootstrap cmdTunnelBootstrap(@Inject ProxyConfig proxyConfig,
                                        @Inject("tunnelWorkGroup") NioEventLoopGroup tunnelWorkGroup) {
        Bootstrap bootstrap = new Bootstrap();
        bootstrap.group(tunnelWorkGroup);
        bootstrap.channel(NioSocketChannel.class);
//		bootstrap.option(ChannelOption.CONNECT_TIMEOUT_MILLIS, 3000);
//		bootstrap.option(ChannelOption.SO_KEEPALIVE, true);
//		/**
//		 * TCP/IP协议中，无论发送多少数据，总是要在数据前面加上协议头，同时，对方接收到数据，也需要发送ACK表示确认。为了尽可能的利用网络带宽，TCP总是希望尽可能的发送足够大的数据。（一个连接会设置MSS参数，因此，TCP/IP希望每次都能够以MSS尺寸的数据块来发送数据）。
//		 * Nagle算法就是为了尽可能发送大块数据，避免网络中充斥着许多小数据块。
//		 */
//		bootstrap.option(ChannelOption.TCP_NODELAY, true);
        bootstrap.remoteAddress(InetSocketAddress.createUnresolved(proxyConfig.getTunnel().getServerIp(), proxyConfig.getTunnel().getServerPort()));
```

Bean 名字明确写成 cmdTunnelBootstrap。方法参数上的注入拿到 ProxyConfig 与指定线程组，返回的 Bootstrap 则已经选定 Channel 类型和远端地址，后面还会继续设置 Pipeline。

这里很像装配一件工具：配置是规格，线程组是共用的工作资源，Bootstrap 是创建连接的配置对象。不要把 Bootstrap 本身和一条已经建立的 Channel 当成同一个东西。

有些网络选项在这段里被注释掉了。读代码时要分清“项目讨论过”与“当前生效”；别把注释中的超时或 keepalive 参数抄成实际运行配置。

### 名字把它交到了正确的使用者手里

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L27-L33)（原文件 27～33 行，连续原样节选）：

```java
public class ProxyClientService {
	@Inject
	private ProxyConfig proxyConfig;
	@Inject("cmdTunnelBootstrap")
	private Bootstrap cmdTunnelBootstrap;
	@Inject("udpServerBootstrap")
	private Bootstrap udpServerBootstrap;
```

ProxyClientService 明确要求名为 cmdTunnelBootstrap 的 Bean。UDP 那一份则用另一个名字。这种具名注入，让同类型的组装结果能够分清用途。

现在回到开头的问题：谁创建、谁使用？创建在 ProxyConfiguration 的 Bean 方法；使用在 ProxyClientService 的连接流程。你已经可以不用猜，就把“配置 → 网络对象 → 业务入口”画出来了。

如果还要往下追，下一站是这个 Bootstrap 的 ChannelInitializer：SSL、解码器、编码器、空闲检查和控制 Handler 会按顺序进入 Pipeline。组装和真正收发事件分开读，会清爽很多。

### 长得一样的注解 也要看看来处

服务端数据库部分还有一个容易看岔的地方：DbConfiguration 中的 Db 来自 MyBatis 的 Solon 集成包，DBInitialize 中的 Db 则来自 Wood。它们名字一样，服务的注入对象不同。

所以我会给“读 import”留一个小位置。它通常只花几秒，却能避免把另一套框架的经验强套进来。特别是碰到熟悉的注解名时，更值得核对一次。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：挑一个配置键，追完从输入到使用的整条路径。

建议选 tunnel.server-port 或 tunnel.thread-count：

1. 从客户端资源配置中的键开始，定位 ProxyConfig 对应字段。
2. 找到读取它的 Bean 方法，记录 Bean 名字、返回类型和所需线程组。
3. 再找到具名注入的位置，继续追到 connect 或其他真正使用它的调用。

预期你能画出至少四个节点，并解释 Bootstrap 与 Channel 的区别。这个练习是源码推演，不启动外部数据库；网络实际往返的已有证据在 [01.01](/learn/project-overview/)。完整配置来源优先级要结合加载路径另查，本篇没有把一个参数的覆盖过程扩展成所有键的统一结论。

<span id="完善清单"></span>

## 合上代码前想一想

- **只看 Bootstrap 这个类型，能分清控制、数据和目标连接吗？** 要把 Bean 名字与组装逻辑一起看。
- **看到注释里的超时配置能当成生效值吗？** 不能，先确认它是否在执行路径里。
- **接下来换一条入口？** [03.03](/learn/solon-http-api/)看看普通管理请求怎样进来。
