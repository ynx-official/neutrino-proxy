---
title: "05.05 写缓冲水位与 AUTO_READ 背压"
date: 2026-10-30
permalink: /learn/netty-backpressure/
article: false
status: Review
updated: 2026-10-30
lesson: "05.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    symbol: "channelWritabilityChanged"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 70
    endLine: 75
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    startLine: 35
    endLine: 41
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    startLine: 70
    endLine: 77
---

# 05.05 写缓冲水位与 AUTO_READ 背压

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

内网目标突然慢下来，代理还在拼命读取外部上传，数据总要找个地方堆着。背压要做的事很具体：下游吃不动时，先让上游少读一点；恢复时，再把开关打开。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

到底应该检查哪条 Channel 的 isWritable，又应该关闭哪条 Channel 的 AUTO_READ？暂停后由谁负责恢复？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [client / TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java) | `channelWritabilityChanged` |
| [client / RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) | `channelRead0` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 两条连接，两个开关，别看反了

假设 A 收到数据后写给 B。B 的写缓冲积压时，需要暂停的是 **A 的读取**。如果只暂停 B 的读取，你反而影响了反方向，没解决当前堆积。

服务端接到访问者数据时：

看这段 [TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L70-L75)（原文件 70～75 行，连续原样节选）：

```java
        // 代理通道可写，则设置访问通道可读。代理通道不可写，则设置访问通道不可读
        visitorChannel.config().setAutoRead(proxyChannel.isWritable());

        // 转发代理数据
        String visitorId = ProxyUtil.getVisitorIdByChannel(visitorChannel);
        proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));
```

visitorChannel 是上游输入；proxyChannel 是发往客户端的数据隧道。代码检查 proxyChannel.isWritable，再把结果设给 visitorChannel.autoRead。这里是在收到本批数据后检查和设置，已经读到的 bytes 仍会继续写出，所以它不是“内存永远不超过水位”的硬上限。

写缓冲水位影响可写状态，高低水位用于在暂停与恢复间留出余量；AUTO_READ 影响自动读取。具体接口可看 [Netty ChannelConfig](https://netty.io/4.1/api/io/netty/channel/ChannelConfig.html)。内核 socket 缓冲和已排队任务也仍可能持有数据。

### 最容易漏的是恢复路径

客户端隧道可写状态变化后：

看这段 [TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java#L35-L41)（原文件 35～41 行，连续原样节选）：

```java
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {
        Channel realServerChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
        if (realServerChannel != null) {
            realServerChannel.config().setOption(ChannelOption.AUTO_READ, ctx.channel().isWritable());
        }

        super.channelWritabilityChanged(ctx);
```

这里通过 NEXT_CHANNEL 找到内网真实服务连接，把后者的 AUTO_READ 设成当前隧道的可写状态。这负责“内网响应 → 隧道”方向的暂停与恢复。

反方向也有对应逻辑：

看这段 [RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java#L70-L77)（原文件 70～77 行，连续原样节选）：

```java
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {
        Channel realServerChannel = ctx.channel();
        Channel proxyChannel = realServerChannel.attr(Constants.NEXT_CHANNEL).get();
        if (proxyChannel != null) {
            proxyChannel.config().setOption(ChannelOption.AUTO_READ, realServerChannel.isWritable());
        }

        super.channelWritabilityChanged(ctx);
```

真实服务连接的写缓冲决定隧道要不要继续读。两段组合起来才形成双向约束；单独看到一个 setAutoRead(false)，只能证明有暂停动作，不能证明一定恢复。

### 第一次暂停其实不是背压

回头看 TcpVisitorChannelHandler.channelActive：访问者刚接入时就被设为不可读，等待客户端建立内网目标和数据隧道关联。这个暂停发生在业务转发准备阶段，目的是别在 NEXT_CHANNEL 还没建立时把请求读进来。

而 channelRead0 中的暂停，发生在转发进行中，目的是限制下游积压。两个动作都改 AUTO_READ，但触发条件、恢复点和排障方向不同。实验时应在日志中标明“等待关联”还是“写缓冲压力”，否则很容易把没连通误判成下游太慢。

### 水位与限速也不是同一件事

背压跟着下游可消费能力变化；固定字节速率限制则由项目的 flowLimiter 等逻辑负责。把水位调低可能更早暂停读取，但不会自动变成准确的每秒限速，也不会解决所有堆内存增长。

真正有用的验收是：慢目标时内存和队列可控、目标恢复后能继续、最终字节一致。仅看吞吐降下来，无法证明背压正确。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：使用 01.01 的回环环境，把 Echo 目标改为每次最多读 1 KiB、间隔 20 ms 的教学版本，限制总载荷例如 256 KiB。记录两端 Channel ID、isWritable、AUTO_READ 和收到的字节数；随后取消延迟，确认传输能完成。不要用无限上传制造不可控堆积。

**怎么验收**：要观察到暂停与恢复成对出现，并核对最终载荷或哈希一致；若未触发水位，记录“本次未触发”，不要补写一个预期事件。这个慢目标实验尚未执行。01.01 已实测 65536 字节往返一致，只证明其正常场景，不能替代背压压力验证。

<span id="完善清单"></span>

## 合上代码前想一想

画两根箭头试试：隧道不可写时暂停谁？真实服务不可写时又暂停谁？想明白以后，再去 [协议帧结构](/learn/protocol-frame/) 看每批字节是怎么装箱的。
