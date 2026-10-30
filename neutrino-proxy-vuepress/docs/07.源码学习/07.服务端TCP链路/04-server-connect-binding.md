---
title: "07.04 VisitorId 与数据通道绑定"
date: 2026-10-30
permalink: /learn/server-connect-binding/
article: false
status: Review
updated: 2026-10-30
lesson: "07.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 101
    endLine: 106
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 55
    endLine: 64
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java"
    startLine: 83
    endLine: 89
---

# 07.04 VisitorId 与数据通道绑定

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

服务端有访问者，客户端能连接内网目标，但这两条连接隔着网络，怎么知道彼此是一对？visitorId 就是这次会合的暗号。它的任务是关联会话，身份校验仍然要靠另外的条件。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

为什么访问者刚连接就暂停读取？数据隧道里的 CONNECT 为何多出一个 @License？NEXT_CHANNEL 又在哪两端建立？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [server / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageConnectHandler.java) | `handle` |
| [client / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | `handle` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先停一下，别在桥还没搭好时放车过去

看这段 [TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L101-L106)（原文件 101～106 行，连续原样节选）：

```java
        // 用户连接到代理服务器时，设置用户连接不可读，等待代理后端服务器连接成功后再改变为可读状态
        visitorChannel.config().setOption(ChannelOption.AUTO_READ, false);

        String visitorId = ProxyUtil.newVisitorId();
        ProxyUtil.addVisitorChannelToCmdChannel(NetworkProtocolEnum.TCP, cmdChannel, visitorId, visitorChannel, sa.getPort());
        cmdChannel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId).setData(lanInfo.getBytes()));
```

访问者先被设为 AUTO_READ=false，然后生成 visitorId、保存关系，控制连接发送 CONNECT：info 是 visitorId，data 是内网目标地址信息。

这一步没有把访问者的业务首包直接当作控制命令。暂停读取让客户端有机会先连目标和建立数据隧道，避免 channelRead0 时还找不到 NEXT_CHANNEL。

### 客户端要完成两次本地关联

客户端收到命令后，先连接真实目标；目标成功后暂停其读取，再借取或新建数据隧道。成功回调做下面这些事：

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L55-L64)（原文件 55～64 行，连续原样节选）：

```java
							// 连接绑定
							channel.attr(Constants.NEXT_CHANNEL).set(realServerChannel);
							realServerChannel.attr(Constants.NEXT_CHANNEL).set(channel);

							// 远程绑定
							channel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId + "@" + proxyConfig.getTunnel().getLicenseKey()));

							realServerChannel.config().setOption(ChannelOption.AUTO_READ, true);
							ProxyUtil.addRealServerChannel(visitorId, realServerChannel);
							ProxyUtil.setRealServerChannelVisitorId(realServerChannel, visitorId);
```

客户端的 NEXT_CHANNEL 是“数据隧道 ↔ 真实服务”。随后通过数据隧道发送 visitorId@licenseKey，让服务端完成自己的那一半关联。

注意顺序：客户端发出远程绑定消息后就开启真实服务读取，没有在这里显式等待另一条“绑定完成 ACK”。理解这种时序，靠的是同一数据连接上的消息顺序与服务端处理，而不能凭空补一条协议中没有的确认消息。

### 服务端用两级定位找到访问者

服务端 CONNECT Handler 先解析 visitorId@licenseKey，检查 License 和用户状态，再由 License 找到控制连接，由其 visitorChannelMap 找到 visitorId。找不到任一环节都会走错误分支。

真正建立关联的代码很短：

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

服务端 NEXT_CHANNEL 是“数据隧道 ↔ 访问者”，绑定完成才打开访问者读取。至此，两端分别连起自己的本地对象，跨网络则靠同一数据隧道传输。

用四个对象写下来就清晰了：

```text
服务端：访问者 V  ←NEXT_CHANNEL→  数据隧道 Ps
                                  ║ TCP 隧道
客户端：真实目标 R ←NEXT_CHANNEL→  数据隧道 Pc
```

Ps 和 Pc 是同一条 TCP 连接在两个进程里的端点，不是同一个 Java 对象。控制连接另外存在，负责通知客户端发起这一轮准备。

### visitorId 是查找键，不要给它更多含义

它帮助找到“这一次访问”，但知道一个 visitorId 并不应该等于拥有访问权限。当前实现的具体校验落在 CONNECT Handler 中；是否覆盖所有越权、重放和重复绑定情况，需要另做测试，不能只凭一个关联图宣布安全。

另有 PROXY_CONNECT_ATTACHMENT 分支用于转发某些代理路径暂存的首段数据，普通 TCP 不一定有这个对象。不要把“没有附件”当作失败并关闭正常 TCP 访问者。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在本地实验中给同一个映射开两条访问者连接，记录每次的 visitorId 与服务端两条 Channel ID，以及客户端真实目标和隧道 Channel ID。日志只标注临时 License 的内部编号，不打印 key。

**怎么验收**：两组业务不能串线；每个服务端访问者应关联对应数据隧道，客户端对应真实目标。正常 65536 字节往返已有实测；本篇逐对象关联日志和重复绑定测试尚未执行。可以先用调试器观察属性，不修改协议。

<span id="完善清单"></span>

## 合上代码前想一想

现在解释一下：控制连接为什么不能直接当作某个访问者的 NEXT_CHANNEL？两端的 NEXT_CHANNEL 为什么指向不同类型的对象？下一篇 [双向转发](/learn/server-transfer/) 让字节真正走起来。
