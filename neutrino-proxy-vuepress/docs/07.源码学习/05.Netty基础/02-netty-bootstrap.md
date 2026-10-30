---
title: "05.02 Bootstrap Channel 与异步 Future"
date: 2026-10-30
permalink: /learn/netty-bootstrap/
article: false
status: Review
updated: 2026-10-30
lesson: "05.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    symbol: "proxyServerCommonInitHandler"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 69
    endLine: 79
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 93
    endLine: 112
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    startLine: 73
    endLine: 76
---

# 05.02 Bootstrap Channel 与异步 Future

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

日志里出现 connect proxy server success，先别急着宣布穿透成功。它可能只说明 TCP 已接通，License 还没验，内网目标也还没连。读异步代码时，最有用的习惯就是追问：这次成功，具体成功了哪一步？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

Bootstrap 配好了，为什么还没有连接？connect 返回了，为什么业务仍可能失败？sync 和监听器分别在等待、处理什么？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java) | `proxyServerCommonInitHandler` |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先把“配方”和“这一次连接”拆开

Bootstrap 保存线程组、Channel 类型、远端地址和初始化逻辑。你可以把它当成连接的配方；真正调用 connect 才发起连接，连接上的状态属于本次创建的 Channel。

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L69-L79)（原文件 69～79 行，连续原样节选）：

```java
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

上面的几个 option 目前被注释掉了。阅读时别把注释中的 3000 毫秒连接超时、KEEPALIVE 或 TCP_NODELAY 当成已启用配置。真正生效的值要继续找配置与框架默认值。

服务端则使用 ServerBootstrap。bind 的目标是本地监听地址；客户端 connect 的目标是远端地址。两者都可能异步完成，但创建的是不同角色的 Channel。

### success 日志离“业务可用”还有几站

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L93-L112)（原文件 93～112 行，连续原样节选）：

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
						log.info("[CmdChannel] connect proxy server success. channelId:{}", future.channel().id().asLongText());

//						reconnectServiceEnable = true;
						reconnectCount = 0;
					} else {
						log.info("[CmdChannel] connect proxy server failed!");
					}
				}
			}).sync();
```

按顺序读这段：

1. connect 发起 TCP 连接，返回 ChannelFuture。
2. Future 成功后取到 Channel，保存控制连接。
3. 写出 AUTH 消息，然后打印连接成功。
4. 认证结果要由另一条入站消息处理；它不会自动包含在本次 connect 的成功里。

更细一点，writeAndFlush 返回的写 Future 这里也没有作为“认证通过”的依据。即使写入完成，也只是这次写操作完成，不能替代对端的业务响应。

方法末尾的 sync 会等待连接 Future 完成，失败时也可能抛异常。因此这里同时有监听器的成功/失败分支、调用方 catch 的异常路径。看见 addListener，不能立刻判断整个调用不会阻塞。

### sync 能用，但要看站在哪里

服务启动时也用了等待：

看这段 [ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java#L73-L76)（原文件 73～76 行，连续原样节选）：

```java
			bootstrap.bind(proxyConfig.getTunnel().getPort()).sync();
			log.info("proxy server started，port：{}", proxyConfig.getTunnel().getPort());
		} catch (Exception e) {
			log.error("proxy server error", e);
```

这表示启动逻辑等待 bind 完成，随后才打印监听成功。它没有在这里等待 closeFuture，也没有把所有后续连接都阻塞住。

把同样的阻塞等待随手搬到该 Channel 的 EventLoop 回调里，就需要警惕：你可能占住完成该操作需要的线程，甚至触发框架的阻塞检查。判断依据是调用线程和 Future 对应的执行过程，不是单看方法名。

### 失败也要分层记录

| 看到的现象 | 首先检查 |
| --- | --- |
| connect 被拒绝 | 远端监听、地址和本地网络 |
| connect 成功但 AUTH 失败 | License 与服务端认证返回 |
| AUTH 成功但访问失败 | 映射、目标可达性、数据隧道关联 |
| bind 失败 | 本机端口占用、绑定地址和权限 |

所以实验记录最好写“控制连接 TCP 成功，认证尚待确认”，而不是只有一个绿色的“启动成功”。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：沿用 01.01 的临时环境，先在服务端正常监听时观察 connect Future，再停止对应本地监听后重试，记录 isSuccess 和 cause。另开一组只使用虚构错误 License 的测试，比较 TCP 成功与业务认证失败。超时实验需在隔离网络中设置可控丢弃规则，不能拿随便一个外网 IP 代替。

**怎么验收**：三列记录分别写 TCP 连接、认证响应、目标连接的结果和耗时。拒绝连接通常比连接超时更快，但以实际异常和计时为准。本篇没有新增拒绝/超时实测记录；01.01 仅提供已有端到端证据。

<span id="完善清单"></span>

## 合上代码前想一想

如果 Future 成功后立刻发出 AUTH，为什么不能把 connect 的回调叫作“认证回调”？能说清这一点，就可以继续看 [Pipeline](/learn/netty-pipeline/)，找到认证响应从哪里回来。
