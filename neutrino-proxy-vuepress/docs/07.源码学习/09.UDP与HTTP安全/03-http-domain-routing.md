---
title: "09.03 HTTP 域名选择与首包转发"
date: 2026-10-30
permalink: /learn/http-domain-routing/
article: false
status: Review
updated: 2026-10-30
lesson: "09.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpProxy.java"
    symbol: "HttpProxy"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpVisitorChannelHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/HttpVisitorSecurityChannelHandler.java"
    symbol: "HttpVisitorSecurityChannelHandler"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/HttpVisitorSecurityChannelHandler.java"
    startLine: 54
    endLine: 67
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/HttpVisitorSecurityChannelHandler.java"
    startLine: 110
    endLine: 115
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpVisitorChannelHandler.java"
    startLine: 71
    endLine: 75
---

# 09.03 HTTP 域名选择与首包转发

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

普通 TCP 映射靠端口选目标，HTTP 域名映射则要先看 Host。同一个入口里，a.example.test 与 b.example.test 可以走不同映射；问题是 Host 可能分几次才收到，第一段业务字节还不能丢。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

项目在哪里决定域名对应的映射端口？首包暂存在哪里？为什么解析完请求头后会把安全 Handler 从 Pipeline 移除？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / HttpProxy.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpProxy.java) | `HttpProxy` |
| [server / HttpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpVisitorChannelHandler.java) | `channelRead0` |
| [server / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java) | `handle` |
| [server / HttpVisitorSecurityChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/HttpVisitorSecurityChannelHandler.java) | `HttpVisitorSecurityChannelHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 路由从请求头里来

HTTP 入口的 Pipeline 是 HttpVisitorSecurityChannelHandler → flowLimiter → HttpVisitorChannelHandler。前者累计字节直到找到头部结束标记：

看这段 [HttpVisitorSecurityChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/HttpVisitorSecurityChannelHandler.java#L54-L67)（原文件 54～67 行，连续原样节选）：

```java
        // 累加数据包
        ByteBuf buf = (ByteBuf) msg;
        cumulationBuf.writeBytes(buf);

        String dataStr = cumulationBuf.toString(CharsetUtil.UTF_8);
        int headerEndIndex = dataStr.indexOf("\r\n\r\n");
        if (-1 == headerEndIndex) {
            // 请求头还没读完，继续等
            return;
        }

        // 获取Host请求头
        String headerPart = dataStr.substring(0, headerEndIndex + 4);
        String host = HttpUtil.getHostIgnorePort(headerPart); //test1.asgc.fun
```

这里没有先安装一个完整 HttpServerCodec 再处理 HttpRequest 对象，而是把累计 ByteBuf 转成字符串找 CRLFCRLF，使用工具提取 Host 并忽略端口。

随后按完整域名查 domainNameId、检查是否只允许 HTTPS，取得映射 serverPort，并做访问规则判断。失败会关闭连接。你可以沿 ProxyUtil 的域名索引继续追 DomainService 如何更新这些关系。

### 解析完首个请求头，就转成透传

看这段 [HttpVisitorSecurityChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/HttpVisitorSecurityChannelHandler.java#L110-L115)（原文件 110～115 行，连续原样节选）：

```java
        // 从此之后所有的 in 都是“直接透传”。
        // 否则，若请求体过长，数据包被拆分为多个，后续的数据包都无法解析出host，导致转发数据不完整。
        ctx.pipeline().remove(this);

        // 继续传播
        ctx.fireChannelRead(cumulationBuf);
```

移除自身，是为了后续请求体分片不再被当作请求头重新解析。累计的首段内容也继续往下传播，不能只传当前那一小块而丢掉前面已经收下的数据。

它意味着这条连接后续按已选定关系转发，并不会对每个 keep-alive 请求重新选择 Host。若同一连接后续请求改 Host，实际行为需要专门验证，不应宣传成通用的逐请求反向代理。

### 首包还有第二次等待

HttpVisitorChannelHandler 收到累计内容后会先复制成 ProxyAttachment；已有 visitorId 就直接转发，否则暂停读取并走 CONNECT：

看这段 [HttpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpVisitorChannelHandler.java#L71-L75)（原文件 71～75 行，连续原样节选）：

```java
        visitorId = ProxyUtil.newVisitorId();
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.HTTP, cmdChannel, visitorId, ctx.channel(), serverPort);
        // ProxyUtil.addProxyConnectAttachment(visitorId, proxyAttachment);
        ctx.channel().attr(Constants.PROXY_CONNECT_ATTACHMENT).set(proxyAttachment);
        cmdChannel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId).setData(lanInfo.getBytes()));
```

附件放在访问者的 PROXY_CONNECT_ATTACHMENT 属性中。服务端数据隧道完成绑定后，ProxyMessageConnectHandler 读取附件并执行，首段 HTTP 数据这才进入 TRANSFER。

调用链是：累积请求头 → 域名选映射 → 保存首段 → 控制连接发 CONNECT → 客户端准备目标和隧道 → 服务端绑定 → 执行附件 → 后续原始字节透传。

### 边界别藏在“支持 HTTP”四个字后面

没有头部结束标记时，这段代码持续累计，片段里没看到明确头部大小或等待时间限制。原入站 buf 复制后如何释放、提前关闭时 cumulationBuf 如何释放，也值得资源测试；ChannelInboundHandlerAdapter 不会像 SimpleChannelInboundHandler 那样替你自动消费释放。

这些是源码审查问题，本轮未做慢头部或资源实测。学习时将“能按 Host 找映射”与“覆盖完整 HTTP 协议、请求大小及资源边界”分开，会更接近真实工程。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：用 .test 虚构域名在临时配置建立两条 HTTP 映射；请求直接连接回环端口并设置 Host，分两次发送请求头，再发送较长请求体。目标回显收到的长度和哈希。补一组缺 Host、未知 Host，以及同连接改 Host 的观察，全部设置超时。

**怎么验收**：首段不丢、不重复，目标选择与 Host 对应；非法域名按当前代码关闭。HTTP 首包、keep-alive 与头部资源边界本轮尚未执行，现有 TCP Echo 不能替代。只用回环地址和虚构 Host，无需改公共 DNS。

<span id="完善清单"></span>

## 合上代码前想一想

为什么要同时理解 cumulationBuf 和 ProxyAttachment，两者各在等什么？把安全 Handler 移除以后，哪些检查不会对后续请求重复执行？接着看 [两层 TLS](/learn/tls-boundaries/)。
