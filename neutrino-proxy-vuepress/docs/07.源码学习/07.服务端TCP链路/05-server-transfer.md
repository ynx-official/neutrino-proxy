---
title: "07.05 请求响应的双向数据转发"
date: 2026-10-30
permalink: /learn/server-transfer/
article: false
status: Review
updated: 2026-10-30
lesson: "07.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java"
    symbol: "channelRead0"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 67
    endLine: 79
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java"
    startLine: 28
    endLine: 30
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java"
    startLine: 43
    endLine: 52
---

# 07.05 请求响应的双向数据转发

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

桥搭好了，转发代码反而没有想象中长：读到字节，包进消息，发到另一端，再拆出来写给下一条连接。但短代码背后，仍藏着方向、释放、背压和流量计数四件事。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

请求与响应各走哪些方法？数据是按 visitorId 每次重新查表，还是沿 NEXT_CHANNEL 直接找到对端？流量统计的“读写”站在哪一边看？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [server / ProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java) | `handle` |
| [client / ProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageTransferHandler.java) | `handle` |
| [client / RealServerChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/RealServerChannelHandler.java) | `channelRead0` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 请求：把原始字节装进 TRANSFER

看这段 [TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L67-L79)（原文件 67～79 行，连续原样节选）：

```java
        byte[] bytes = new byte[buf.readableBytes()];
        buf.readBytes(bytes);

        // 代理通道可写，则设置访问通道可读。代理通道不可写，则设置访问通道不可读
        visitorChannel.config().setAutoRead(proxyChannel.isWritable());

        // 转发代理数据
        String visitorId = ProxyUtil.getVisitorIdByChannel(visitorChannel);
        proxyChannel.writeAndFlush(ProxyMessage.buildTransferMessage(visitorId, bytes));

        // 增加流量计数
        VisitorChannelAttachInfo visitorChannelAttachInfo = ProxyUtil.getAttachInfo(visitorChannel);
        Solon.context().getBean(FlowReportService.class).addWriteByte(visitorChannelAttachInfo.getLicenseId(), bytes.length);
```

访问者 Handler 先找到 NEXT_CHANNEL，没有关联就关闭；有了关联，复制可读字节到数组、设置上游 AUTO_READ，再发送 TRANSFER。visitorId 放在 info，业务内容放 data。

这里的 buf 是原始 TCP 数据，不一定是一条完整 HTTP 请求。一次 channelRead0 的边界不是应用消息边界；代理应保证字节顺序与完整性，而不是要求“一个 read 对应一个请求”。

客户端收到 TRANSFER 后，经自己的 Handler 找到真实服务连接，把 data 写出。请求链可以画成：访问者 ByteBuf → 服务端 TRANSFER → 隧道编码/解码 → 客户端 Transfer Handler → 真实服务 ByteBuf。

### 响应：沿已经建立的关系回来

服务端收到客户端发回的 TRANSFER 时，先取：

看这段 [ProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java#L28-L30)（原文件 28～30 行，连续原样节选）：

```java
		Channel visitorChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
		if (null != visitorChannel) {
			if (!visitorChannel.isWritable()) {
```

当前实现主要沿数据隧道的 NEXT_CHANNEL 找访问者，不是每个响应都用 info 中的 visitorId 全局查表。前一篇的绑定正确性因此很关键；关联错了，转发再快也没有意义。

写给访问者的是：

看这段 [ProxyMessageTransferHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageTransferHandler.java#L43-L52)（原文件 43～52 行，连续原样节选）：

```java
			ByteBuf buf = ctx.alloc().buffer(proxyMessage.getData().length);
			buf.writeBytes(proxyMessage.getData());
			visitorChannel.writeAndFlush(buf);

			// 关闭http响应通道
//			ProxyUtil.closeHttpProxyResponseChannel(visitorChannel);

			// 增加流量计数
			VisitorChannelAttachInfo visitorChannelAttachInfo = ProxyUtil.getAttachInfo(visitorChannel);
			Solon.context().getBean(FlowReportService.class).addReadByte(visitorChannelAttachInfo.getLicenseId(), proxyMessage.getData().length);
```

新建 ByteBuf 后交给异步 writeAndFlush，所有权进入 Netty 出站流程。不要刚写完就手动 release，也别把 writeAndFlush 返回理解成访问者应用已完整消费。

### 统计方向以服务端视角核对

请求侧 addWriteByte、响应侧 addReadByte，都是按 License 累加。命名容易与“访问者读、真实目标写”混淆，所以分析报表时，请直接标明：

| 数据方向 | 此处统计调用 |
| --- | --- |
| 访问者 → 内网目标 | addWriteByte |
| 内网目标 → 访问者 | addReadByte |

这些计数取的是代理转发的载荷字节，不自动包含 TCP/IP、TLS 或 ProxyMessage 所有封装开销，也不是远端业务处理成功的确认。

### 短路径里也有排队

TRANSFER 响应 Handler 在创建 ByteBuf 前会检查访问者可写状态并切换隧道读取，源码还留着快速写入可能撑大缓冲的 TODO。回看 [背压](/learn/netty-backpressure/)：高水位提供反馈，不是绝对内存配额。

另外，若 NEXT_CHANNEL 为空，此 Handler 直接跳过转发，没有统一返回一条错误响应。丢失关联时，不能只找异常栈；还要查之前是否完成 CONNECT 绑定、是否已断开清理。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：用固定随机种子生成 65536 字节二进制，让目标返回相同内容；请求端分别按 1 字节、小块和整块写入。记录两端 SHA-256、实际收发总数，以及对应 License 的计数变化。每种写法都需要读取到完整长度，不能只 recv 一次就结束。

**已有实测**：01.01 已记录 65536 字节往返一致，见[端到端结果](/labs/project-overview-result.json)；基础实验覆盖全部二进制字节值的编解码。**待执行**：三种 socket 写入切分方式与数据库报表计数比对，不能由现有正常转发结果直接推断。

<span id="完善清单"></span>

## 合上代码前想一想

如果你收到的内容少了最后一段，会先查应用读取循环、代理断开还是 write Future？为什么流量计数上涨也可能没有成功业务响应？下一篇 [断开与清理](/learn/server-disconnection/) 正好接上这个问题。
