---
title: "07.01 隧道监听与控制数据连接入口"
date: 2026-10-30
permalink: /learn/server-tunnel/
article: false
status: Review
updated: 2026-10-30
lesson: "07.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    symbol: "proxyServerCommonInitHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java"
    symbol: "channelRead0"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    startLine: 47
    endLine: 51
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    startLine: 125
    endLine: 134
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java"
    startLine: 45
    endLine: 49
---

# 07.01 隧道监听与控制数据连接入口

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

前面我们把消息拆到字节级，现在回到服务端门口：Java 客户端来了，先被谁接住？控制连接和数据连接是不是开了两个端口？从这个入口读下去，很多命名上的困惑会一起消掉。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

同一个隧道监听，为什么既能收到 AUTH 又能收到 TRANSFER？服务端在哪一层识别一条 Channel 的用途？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java) | `proxyServerCommonInitHandler` |
| [server / ProxyTunnelChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java) | `channelRead0` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先区分三个“端口”

| 端口角色 | 谁来访问 | 传的是什么 |
| --- | --- | --- |
| 管理 HTTP 端口 | 管理页面、配置请求 | HTTP 管理 API |
| 隧道端口 | Java 客户端的控制与数据连接 | ProxyMessage |
| 映射端口 | 外部业务访问者 | 被代理业务的原始字节 |

隧道端口和映射端口都可能运行在同一个服务端进程里，但它们装的 Pipeline 不一样。不要拿管理 API 正常当成隧道正常，也不要向隧道端口直接发送 HTTP 请求来验证业务映射。

### 应用加载结束后再打开门

看这段 [ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java#L47-L51)（原文件 47～51 行，连续原样节选）：

```java
	public void onEvent(AppLoadEndEvent appLoadEndEvent) throws Throwable {
        // aot 阶段，不启动代理服务
        if (NativeDetector.isNotAotRuntime()) {
            startProxyServer();
            startProxyServerForSSL();
```

服务端监听挂在 AppLoadEndEvent。AOT 分析阶段跳过实际启动，运行时才启动普通隧道，并按配置决定是否启动 SSL 隧道。普通监听和 SSL 监听有各自的 bind；SSL 端口未配置时对应方法直接返回。

这里的起点与 HTTP Controller 不同。客户端消息没有先到某个 /user 接口，而是由 Netty 收取二进制消息后进入自己的分发体系。

### 接进来以后，先经过同一套处理器

看这段 [ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java#L125-L134)（原文件 125～134 行，连续原样节选）：

```java
	private void proxyServerCommonInitHandler(SocketChannel ch) {
		if (null != proxyConfig.getTunnel().getTransferLogEnable() && proxyConfig.getTunnel().getTransferLogEnable()) {
			ch.pipeline().addFirst(new LoggingHandler(ProxyTunnelServer.class));
		}
		ch.pipeline().addLast(new ProxyMessageDecoder(proxyConfig.getProtocol().getMaxFrameLength(),
			proxyConfig.getProtocol().getLengthFieldOffset(), proxyConfig.getProtocol().getLengthFieldLength(),
			proxyConfig.getProtocol().getLengthAdjustment(), proxyConfig.getProtocol().getInitialBytesToStrip()));
		ch.pipeline().addLast(new ProxyMessageEncoder());
		ch.pipeline().addLast(new IdleStateHandler(proxyConfig.getProtocol().getReadIdleTime(), proxyConfig.getProtocol().getWriteIdleTime(), proxyConfig.getProtocol().getAllIdleTimeSeconds()));
		ch.pipeline().addLast(new ProxyTunnelChannelHandler());
```

每条普通隧道连接都安装解码、编码、空闲检测和 ProxyTunnelChannelHandler。SSL 路径在共同初始化之前额外安装 SslHandler。传输日志则按配置放在链前面，学习时不需要开启包含实际凭证的详细转储。

控制连接首先发 AUTH，业务数据连接稍后发 CONNECT 来绑定访问者；两者都从这个监听入口进来。它们不是由两个不同的 ProxyTunnelChannelHandler 类区分的。

### 消息类型与连接属性一起说明角色

看这段 [ProxyTunnelChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java#L45-L49)（原文件 45～49 行，连续原样节选）：

```java
    protected void channelRead0(ChannelHandlerContext ctx, ProxyMessage proxyMessage) throws Exception {
        if (ProxyMessage.TYPE_HEARTBEAT != proxyMessage.getType() || transferLogEnable) {
            log.debug("Server CmdChannel recieved proxy message, type is {}", proxyMessage.getType());
        }
        dispatcher.dispatch(ctx, proxyMessage);
```

此处主要按消息类型分发，业务 Handler 再设置 LICENSE_ID、VISITOR_ID、NEXT_CHANNEL 或控制连接的附加对象。后面的断开处理也会读取这些关联判断清理范围。

于是完整入口链是：AppLoadEndEvent → bind → initChannel → Decoder → ProxyTunnelChannelHandler → Dispatcher → AUTH / CONNECT / TRANSFER 等处理器。端口提供入口，type 表达当前消息，Channel 属性保存已建立的会话关系。

这套结构容易读，但也要求你继续审查：每种消息允许出现在哪个连接状态？不能只因为共用入口，就推断所有消息都已经经过同一套认证。具体检查要落到每个 Handler。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：用 01.01 的本地实验分别记下管理端口、隧道端口和两个映射端口。在服务端的 AUTH 与 CONNECT Handler 记录不含凭证的 Channel ID、消息类型和属性是否存在，比较控制连接和数据连接。

**怎么验收**：能解释为什么同一隧道端口会出现多个不同 Channel ID，并区分它们与访问者的连接。本文入口链经过源码核对；完整逐连接角色日志本轮尚未新增实测。已有端到端实验验证正常转发，不等于验证所有非法消息顺序。

<span id="完善清单"></span>

## 合上代码前想一想

如果管理页正常而隧道 bind 失败，你该从哪里查？如果看到一个 TRANSFER，它是否必然来自最初发 AUTH 的那条控制连接？继续读 [License 认证](/learn/server-authentication/)。
