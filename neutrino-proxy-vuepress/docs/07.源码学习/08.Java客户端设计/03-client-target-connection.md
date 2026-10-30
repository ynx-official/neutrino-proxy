---
title: "08.03 内网目标连接与异步绑定"
date: 2026-10-30
permalink: /learn/client-target-connection/
article: false
status: Review
updated: 2026-10-30
lesson: "08.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 33
    endLine: 48
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 164
    endLine: 170
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 68
    endLine: 77
---

# 08.03 内网目标连接与异步绑定

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

控制连接收到 CONNECT 后，客户端要做的事不是“转发到本机固定端口”，而是按消息里的目标地址发起一次连接。它成功以后，还要再拿到数据隧道，才能把两边绑起来。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

目标连接成功与数据隧道成功，是一个 Future 吗？如果第二步失败，第一步创建的资源由谁收回？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | `handle` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 目标地址来自服务端命令

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L33-L48)（原文件 33～48 行，连续原样节选）：

```java
		final Channel cmdChannel = ctx.channel();
		final String visitorId = proxyMessage.getInfo();
		String[] serverInfo = new String(proxyMessage.getData()).split(":");
		String ip = serverInfo[0];
		int port = Integer.parseInt(serverInfo[1]);
		// 连接真实的、被代理的服务
		realServerBootstrap.connect(ip, port).addListener(new ChannelFutureListener() {

			@Override
			public void operationComplete(ChannelFuture future) throws Exception {

				// 连接后端服务器成功
				if (future.isSuccess()) {
					final Channel realServerChannel = future.channel();

					realServerChannel.config().setOption(ChannelOption.AUTO_READ, false);
```

info 提供 visitorId，data 按文本拆成 ip 和 port。当前实现直接 split(":")，适合理解普通 host:port，却不能自然表达带冒号的 IPv6 字面量。也没有在这段代码里用结构化 schema 完成字段范围检查。

目标是从客户端所在网络去连接的地址。配置成 localhost，指的是客户端本机；不是公网服务端，也不是访问者的机器。遇到“服务端能 curl 通，但客户端转发不通”，先确认这几个网络位置。

### 两个异步操作，两个失败点

realServerBootstrap.connect 成功后，先把真实服务 AUTO_READ 关闭，再调用 borrowTcpProxyChanel。后者可能取池中连接，也可能新建数据隧道。成功才设置双向 NEXT_CHANNEL、发远程绑定消息、恢复真实服务读取。

Bootstrap 来自这里：

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L164-L170)（原文件 164～170 行，连续原样节选）：

```java
    @Bean("realServerBootstrap")
    public Bootstrap realServerBootstrap(@Inject ProxyConfig proxyConfig,
                                             @Inject("tcpRealServerWorkGroup") NioEventLoopGroup tcpRealServerWorkGroup
                                             ) {
        Bootstrap bootstrap = new Bootstrap();
        bootstrap.group(tcpRealServerWorkGroup);
        bootstrap.channel(NioSocketChannel.class);
```

它使用独立的 tcpRealServerWorkGroup，安装 RealServerChannelHandler，并不安装隧道编解码器。真实目标看到的是原业务字节，不应该看到 ProxyMessage 的 17 字节固定外壳。

### 第二步失败，别只看通知

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L68-L77)（原文件 68～77 行，连续原样节选）：

```java
						public void error(Throwable cause) {
							ProxyMessage proxyMessage = new ProxyMessage();
							proxyMessage.setType(ProxyMessage.TYPE_DISCONNECT);
							proxyMessage.setInfo(visitorId);
							cmdChannel.writeAndFlush(proxyMessage);
						}
					});

				} else {
					cmdChannel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));
```

目标连接失败时向控制连接发送 DISCONNECT；借取数据隧道失败也走通知。但借取失败的回调中，没有显式关闭此前已建立并暂停读取的 realServerChannel。后续是否由其他事件清理，要继续追踪，不能只说“失败会自动回滚”。

这和数据库事务很不同：第一条 socket 成功、第二条 socket 失败，不存在隐含的跨连接回滚。资源所有者需要在每个失败、取消和超时分支明确收尾。

此外，这些失败通知最终能否关闭服务端访问者，仍受 [服务端 DISCONNECT 查找方式](/learn/server-disconnection/) 影响；目前真实实验中的 3 秒及时关闭检查未通过。

### 连接成功后仍要防迟到

如果访问者等待期间已经离开，客户端的目标连接稍后才成功，会不会继续建立一条没人使用的隧道？当前片段没有统一的取消令牌或会话代次检查。你可以把它作为后续状态机设计问题，不必现在凭空说项目已经解决。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在实验副本中准备三组可控条件：目标端口未监听；目标可连接但数据隧道监听已关闭；目标与隧道都正常。每组记录创建和关闭的 Channel ID、AUTO_READ 状态、错误通知发出的通道。总等待设定明确超时。

**已有实测**：目标不可达时，服务端访问者未在 3 秒内及时关闭。**待执行**：目标已成功、借取隧道失败时的真实服务连接回收，以及访问者提前取消的迟到回调。只在本地临时环境制造故障，不用生产映射做实验。

<span id="完善清单"></span>

## 合上代码前想一想

你能为两个连接的成功、失败、取消各画一条收尾线吗？为什么“发了 DISCONNECT”不足以证明 realServerChannel 已经释放？接着看 [多访问者转发](/learn/client-forwarding/)。
