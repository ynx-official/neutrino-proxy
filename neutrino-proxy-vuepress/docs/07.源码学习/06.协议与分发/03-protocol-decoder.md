---
title: "06.03 长度字段拆包与增量解码"
date: 2026-10-30
permalink: /learn/protocol-decoder/
article: false
status: Review
updated: 2026-10-30
lesson: "06.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    symbol: "decode"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfig.java"
    symbol: "ProxyConfig"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 22
    endLine: 24
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 42
    endLine: 56
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 63
    endLine: 74
---

# 06.03 长度字段拆包与增量解码

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

TCP 很像一条不断到货的字节传送带。你写了一帧，对面一次 read 不一定恰好收到一帧。这篇先把“怎么等齐”讲清楚，再看“齐了以后怎么解释”，两个问题别混在一起。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

只到了长度字段的一半怎么办？一次来了两帧怎么办？父类完成分帧后，项目代码还需要验证哪些内部长度？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java) | `decode` |
| [client / ProxyConfig.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfig.java) | `ProxyConfig` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 第一层：让父类找到完整帧

看这段 [ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java#L22-L24)（原文件 22～24 行，连续原样节选）：

```java
    public ProxyMessageDecoder(int maxFrameLength, int lengthFieldOffset, int lengthFieldLength, int lengthAdjustment,
            int initialBytesToStrip) {
        super(maxFrameLength, lengthFieldOffset, lengthFieldLength, lengthAdjustment, initialBytesToStrip);
```

ProxyMessageDecoder 继承 LengthFieldBasedFrameDecoder，配置来自两端的 protocol。基础实验采用 maxFrameLength=2048、offset=0、lengthFieldLength=4、adjustment=0、strip=0 这组小范围参数。

offset=0 表示长度从开头读取；长度字段占 4；adjustment=0 配合编码器“长度不含自己”的约定；strip=0 保留长度字段，让子类还可以 readInt。参数组合必须与帧结构一起理解，单独背这五个数字没什么用。父类的设计说明见 [Netty 官方 API](https://netty.io/4.1/api/io/netty/handler/codec/LengthFieldBasedFrameDecoder.html)。

### 第二层：解释这帧里的字段

看这段 [ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java#L42-L56)（原文件 42～56 行，连续原样节选）：

```java
        ByteBuf in = (ByteBuf) super.decode(ctx, in2);
        if (in == null) {
            return null;
        }

        if (in.readableBytes() < HEADER_SIZE) {
            return null;
        }

        int frameLength = in.readInt();
        if (in.readableBytes() < frameLength) {
            return null;
        }
        ProxyMessage proxyMessage = new ProxyMessage();
        byte type = in.readByte();
```

super.decode 返回 null，表示目前还没有可处理的完整帧，等待后续输入。它返回 ByteBuf 之后，子类再读 frameLength、type、流水号等内容。因为 strip=0，第一步 readInt 正好读保留下来的外层长度；若只把 strip 改为 4，后面的读取就全部错位。

注意 HEADER_SIZE 在本项目中是 4，只表示外层长度字段。它不是整个固定消息头所需的 17 字节；因此 readableBytes >= HEADER_SIZE 并不等价于内部字段一定齐全。

### 等齐了，不代表内容合法

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

infoLength 直接用于分配数组，dataLength 则通过减法得到。若 infoLength 为负数或超过帧剩余内容，即使外层长度已经凑齐，也仍会失败。

本轮用小型畸形帧实际观察到：infoLength=-1 触发 NegativeArraySizeException，1024 则触发 IndexOutOfBoundsException，经 DecoderException 包装。实验还发现清理后引用计数比诊断持有的 1 多出一个，具体见[记录](/labs/foundations-result.json)。所以这里不能只写一句“父类处理好了半包，因此解码器可靠”。

### 两种边界要分别验收

网络分片测试回答“正确字节被拆开或拼在一起时，结果是否相同”；畸形字段测试回答“内容不合法时，是否按预期拒绝并清理”。两者不是同一种测试。

本轮已实际验证逐字节输入直到最后一个字节才产出完整消息，连续两帧按顺序还原。对于异常资源清理，我们保留观察结果，未修改业务代码；不能把“抛出异常”当作“异常路径已处理妥当”。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：运行基础实验后，找到 one_byte_fragments_wait_for_complete_frame 和 concatenated_frames_decode_in_order。然后把相同帧按 2/3/其余字节分三次输入，逐次查看是否产出 ProxyMessage；finally 中结束并释放 EmbeddedChannel。

**怎么验收**：完整、逐字节、连续多帧三种输入应得到相同业务字段且不多出消息。长度头超限测试已经实测在收到 4 字节长度后拒绝，无需先分配巨大载荷。异常 infoLength 的资源问题作为观察单列；本轮不声称修复。

<span id="完善清单"></span>

## 合上代码前想一想

你能解释 strip=0 为什么和子类 readInt 成对出现吗？如果外层长度正确、infoLength 却错了，父类能帮多少忙？下一篇 [Dispatcher](/learn/protocol-dispatcher/) 接过已经还原的对象。
