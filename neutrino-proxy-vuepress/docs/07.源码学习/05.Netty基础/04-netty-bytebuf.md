---
title: "05.04 ByteBuf 引用计数与释放责任"
date: 2026-10-30
permalink: /learn/netty-bytebuf/
article: false
status: Review
updated: 2026-10-30
lesson: "05.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    symbol: "decode"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    startLine: 21
    endLine: 46
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 63
    endLine: 74
---

# 05.04 ByteBuf 引用计数与释放责任

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

Java 有 GC，为什么这里还到处谈 release？因为 ByteBuf 管理的缓冲区可能来自池或堆外内存，生命周期不只取决于 Java 引用还在不在。我们先找项目里是谁消费了字节，再讨论性能优化。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

RealServerChannelHandler 没写 release，会泄漏吗？Decoder 写了 release，就能保证所有错误路径都释放吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java) | `decode` |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [client / RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) | `channelRead0` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先看继承关系，再找 release

看这段 [RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java#L21-L46)（原文件 21～46 行，连续原样节选）：

```java
public class RealServerChannelHandler extends SimpleChannelInboundHandler<ByteBuf> {


    @Override
    protected void channelRead0(ChannelHandlerContext ctx, ByteBuf buf) throws Exception {
        Channel realServerChannel = ctx.channel();
        Channel proxyChannel = realServerChannel.attr(Constants.NEXT_CHANNEL).get();
        if (null == proxyChannel) {
            // 代理客户端连接断开
            ctx.channel().close();
        } else {

            if (proxyChannel.isWritable()) {
                if (!realServerChannel.config().isAutoRead()) {
                    realServerChannel.config().setAutoRead(true);
                }
            } else {
                if (realServerChannel.config().isAutoRead()) {
                    realServerChannel.config().setAutoRead(false);
                }
            }

            byte[] bytes = new byte[buf.readableBytes()];
            buf.readBytes(bytes);
            String visitorId = ProxyUtil.getVisitorIdByRealServerChannel(realServerChannel);
            proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));
```

关键藏在第一行：`SimpleChannelInboundHandler<ByteBuf>`。默认自动释放已接受的入站消息，所以正常执行 channelRead0 后，原始 buf 由基类负责释放。这里先复制到 byte[]，再交给 ProxyMessage；后续消息不再依赖原始 ByteBuf 的那块内存。

这也解释了一个常见误改：看到方法里没有 release，就补一个 finally release，可能造成重复释放。要先看处理器基类、是否改过自动释放选项，以及消息有没有被 retain 或转交。

[Netty 官方引用计数说明](https://netty.io/wiki/reference-counted-objects.html)可以帮你建立基本规则：使用共享缓冲区时，要能说清每个引用由谁持有、由谁最终释放。本文项目路径的结论仍以以上源码为依据。

### 复制有成本，也让所有权更清楚

项目选择把可读字节复制成数组。这会增加数组分配和内存复制，换来相对直接的资源边界：原 ByteBuf 在回调后结束使用，数组跟随 ProxyMessage。

如果想改成 slice 或 retainedSlice，先别只看吞吐数字。slice 通常共享内容，retainedSlice 还增加引用计数；异步写出、失败和取消时都需要相应释放。共享之后，在原回调结束后继续用一块已被释放的内存，就会出问题。

### Decoder 这条路需要单独审视

看这段 [ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java#L63-L74)（原文件 63～74 行，连续原样节选）：

```java
        int infoLength = in.readInt();
        byte[] infoBytes = new byte[infoLength];
        in.readBytes(infoBytes);
        proxyMessage.setInfo(new String(infoBytes));

        byte[] data = new byte[frameLength - TYPE_SIZE - SERIAL_NUMBER_SIZE - INFO_LENGTH_SIZE - infoLength];
        in.readBytes(data);
        proxyMessage.setData(data);

        in.release();

        return proxyMessage;
```

Decoder 从父类获得一帧，复制 info 和 data，正常路径末尾 release。注意措辞：**正常路径**。如果 infoLength 异常导致数组分配或读取抛错，代码未用 finally 包住这块帧；前面的提前 return 也值得单独核对。不能看到一个 release 就宣布错误路径全覆盖。

这不是让你现在改协议实现，而是练习建立资源账本：

| 资源 | 正常路径中的去向 | 还要追问什么 |
| --- | --- | --- |
| RealServer 入站 buf | 基类自动释放 | 是否被异步持有 |
| Decoder 提取出的帧 | 方法末尾手动释放 | 提前返回、异常时谁释放 |
| ProxyMessage.data 数组 | Java 对象引用 | 大量并发时的堆内存成本 |

### 先把计数变化跑明白

当前工作区的 scripts/learning/FoundationsLab.java 是随课程新增的教学工具，调用实际依赖，不属于课程固定的历史源码基线。实验中对 retainedSlice 的计数变化已记录为 2 → 1 → 0，见[本次基础实验结果](/labs/foundations-result.json)。这个小实验说明共享计数的行为，不能证明全部代理路径都没有泄漏。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在仓库根目录运行 `python scripts/learning/foundations_lab.py`，脚本直接使用 `neutrino-proxy-server/target/neutrino-proxy-server.jar`，缺少时先按 01.03 构建。再在独立的教学 EmbeddedChannel 中写一个消费 ByteBuf 的 SimpleChannelInboundHandler，检查回调前后 refCnt；所有实验缓冲区最终清理。

**已有实测**：基础实验中 retainedSlice 共享计数、释放回到 1、最后释放为 0 三项已通过。后续补测的 infoLength=-1 和 1024 均触发异常，Channel 清理后仍比诊断持有的 1 多一个引用，工具最终手动释放。这个观察提示所测异常路径存在释放缺口，详见 [协议边界实验](/learn/protocol-boundary-tests/)；本轮未修改解码器。

<span id="完善清单"></span>

## 合上代码前想一想

把“谁创建、谁转交、谁最后释放”写清楚，再考虑减少复制。复习一下：为什么 byte[] 不用 release，而 ByteBuf 可能要？为什么自动释放的 Handler 里异步持有消息需要额外设计？下一篇看 [背压](/learn/netty-backpressure/)，继续追慢连接会把数据积在哪里。
