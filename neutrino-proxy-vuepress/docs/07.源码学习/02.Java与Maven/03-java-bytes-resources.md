---
title: "02.03 字节 编码 异常与资源所有权"
date: 2026-10-30
permalink: /learn/java-bytes-resources/
article: false
status: Review
updated: 2026-10-30
lesson: "02.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    symbol: "encode"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    symbol: "decode"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    symbol: "borrowTcpProxyChanel"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    startLine: 21
    endLine: 33
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 63
    endLine: 72
---

# 02.03 字节 编码 异常与资源所有权

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

平时写 JSON 接口，字符串和对象替我们挡住了不少字节细节。到了代理里，长度算错一位、缓冲少释放一次，都可能表现得很奇怪。我们先挑一个中文字符和一小段二进制数据，把它们送进真正的编码器。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

“中”看起来是一个字符，那协议里该给它填长度 1 还是 3？如果你觉得得先问编码方式，那已经抓住关键了。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java) | `encode` |
| [core / ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java) | `decode` |
| [client / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java) | `borrowTcpProxyChanel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 长度字段认的是字节

看这段 [ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java#L21-L33)（原文件 21～33 行，连续原样节选）：

```java
        int bodyLength = TYPE_SIZE + SERIAL_NUMBER_SIZE + INFO_LENGTH_SIZE;
        byte[] infoBytes = null;
        if (msg.getInfo() != null) {
            infoBytes = msg.getInfo().getBytes();
            bodyLength += infoBytes.length;
        }

        if (msg.getData() != null) {
            bodyLength += msg.getData().length;
        }

        // write the total packet length but without length field's length.
        out.writeInt(bodyLength);
```

编码器先算固定字段，再加 info 编码后的字节数与 data 长度。注意 `getBytes()` 没显式写字符集；讲当前代码时，不能悄悄把它改成另一个版本再当成原样节选。

本次小实验明确用 UTF-8 启动 JVM。“中”是 3 字节；“你好”是 6 字节。我们的帧还带 4 字节二进制 data，因此总长度是外层长度字段 4，加 type 1、流水号 8、info length 4、info 6、data 4，总共 27 字节。写进 bodyLength 的则是 23，不含它自己的 4 字节。

这么算一遍，很多“服务端为什么还在等数据”的现象就有了具体检查点：到底把字符数当了字节数，还是把外层长度多算或少算了？

### 解码也要按同一份约定走

看这段 [ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java#L63-L72)（原文件 63～72 行，连续原样节选）：

```java
        int infoLength = in.readInt();
        byte[] infoBytes = new byte[infoLength];
        in.readBytes(infoBytes);
        proxyMessage.setInfo(new String(infoBytes));

        byte[] data = new byte[frameLength - TYPE_SIZE - SERIAL_NUMBER_SIZE - INFO_LENGTH_SIZE - infoLength];
        in.readBytes(data);
        proxyMessage.setData(data);

        in.release();
```

先读 infoLength，再取这么多字节构造字符串，剩下的部分作为 data。最后释放这次拿到的帧缓冲。

这条正常路径能看懂以后，再去问边界：infoLength 是负数会怎样？比帧剩余长度更大呢？中途抛异常，谁负责释放？本篇先把这些问题留在脑中，到[协议边界测试](/learn/protocol-boundary-tests/)用畸形帧去验证。看到末尾有 release，并不代表每条异常路径已经被证明覆盖。

### ByteBuf 的拥有者 要跟数据一起追

Java 有 GC，但 Netty 的引用计数缓冲有自己的生命周期。你拿着一个共享切片，并不等于独占了一份新内存。普通 slice 和 retainedSlice 的引用计数语义也不同。

教学实验里，我们申请父缓冲，再取 retainedSlice。计数变成 2，释放切片回到 1，最后释放父缓冲才到 0。你可以把它当作一张“这份内存还有谁在用”的账。

真正写 Handler 时，要结合处理器类型看：有的入站处理器会自动释放，有的需要你显式传递或释放。别在没确认所有权之前，看到缓冲就补一个 release；重复释放和漏释放都可能出问题。

### 异常处理也有资源边界

从 ByteBuf 读出 byte[]，会多出一次复制。它让消息对象更容易在业务处理里使用，也有分配与复制成本。这个项目确实存在这样的转换，因此我们先按真实实现解释，再到性能课程讨论是否值得优化。

同一个思路也适用于文件流和证书输入流：谁创建、谁接手、正常结束谁关闭、异常时谁关闭。把这四个问题写在调用链旁边，比单看一个 try/catch 更有帮助。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：手算一帧长度，再让项目编解码器和缓冲实验核对答案。

运行：

```powershell
python scripts/learning/foundations_lab.py
```

在[实际记录](/labs/foundations-result.json)里找 encoded_frame_is_27_bytes、partial_frame_waits、project_codec_roundtrip，以及 retained_slice_shares_count、release_returns_count_to_one、last_release_reaches_zero。这些检查已通过，调用的是项目真实编码器、解码器与 Netty 缓冲对象。

你可以先在纸上把 info 换成空字符串、data 换成 0 字节，重新算一次总长度，再在教学实验里增加一个独立断言。预期数值要先算出来，别把“实际跑出的数字”直接复制成期望值。

<span id="完善清单"></span>

## 合上代码前想一想

- **一条消息用两次 recv 才收齐，是不是协议坏了？** TCP 提供字节流，拆包器需要处理这种输入。
- **为什么 retainedSlice 后父缓冲的计数也变化？** 两者关联到同一份引用计数资源。
- **接下来去哪儿？** [06.01](/learn/protocol-frame/)会把这次的长度计算放回完整消息表。
