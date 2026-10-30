---
title: "06.02 编码器如何计算长度并写入字段"
date: 2026-10-30
permalink: /learn/protocol-encoder/
article: false
status: Review
updated: 2026-10-30
lesson: "06.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    symbol: "encode"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java"
    symbol: "buildAuthMessage"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    startLine: 21
    endLine: 33
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    startLine: 35
    endLine: 46
---

# 06.02 编码器如何计算长度并写入字段

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

协议长度算错一个字节，常常表现为“第一次能连，第二次就乱了”。这篇不追求技巧，陪你把 Encoder 的加法做完：每加一次长度，后面都必须有对应的字节写入。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

为什么不能用 info.length() 算长度？length 字段到底包含谁？null 和空数组经过编码后还能区分吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java) | `encode` |
| [core / ProxyMessage.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java) | `buildAuthMessage` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先算完整，再写出去

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

固定部分是 type 的 1 字节、serialNumber 的 8 字节、infoLength 的 4 字节，合起来 13。info 转成字节后再加长度，data 也按数组长度加入。外层长度字段自己的 4 字节没有算在 bodyLength 中，这和注释、后面的 Decoder 是配套的。

这里用的是 getBytes()，没有显式字符集参数。因此学习时请说“当前实验 JVM 以 UTF-8 运行”，不要把 UTF-8 写成这段代码显式声明的协议保证。基础脚本启动 Java 时固定了 file.encoding=UTF-8；跨语言对齐时也应把字符集作为兼容条件写清楚。

### 字符个数和字节个数是两本账

以 info 为“你好”、data 为 4 字节为例，在 UTF-8 条件下：

- info 的 Java 字符串长度为 2，但编码占 6 字节。
- bodyLength = 13 + 6 + 4 = 23。
- 整帧 = 4 + 23 = 27 字节。

这个 27 字节已经由实际 Encoder 实测。若错用字符串长度 2，Decoder 会把边界算错，问题会影响后续帧，而不只是显示乱码。

### 写出顺序就是协议本身

看这段 [ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java#L35-L46)（原文件 35～46 行，连续原样节选）：

```java
        out.writeByte(msg.getType());
        out.writeLong(msg.getSerialNumber());

        if (infoBytes != null) {
            out.writeInt(infoBytes.length);
            out.writeBytes(infoBytes);
        } else {
            out.writeInt(0x00);
        }

        if (msg.getData() != null) {
            out.writeBytes(msg.getData());
```

写完固定字段后，info 存在就写长度和内容，不存在就写 0。data 存在才写 bytes。由于没有额外的 null 标记，null info 与空字符串会编码成同样的长度；解码后得到空字符串。null data 和空数组同样没有单独的线格式标记。

这也是兼容性测试不应直接对两个 Java 对象做所有字段完全相等的原因。可以分别比较 type、serialNumber、规范化后的 info 和 data 字节，明确哪些差异来自协议表达能力。

### 它没有替上层做业务验证

Encoder 接受 ProxyMessage 后按字段写出，没有在这里验证 License、visitorId、目标地址，也没有自动检查某个消息类型必须附带什么字段。编码成功只证明它能生成一段字节。

还可以追问一个工程问题：bodyLength 是 int 连续相加，超大输入时的容量与溢出边界在哪里？本轮没有用巨大数组尝试内存耗尽；后面的边界课只用有上限的小数据检查异常长度。学习时把“值得设计约束”与“已经复现”分开。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在 EmbeddedChannel 中依次送入心跳、info 为“你好”且 data 为 4 字节的消息、data 包含 0x00～0xff 的消息。读取输出 ByteBuf 后打印十六进制和 readableBytes，最后释放；也可以先跑 python scripts/learning/foundations_lab.py。

**已有实测**：心跳 17 字节、中文加 4 字节 data 共 27 字节、二进制载荷 roundtrip 均通过，见[基础实验结果](/labs/foundations-result.json)。这些是小型本地样本，不覆盖所有字符集组合、超大消息或整数溢出。验收时逐项对上长度加法与实际写入位置。

<span id="完善清单"></span>

## 合上代码前想一想

现在把代码合上：bodyLength 的初始值为什么是 13？空字符串和 null 在协议里还能分辨吗？下面去 [Decoder](/learn/protocol-decoder/)，看看它如何等齐一帧。
