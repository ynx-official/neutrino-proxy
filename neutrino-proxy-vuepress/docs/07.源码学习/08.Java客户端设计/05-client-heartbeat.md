---
title: "08.05 读写空闲 心跳与超时语义"
date: 2026-10-30
permalink: /learn/client-heartbeat/
article: false
status: Review
updated: 2026-10-30
lesson: "08.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    symbol: "userEventTriggered"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    symbol: "channelWritabilityChanged"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageHeartbeatHandler.java"
    symbol: "ProxyMessageHeartbeatHandler"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    startLine: 94
    endLine: 105
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    startLine: 91
    endLine: 98
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageHeartbeatHandler.java"
    startLine: 21
    endLine: 22
---

# 08.05 读写空闲 心跳与超时语义

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

心跳不是让连接永远活着的魔法。它更像一个定期问候：最近没写东西，发一个小消息；太久没收到东西，再决定要不要断开。项目里控制连接与数据连接的决定还不完全相同。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

READER_IDLE 与 WRITER_IDLE 各自意味着什么？为什么数据隧道的读超时还要检查 isWritable？心跳正常能证明目标服务健康吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java) | `userEventTriggered` |
| [client / TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java) | `channelWritabilityChanged` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |
| [server / ProxyMessageHeartbeatHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageHeartbeatHandler.java) | `ProxyMessageHeartbeatHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 空闲是事件，策略在 Handler 里

IdleStateHandler 按配置观察读、写、读写空闲，随后触发 IdleStateEvent。客户端资源配置中，read-idle-time 为 120 秒，write-idle-time 为 20 秒，all-idle-time-seconds 为 0；这是当前默认资源值，部署覆盖后要看实际绑定值。

控制连接的处理如下：

看这段 [CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java#L94-L105)（原文件 94～105 行，连续原样节选）：

```java
            switch (event.state()) {
                case READER_IDLE:
                    // 读超时，断开连接
                    log.error("[CMD Channel] Read timeout disconnect");
                    ctx.channel().close();
                    break;
                case WRITER_IDLE:
                    ctx.channel().writeAndFlush(ProxyMessage.buildHeartbeatMessage());
                    break;
                case ALL_IDLE:
                    log.error("[CMD Channel] ReadWrite timeout disconnect");
                    ctx.close();
```

读空闲关闭、写空闲发心跳、全空闲关闭。默认 allIdle 为 0 时不启用这类定时检测；代码里保留分支不代表默认一定触发。

“读空闲”表示这段时间没发生被检测的读事件，并不精确等价于“对端进程一定死了”。网络丢弃、线程被阻塞、读被暂停都可能影响观察。

### 数据隧道考虑了背压导致的停读

看这段 [TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java#L91-L98)（原文件 91～98 行，连续原样节选）：

```java
            switch (event.state()) {
                case READER_IDLE:
                    if (ctx.channel().isWritable()) {
                        // 读超时，断开连接
                        log.info("[TCP Proxy Channel]Read timeout");
                        ctx.channel().close();
                    }
                    break;
```

TcpProxyChannelHandler 在 READER_IDLE 时还检查当前 Channel 是否可写。完整方法中 WRITER_IDLE 也发心跳，而 ALL_IDLE 的关闭逻辑被注释。它与控制连接策略不同，不能用一张统一“超时必关闭”的表替代。

这个判断反映一个实际矛盾：为了背压暂停读取时，不能简单把没读到数据全当作网络死亡。但一个 isWritable 判断是否覆盖了全部暂停场景，还需要实验；源码意图不能替代恢复正确性的证据。

### 问候要有回应，但别脑补无限互相发送

服务端 HEARTBEAT Handler：

看这段 [ProxyMessageHeartbeatHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageHeartbeatHandler.java#L21-L22)（原文件 21～22 行，连续原样节选）：

```java
	public void handle(ChannelHandlerContext ctx, ProxyMessage proxyMessage) {
		ctx.channel().writeAndFlush(ProxyMessage.buildHeartbeatMessage());
```

它收到心跳会发回心跳。客户端搜索中没有对应的 HEARTBEAT 业务处理器，因此收到的心跳经过 Decoder、触发读取活动后，在 Dispatcher 中没有同名处理器就返回；不是两边收到一次就无限互相回发。

实际会话还可能因普通业务字节更新读写活跃度。因此测试心跳时，要记录业务是否持续流动，不能看着空闲计时器就忽略其他流量。

### 目标健康需要另一种证据

隧道能收发心跳，最多支持这条链路近期有活动；内网目标是否可连接、HTTP 是否返回正确内容，仍需业务探测。把心跳灯直接画成“所有映射正常”，会给用户错误期待。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在本地副本把空闲阈值改成可观察的短值，例如写空闲 2 秒、读空闲 6 秒，停止业务流量，记录事件时间与心跳方向。再用可控代理只丢弃服务端响应，观察读空闲。实验结束恢复副本配置，避免把测试阈值带入部署。

**怎么验收**：区分主动发心跳、收到响应、读超时和业务失败，记录实际误差而非要求毫秒精确。当前未执行这组短阈值和丢包实验；已有正常转发记录不证明超时策略在暂停读取时全部正确。

<span id="完善清单"></span>

## 合上代码前想一想

为什么不应把 readIdle 时间理解成精准故障检测时限？为什么客户端收到服务端心跳后不需要再无条件回复？继续读 [定时重连](/learn/client-reconnection/)。
