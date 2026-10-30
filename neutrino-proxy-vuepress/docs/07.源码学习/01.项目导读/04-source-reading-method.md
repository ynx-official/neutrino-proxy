---
title: "01.04 调用链阅读与断点记录方法"
date: 2026-10-30
permalink: /learn/source-reading-method/
article: false
status: Review
updated: 2026-10-30
lesson: "01.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 104
    endLine: 106
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    startLine: 83
    endLine: 89
---

# 01.04 调用链阅读与断点记录方法

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

你可能也遇到过：点进一个方法，跟了几次跳转，突然掉进框架源码，原来的请求反而找不到了。读这个项目，我建议先选一条请求当主线。我们不追求一次看懂所有类，先把这一条请求带回家。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

同样叫 ProxyMessageConnectHandler，为什么 server 和 client 各有一份？如果只看 IDE 标签页里的类名，你能确认现在站在哪一侧吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [client / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | `handle` |
| [server / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java) | `handle` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先给自己一个小到能追完的问题

比如：“访问者刚连上映射端口，server 怎么知道应该通知哪个客户端？”这个问题有清晰的入口：`TcpVisitorChannelHandler.channelActive`。

先记录三个坐标：server 模块、当前 Handler、当前 Channel。再看它从本地端口找 CmdChannel、取目标地址、生成 visitorId。到这里，一条具体的行为已经被圈住了。

暂时遇到 `CacheUtil`、日志格式化或者字符串辅助方法，可以先记下输入输出，把阅读继续往前推。它们可能值得研究，但不必同时变成今天的主问题。

### 用 visitorId 跨过进程边界

看这段 [TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L104-L106)（原文件 104～106 行，连续原样节选）：

```java
        String visitorId = ProxyUtil.newVisitorId();
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.TCP, cmdChannel, visitorId, visitorChannel, sa.getPort());
        cmdChannel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId).setData(lanInfo.getBytes()));
```

这三行可以当作一次追踪的“接力棒”：visitorId 被生成、写进关联关系，再跟 CONNECT 一起发给客户端。

接下来去 client 包里的同名 CONNECT Handler。拿到消息后，先看 info 和 data 分别读出了什么，再看目标连接的异步回调。你会发现：IDE 的 Java 调用栈不会自动穿过网络替你跳到另一进程，这一段需要用消息字段手动接上。

把阅读记录写成一条短链就够了：

```text
server: visitorId 生成
  → CmdChannel 发送 CONNECT
  → client: CONNECT Handler 读取 visitorId
  → client: 连接目标，建立数据通道
  → server: 数据通道 CONNECT 找回访问者
```

这条箭头描述的是事件顺序，不保证发生在同一线程。看到 `addListener` 时，停半秒，问问自己：“现在是发起操作，还是结果已经回来了？”

### 认清“谁是当前 Channel”

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java#L83-L89)（原文件 83～89 行，连续原样节选）：

```java
		ctx.channel().attr(Constants.VISITOR_ID).set(visitorId);
		ctx.channel().attr(Constants.LICENSE_ID).set(licenseDO.getId());
		ctx.channel().attr(Constants.NEXT_CHANNEL).set(visitorChannel);
		visitorChannel.attr(Constants.NEXT_CHANNEL).set(ctx.channel());
        visitorChannel.attr(Constants.LICENSE_ID).set(licenseDO.getId());
        // 代理客户端与后端服务器连接成功，修改用户连接为可读状态
		visitorChannel.config().setOption(ChannelOption.AUTO_READ, true);
```

这里站在 server 的数据连接处理器里。`ctx.channel()` 是刚来报到的数据连接，`visitorChannel` 则是先前等待的访问者。两个 NEXT_CHANNEL 互相绑定之后，后面的数据处理器才能找到下一跳。

别把这段记成“CONNECT 一定就是创建连接”。它的含义还取决于消息来自控制通道还是数据通道、现在由哪一侧处理。把方向和通道一起写进笔记，会比单记一个消息类型牢靠得多。

### 断点不用多 但每个都要有问题

| 断点位置 | 到这里想确认什么 |
| --- | --- |
| server 的 visitor channelActive | 本地端口、CmdChannel、目标地址是否对应 |
| client 的 CONNECT Handler | info / data 里是不是同一个 visitorId 和目标 |
| 目标连接成功回调 | 目标真的连通了吗，还是仍在发起阶段 |
| server 的数据 CONNECT Handler | 找到了哪个访问者，NEXT_CHANNEL 指向谁 |
| 两侧 TRANSFER Handler | 请求和响应分别走向哪个下一跳 |

想看线程变化时，把线程名也抄进去。Handler 属于哪个 EventLoop，不必靠脑补；调试器和日志都能给出具体对象与线程。

### 也给失败路径画一条线

最容易误读的地方，往往藏在注释和当前执行代码之间。前面的实验已经留下不可达目标的超时结果。此时别急着把“客户端发送了 DISCONNECT”推导成“访问者已经关闭”。

继续追：消息经哪个通道发出，服务端断开处理器从哪个 Channel 属性取访问者，取不到时怎么返回，谁还会移除旧映射。先把事实串完整，再讨论修复。这样得到的学习笔记，才不会只描述理想流程。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：为同一次访问写一张六行的追踪卡。

1. 使用 [01.03](/learn/local-debugging/) 的本地测试配置；自己做断点实验时只用测试 License，别把认证值抄进笔记。
2. 依次记录：所在模块、方法、当前 Channel 角色、visitorId、NEXT_CHANNEL、线程名。
3. 从连接进入跟到第一段响应，再补一条目标连接失败时的事件线。哪些位置只有源码推演、哪些真的命中过断点，分别标清。

预期你能把同一个 visitorId 在两端对应起来，并说明绑定前后 AUTO_READ 的变化。本节提供的是断点练习方法；已有集成实测见 [01.01](/learn/project-overview/)，不把这些建议断点写成已经逐个命中过的调试记录。

<span id="完善清单"></span>

## 合上代码前想一想

- **为什么不要先按目录把所有类通读一遍？** 小问题更容易形成闭环，也更容易发现缺了哪一步。
- **为什么记录 Channel 角色，而不只记录变量名？** 不同处理器里的 ctx.channel() 可以属于不同阶段。
- **下一步补什么？** [02.01](/learn/java-abstractions/)会把 Handler、泛型和注解这几根线拆开。
