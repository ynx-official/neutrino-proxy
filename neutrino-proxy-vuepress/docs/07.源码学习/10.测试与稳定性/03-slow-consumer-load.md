---
title: "10.03 慢消费者 大文件与并发压力"
date: 2026-10-30
permalink: /learn/slow-consumer-load/
article: false
status: Review
updated: 2026-10-30
lesson: "10.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    symbol: "channelWritabilityChanged"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    startLine: 33
    endLine: 43
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    startLine: 35
    endLine: 41
---

# 10.03 慢消费者 大文件与并发压力

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

有些问题不报错，只是传着传着内存越来越大。做压力实验时，别一上来就把并发拉满；先让一个目标慢下来，看清谁在排队，再逐步增加负载，结果才解释得通。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

吞吐降低是背压、限速还是目标处理慢？怎样证明大文件没有截断，又不会把实验机撑满？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [client / RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) | `channelRead0` |
| [client / TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java) | `channelWritabilityChanged` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先读暂停，再找恢复

看这段 [RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java#L33-L43)（原文件 33～43 行，连续原样节选）：

```java
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
```

目标响应侧看数据隧道可写状态，决定真实服务是否继续自动读取。另一条回调负责反馈：

看这段 [TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java#L35-L41)（原文件 35～41 行，连续原样节选）：

```java
    public void channelWritabilityChanged(ChannelHandlerContext ctx) throws Exception {
        Channel realServerChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
        if (realServerChannel != null) {
            realServerChannel.config().setOption(ChannelOption.AUTO_READ, ctx.channel().isWritable());
        }

        super.channelWritabilityChanged(ctx);
```

因此观察至少要有 isWritable、AUTO_READ、Channel ID 和时间。只看到一行“暂停”，无法解释有没有恢复；只看进程总内存，也分不清是 ByteBuf、数组、线程还是正常池缓存。

### 用阶梯实验建立因果关系

| 阶段 | 只改变这一项 | 重点记录 |
| --- | --- | --- |
| 基线 | 单连接、快速目标、固定数据 | 正常耗时与字节一致性 |
| 慢读 | 目标每次小块读取并延迟 | 可写状态、暂停/恢复、内存趋势 |
| 大载荷 | 增大有限总量 | 哈希、尾部完整、峰值 |
| 并发 | 1 → 2 → 4 条连接 | 各连接结果、总吞吐、线程/句柄 |
| 恢复 | 取消目标延迟 | 能否继续完成，资源是否收敛 |

比如先从每条 256 KiB、4 条以内开始，确认实验设备有余量后再定下一档。这里的数值是教学起点，不是产品容量承诺。

### 传输正确性要比“一共跑了多久”更早检查

发送端用固定随机种子生成二进制，接收端读到预定总长或明确 EOF，计算哈希。不要把一次 recv 当成整条消息，也不要只比较开始的几十个字节。

如果发送和接收在同一个线程里交替进行，可能人为制造死锁或掩盖双向积压；要明确客户端写入、目标读取与响应读取各由谁驱动。

### 指标能证明多少，就说多少

内存不立刻回到起点可能是池和 JVM 行为，不能凭一次截图断言泄漏；持续增长且多轮回不到稳定范围，才更值得继续拆堆、直接内存与连接数量。

同样，低吞吐不能单独证明限速有效。目标慢、链路反馈、日志过多和暂停调试器都会影响结果。当前源码本身也留有高水位反馈不及时的 TODO，所以大载荷实验应保留失败证据，不以“理论有背压”代替实测。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在 01.01 的实验副本中增加慢读 Echo，载荷固定、并发有上限，分别记录正常、慢读、恢复三个阶段。每次结束停止子进程，检查端口和连接句柄回落；遇到内存持续增加先停负载保留指标。

**已有实测**：65536 字节正常往返一致。**尚未执行**：大文件、多轮压力、慢消费者恢复与容量测试。验收至少包含最终哈希、暂停恢复事件、峰值及结束后资源，不能从小样本推导吞吐上限或生产容量。

<span id="完善清单"></span>

## 合上代码前想一想

如果吞吐很低但没有 AUTO_READ 变化，你会先找什么证据？为什么缓存内存未立刻下降，和资源泄漏不是同一个判断？接着看 [资源排障](/learn/resource-diagnostics/)。
