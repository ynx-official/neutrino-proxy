---
title: "08.04 TCP 转发与多访问者隔离"
date: 2026-10-30
permalink: /learn/client-forwarding/
article: false
status: Review
updated: 2026-10-30
lesson: "08.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    symbol: "channelWritabilityChanged"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    symbol: "borrowTcpProxyChanel"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java"
    startLine: 23
    endLine: 32
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    startLine: 43
    endLine: 46
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    startLine: 134
    endLine: 143
---

# 08.04 TCP 转发与多访问者隔离

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

同一个 Java 客户端可能替很多访问者同时转发。它们共享进程、线程组和一些全局集合，但业务字节不能串线。这篇从最短的转发方法出发，检查隔离到底靠什么。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

请求怎么找到真实目标，响应怎么找到隧道？visitorId 和 NEXT_CHANNEL 分别承担什么查找任务？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) | `channelRead0` |
| [client / TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java) | `channelWritabilityChanged` |
| [client / ProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java) | `handle` |
| [client / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java) | `borrowTcpProxyChanel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 请求依赖已绑定的数据隧道

看这段 [ProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java#L23-L32)（原文件 23～32 行，连续原样节选）：

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

收到服务端 TRANSFER 后，当前数据隧道的 NEXT_CHANNEL 指向真实目标。取到目标后，按其可写状态控制隧道自动读取，再把载荷复制到 ByteBuf 写出。

这里没把所有请求塞进同一个全局“当前目标”字段，而是沿每条 Channel 的属性找对应连接。两组访问者要隔离，关键是建连时的成对绑定正确，关闭时不误删另一组关系。

### 响应从真实目标沿原路回去

看这段 [RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java#L43-L46)（原文件 43～46 行，连续原样节选）：

```java
            byte[] bytes = new byte[buf.readableBytes()];
            buf.readBytes(bytes);
            String visitorId = ProxyUtil.getVisitorIdByRealServerChannel(realServerChannel);
            proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));
```

RealServerChannelHandler 前面先取得目标连接上的 NEXT_CHANNEL，没有则关闭真实连接。正常情况下，目标读到的字节进入新的 TRANSFER，visitorId 也从该真实连接的属性取得。

于是多访问者的分组方式是：每次业务真实连接 + 对应数据隧道 + visitorId。共享 EventLoop 不等于共享字节流；它只是让同一线程轮流处理不同连接事件。

### 全局表主要帮会话管理

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java#L134-L143)（原文件 134～143 行，连续原样节选）：

```java
	public static Channel getRealServerChannel(String userId) {
		return realServerChannels.get(userId);
	}

	public static void addRealServerChannel(String userId, Channel realServerChannel) {
		realServerChannels.put(userId, realServerChannel);
	}

	public static Channel removeRealServerChannel(String userId) {
		return realServerChannels.remove(userId);
```

参数名字在这里叫 userId，但调用方传入的是 visitorId。读代码时请沿调用方确定含义，别据此误认为每个后台用户只能有一个真实目标连接。

realServerChannels 是 ConcurrentHashMap，用于按访问者保存、移除和统一清理真实连接。并发容器保障单次操作，不自动保证“设置双向属性、插入 map、发远程绑定”这些复合步骤成为同一个原子动作。后续失败清理仍需要按会话身份核对。

### 用带身份的载荷测试，串线更明显

两个访问者都发 hello，错连了也可能恰好收回 hello。更有效的教学载荷是 A 序列号 + A 随机数据、B 序列号 + B 随机数据，分别核对回包来源、长度和哈希。

再让 A 提前关闭，确认 B 仍完成转发；这比只测两条连接都成功，更能暴露全局清理误伤。转发顺序只需在各自 TCP 字节流里保持，不能要求两个独立访问者的回调具有统一全局顺序。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在同一映射端口创建 A、B 两条连接，分别发送带唯一前缀和序列号的二进制数据。A 发送一半后主动关闭，B 继续完成并核对哈希。记录 visitorId 与两端 Channel 关系，避免只用相同短字符串。

**怎么验收**：A、B 的内容不交叉，A 关闭不影响 B，结束后各自关系被移除。基础实验已有任意字节的 codec roundtrip，01.01 有健康映射不受另一个坏目标影响的证据；同端口并发隔离与取消实验本轮尚未执行。

<span id="完善清单"></span>

## 合上代码前想一想

为什么 map 参数名不能代替调用链证据？如果某条消息没找到 NEXT_CHANNEL，应该先查读写方法，还是先查之前的绑定与清理？下一篇 [心跳与空闲](/learn/client-heartbeat/) 看连接为什么会被判断失活。
