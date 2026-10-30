---
title: "06.05 协议边界与跨语言测试向量"
date: 2026-10-30
permalink: /learn/protocol-boundary-tests/
article: false
status: Review
updated: 2026-10-30
lesson: "06.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    symbol: "encode"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    symbol: "decode"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java"
    startLine: 32
    endLine: 36
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 63
    endLine: 72
---

# 06.05 协议边界与跨语言测试向量

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

写协议测试时，最容易有一种错觉：编码再解码相等，就万事大吉。可如果编码器和解码器一起犯了同一个错，它们也能很开心地互相理解。我们把测试拆成几层，让证据更扎实一点。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

哪些断言能发现长度算错，哪些能发现分片问题，哪些只能观察异常？已有结果又能支持多大的结论？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java) | `encode` |
| [core / ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java) | `decode` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先测格式，再测往返

看这段 [ProxyMessageEncoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageEncoder.java#L32-L36)（原文件 32～36 行，连续原样节选）：

```java
        // write the total packet length but without length field's length.
        out.writeInt(bodyLength);

        out.writeByte(msg.getType());
        out.writeLong(msg.getSerialNumber());
```

格式测试应独立断言：最小帧 17 字节，bodyLength 为 13，type 偏移 4，流水号占 8 字节。再给一组手工期望字节，防止两个实现一起偏移了还彼此兼容。

往返测试则比较可观察语义：中文 info 的编码长度、任意 binary data、null 与空字符串的规范化。serialNumber 可以手动设成非 0，避免默认值掩盖没读没写的问题。

### 分片不靠运气

不要用 socket 恰巧拆包来证明半包处理。EmbeddedChannel 能控制每次输入的字节数，更容易重复。

| 输入方式 | 期待观察 |
| --- | --- |
| 完整一帧 | 产出一个消息 |
| 长度头只有 2 字节 | 暂无消息 |
| 整帧逐字节输入 | 最后一个字节到齐才产出 |
| 两帧拼接 | 顺序产出两个消息 |
| 二进制 0x00～0xff | 每个字节保持一致 |

这些场景已经通过当前基础实验调用真实项目编解码器执行。工具位于 scripts/learning/FoundationsLab.java 和 foundations_lab.py；它们是新增教学工具，不属于固定历史源码基线的原始实现。

### 异常结果别涂成绿色安全结论

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

表面上这里有 release；问题是读取中途抛异常时，正常末尾还走不走得到？

本轮使用只含 17 字节的畸形帧，在 infoLength=-1 和 1024 时分别观察到负数组长度、越界异常。工具额外保留一个诊断引用；Channel 清理完成后，refCnt 实际为 2，预期仅诊断引用应为 1。工具最后手动释放所有剩余引用，避免教学过程留下资源。

这支持“所测异常路径有额外引用未释放”的结论，不能扩大为所有输入都会泄漏，也不能缩成“抛异常所以已安全拒绝”。改进方向可以是先验证内部长度、用 finally 保证帧释放；那属于后续修复任务，应先补回归用例再改实现。本轮保留原实现和观察。

### 把证据放到能重跑的位置

在仓库根目录执行：

```powershell
mvn -B -pl neutrino-proxy-server -am package
python scripts/learning/foundations_lab.py --report "$env:TEMP/np-foundations-result.json"
```

脚本仅从本地 JAR 提取 class 与依赖到临时目录，不提取应用资源，不启动 Solon 主程序、数据库或网络。运行记录包含 JDK、JAR 哈希与源码提交；新改过的教学脚本以当前工作区为准。

当前[结果文件](/labs/foundations-result.json)含 25 项检查和两条异常资源观察。“25 项符合断言”并不表示“协议通过完整安全审查”。这是学习如何准确写结论的一部分。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先重跑现有矩阵，再在教学副本增加 ASCII info、中文 info、空 data 三组显式期望字节。把断言分成“当前行为记录”和“未来修复期望”，不要把尚未修复的资源断言改成永远接受泄漏。

**怎么验收**：能复述 25 项已执行检查的范围，并单独说明两条 refCnt 观察。巨大数组、随机模糊测试、真实 TLS 互操作与长时间压测均未执行。工具通过只代表这些小型确定性检查完成；网络异常仍需后面的端到端实验。

<span id="完善清单"></span>

## 合上代码前想一想

如果一个 roundtrip 测试通过，但手工字节向量失败，你会信谁、查哪里？如果异常正确抛出了，资源检查却失败，该怎么写测试报告？接着进入 [服务端 TCP 链路](/learn/server-tunnel/)。
