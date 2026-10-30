---
title: "09.01 UDP 封装 会话隔离与回包路径"
date: 2026-10-30
permalink: /learn/udp-forwarding/
article: false
status: Review
updated: 2026-10-30
lesson: "09.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/UdpVisitorChannelHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/UdpProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/UdpRealServerHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/UdpProxyMessageTransferHandler.java"
    symbol: "UdpProxyMessageTransferHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java"
    symbol: "ProxyUtil"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/UdpVisitorChannelHandler.java"
    startLine: 102
    endLine: 108
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/UdpProxyMessageTransferHandler.java"
    startLine: 50
    endLine: 52
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java"
    startLine: 543
    endLine: 545
---

# 09.01 UDP 封装 会话隔离与回包路径

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

TCP 可以靠一条连接辨认会话，UDP 却是一个个独立数据报。服务端同一个 UDP 监听会接到很多发送方，这时再把“一个 Channel 就是一个访问者”的思路搬过来，就会把回包送错地方。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

UDP 访问者共用监听 Channel，项目如何区分发送方？经过客户端后，目标响应又怎么回到原发送地址？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / UdpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/UdpVisitorChannelHandler.java) | `channelRead0` |
| [client / UdpProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/UdpProxyMessageConnectHandler.java) | `handle` |
| [client / UdpRealServerHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/UdpRealServerHandler.java) | `channelRead0` |
| [server / UdpProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/UdpProxyMessageTransferHandler.java) | `UdpProxyMessageTransferHandler` |
| [server / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java) | `ProxyUtil` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 共用监听，不共用会话身份

看这段 [UdpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/UdpVisitorChannelHandler.java#L102-L108)（原文件 102～108 行，连续原样节选）：

```java
        // UDP场景下，一个visitorId并不对应一个visitorChannel，所有visitor共用一个visitorChannel
        visitorId = ProxyUtil.newVisitorId();
        // 设置udp发送方的地址
        ProxyUtil.setVisitorIdToSocketAddressMap(visitorId, datagramPacket.sender());
        // 此处需要和tcp分开
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.UDP, cmdChannel, visitorId, visitorChannel, sa.getPort());
        ProxyUtil.addProxyConnectAttachment(visitorId, proxyAttachment);
```

访问者发送一个 DatagramPacket，服务端拿到 sender 地址与本地映射端口。首次访问建立 visitorId，登记发送方地址和共享访问 Channel，再发 UDP_CONNECT。这里不能暂停或关闭整个共享监听来结束某一个访问者，否则会影响其他发送方。

UDP 仍复用 ProxyMessage 外壳，但类型换成 UDP_CONNECT、UDP_TRANSFER，info 用 UdpBaseInfo JSON，data 保存原数据报内容。业务数据报经过隧道封装，并不意味着外部 UDP 语义自动获得可靠交付、重传或按应用消息确认。

### 先跟踪一去一回

请求链：服务端 UDP 监听 → 按 sender 找 visitorId → UDP_TRANSFER → 客户端 takeChannel → DatagramPacket 发给目标。

响应链：客户端 UdpRealServerHandler → 读绑定信息并计数 → UDP_TRANSFER → 服务端取回发送方地址 → DatagramPacket 回包。

服务端回包最后一步：

看这段 [UdpProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/UdpProxyMessageTransferHandler.java#L50-L52)（原文件 50～52 行，连续原样节选）：

```java
        InetSocketAddress address = ctx.channel().attr(Constants.SENDER).get();
        if (null != address) {
            visitorChannel.writeAndFlush(new DatagramPacket(Unpooled.copiedBuffer(proxyMessage.getData()), address));
```

SENDER 在前向处理时保存到对应隧道属性中，NEXT_CHANNEL 指向共享 UDP 访问通道。它不是按 TCP 那样“直接往一条已连接的访问者 socket 写字节”，而是显式指定 DatagramPacket 接收地址。

### 会话键值得多看一眼

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java#L543-L545)（原文件 543～545 行，连续原样节选）：

```java
    public static void setVisitorIdToSocketAddressMap(String visitorId, SocketAddress socketAddress) {
        visitorIdToSocketAddressMap.put(visitorId, socketAddress);
        socketAddressToVisitorIdMap.put(socketAddress, visitorId);
```

当前反向索引只用 SocketAddress 作键，没有把映射端口加入这个方法的键。若同一个发送 socket 同时访问不同映射端口，是否会复用或覆盖身份，是需要针对当前实现验证的边界。

别把注释“所有 visitor 共用一个 visitorChannel”读成所有映射共用一个全局监听；准确说，是某个 UDP 监听 Channel 可以承载多个发送方。映射之间、发送方之间和隧道之间都要分别检查。

### 第一包要先暂存

隧道没准备好时，当前数据报复制到 ProxyAttachment，等 UDP_CONNECT 的服务端绑定完成再执行。这样解决准备阶段的数据保存问题，但并没有看到一个通用的无限待发送队列。

因此“初始化期间连续发多包”“响应迟到”“地址重复使用”都值得测试。首包能返回不代表并发与会话隔离都已覆盖。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在纯回环环境运行 UDP Echo，两个不同发送端口分别发 A/B 带序号数据报，核对回包地址与内容。再用同一个发送 socket 访问两个不同映射目标，给两个目标加不同响应前缀，观察会话是否隔离；限制包数和等待时间。

**怎么验收**：每个数据报都有发送时间、源端口、映射端口、visitorId 和响应归属，超时与乱序分别记录。当前尚未执行 UDP 端到端矩阵；01.01 的 TCP 记录不能支持 UDP 可用性或隔离结论。本文会话键边界来自源码推演。

<span id="完善清单"></span>

## 合上代码前想一想

为什么结束一条 UDP 会话不能直接关闭共享监听？为什么测试只用两个不同源端口，还不足以覆盖同源跨映射？下一篇 [UDP 生命周期](/learn/udp-lifecycle/) 看客户端用本地端口管理回包。
