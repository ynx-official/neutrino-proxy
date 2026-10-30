---
title: "05.03 Pipeline 入站 出站与 Handler 生命周期"
date: 2026-10-30
permalink: /learn/netty-pipeline/
article: false
status: Review
updated: 2026-10-30
lesson: "05.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "cmdTunnelBootstrap"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    symbol: "userEventTriggered"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 91
    endLine: 96
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    startLine: 37
    endLine: 41
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    startLine: 91
    endLine: 105
---

# 05.03 Pipeline 入站 出站与 Handler 生命周期

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

Pipeline 初看像一串 addLast，容易产生一个误会：所有事情都按从上到下执行。其实读进来、写出去、触发事件，走法并不完全一样。我们拿客户端控制连接这条短链练练手。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

同一个 Pipeline 里为什么既有 Decoder 又有 Encoder？CmdChannelHandler 写出的 ProxyMessage，经过哪里才变成字节？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `cmdTunnelBootstrap` |
| [client / CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java) | `userEventTriggered` |
| [client / RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) | `channelRead0` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先给每一站标上方向

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L91-L96)（原文件 91～96 行，连续原样节选）：

```java
                ch.pipeline().addLast(new ProxyMessageDecoder(proxyConfig.getProtocol().getMaxFrameLength(),
                        proxyConfig.getProtocol().getLengthFieldOffset(), proxyConfig.getProtocol().getLengthFieldLength(),
                        proxyConfig.getProtocol().getLengthAdjustment(), proxyConfig.getProtocol().getInitialBytesToStrip()));
                ch.pipeline().addLast(new ProxyMessageEncoder());
                ch.pipeline().addLast(new IdleStateHandler(proxyConfig.getProtocol().getReadIdleTime(), proxyConfig.getProtocol().getWriteIdleTime(), proxyConfig.getProtocol().getAllIdleTimeSeconds()));
                ch.pipeline().addLast(new CmdChannelHandler());
```

按角色画，不要只抄类名：

| 处理器 | 这条链上的作用 |
| --- | --- |
| ProxyMessageDecoder | 入站：字节分帧并还原 ProxyMessage |
| ProxyMessageEncoder | 出站：ProxyMessage 编成字节 |
| IdleStateHandler | 观察读写空闲并产生事件 |
| CmdChannelHandler | 接收消息、分发业务，处理空闲与关闭 |

入站大体由前往后，出站由后往前；沿途只经过实现了对应方向能力的处理器。ctx 发起的传播从当前上下文附近继续，channel 发起的写则从 Pipeline 尾部找出站处理器。详细规则可对照 [Netty 官方 Pipeline 文档](https://netty.io/4.1/api/io/netty/channel/ChannelPipeline.html)。在线 API 对应更新的 4.1 小版本，本课程项目代码仍固定在基线版本。

### 收到消息后，并没有再往后传一遍

看这段 [CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java#L37-L41)（原文件 37～41 行，连续原样节选）：

```java
    protected void channelRead0(ChannelHandlerContext ctx, ProxyMessage proxyMessage) throws Exception {
        if (ProxyMessage.TYPE_HEARTBEAT != proxyMessage.getType() || transferLogEnable) {
            log.debug("[CMD Channel]Client CmdChannel recieved proxy message, type is {}", proxyMessage.getType());
        }
        Solon.context().getBean(Dispatcher.class).dispatch(ctx, proxyMessage);
```

这里收到的已经是 ProxyMessage。它交给项目 Dispatcher，不再调用 fireChannelRead。也就是说，这个 Handler 在本条业务链中消费了消息；“Pipeline 上还有下一站”不等于消息一定会自动到那里。

把调用链写成一句话：Socket 字节 → Decoder → CmdChannelHandler.channelRead0 → Dispatcher → 按消息类型匹配的业务 Handler。Encoder 不参与这次入站对象的读取；它等待业务向外写消息。

### 心跳是事件驱动的另一条支线

看这段 [CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java#L91-L105)（原文件 91～105 行，连续原样节选）：

```java
    public void userEventTriggered(ChannelHandlerContext ctx, Object evt) throws Exception {
        if(evt instanceof IdleStateEvent) {
            IdleStateEvent event = (IdleStateEvent)evt;
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

WRITER_IDLE 分支通过 channel.writeAndFlush 发出心跳对象，出站经过 Encoder。READER_IDLE 则关闭连接。这里的 userEventTriggered 没有在结尾调用 super 或 fireUserEventTriggered；不要画成所有用户事件都会继续透传到后续处理器。

“有心跳”也不等于目标服务健康。控制链路的空闲事件，无法替你证明内网 HTTP 服务返回正常。后面读客户端心跳时，我们会把这两个状态拆开。

### Handler 为什么在 initChannel 里 new

这段配置为每条 Channel 安装新的 CmdChannelHandler。按连接创建处理器，有利于隔离处理器的实例状态。不过本项目业务还会访问全局 ProxyUtil，所以“Handler 实例独立”也不代表所有数据天然隔离。

再看生命周期：channelActive 对应连接激活，channelInactive 对应失活，exceptionCaught 处理异常。异常处理是否关闭连接、是否继续传播，得看各类自己的实现；不要拿其中一个 Handler 的策略替代全项目。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在实验副本中分别给 Decoder.decode、CmdChannelHandler.channelRead0、一个 AUTH 业务 Handler 和 Encoder.encode 设置非挂起日志断点。只用临时 License 建立一次控制连接，再等待写空闲，按时间记录消息与事件的先后。

**怎么验收**：能画出一条入站 AUTH 响应和一条出站心跳的不同走向，并指出消息被消费的位置。此处是待执行的事件观察；已有基础实验只直接调用真实编解码器，不代表完整 Pipeline 的生命周期已被验证。

<span id="完善清单"></span>

## 合上代码前想一想

如果把一个只实现入站接口的处理器放到 Encoder 后面，它会参与出站编码吗？为什么 channel.writeAndFlush 与 ctx.writeAndFlush 的起点值得留意？带着这些问题继续看 [ByteBuf 的释放](/learn/netty-bytebuf/)。
