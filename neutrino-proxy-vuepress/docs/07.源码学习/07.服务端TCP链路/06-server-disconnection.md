---
title: "07.06 断开 异常与连接关系清理"
date: 2026-10-30
permalink: /learn/server-disconnection/
article: false
status: Review
updated: 2026-10-30
lesson: "07.06"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java"
    symbol: "channelRead0"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageDisconnectHandler.java"
    symbol: "handle"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    startLine: 129
    endLine: 137
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java"
    startLine: 93
    endLine: 99
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageDisconnectHandler.java"
    startLine: 27
    endLine: 36
---

# 07.06 断开 异常与连接关系清理

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

连接建立时关系越来越多，断开时就得一项项收回来。这里最值得读的不是 close() 本身，而是：谁先断、通知谁、删哪张表，以及旧连接的迟到事件会不会误伤新连接。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

关闭数据隧道与关闭控制连接，影响范围有什么不同？不可达目标的失败通知，真的能让访问者及时结束等待吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [server / ProxyTunnelChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java) | `channelRead0` |
| [server / ProxyMessageDisconnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageDisconnectHandler.java) | `handle` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先从访问者主动退出说起

访问者 channelInactive 会从控制连接附带的 visitorChannelMap 移除本次 visitorId，再清理附件；若数据隧道仍活跃，则清除关联属性并发断开消息：

看这段 [TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java#L129-L137)（原文件 129～137 行，连续原样节选）：

```java
                proxyChannel.attr(Constants.NEXT_CHANNEL).remove();
                proxyChannel.attr(Constants.LICENSE_ID).remove();
                proxyChannel.attr(Constants.VISITOR_ID).remove();

                proxyChannel.config().setOption(ChannelOption.AUTO_READ, true);
                // 通知客户端，用户连接已经断开
                proxyChannel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));

                proxyChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
```

最后通过空缓冲写出完成后的 CLOSE 监听器关闭隧道。这个写法意在让此前排队的数据先完成出站，不是一个“对端业务确认已收到全部内容”的协议。

数据隧道失活时，另一侧会找 NEXT_CHANNEL，关闭对应真实连接或访问者。UDP 共享访问通道有额外标记保护，不能照 TCP 一次业务一个连接的逻辑直接 close。

### 控制连接退出，清理范围更大

控制连接失活会涉及 License 在线状态、控制连接索引和它下面的访问者。代码特意检查当前记录的连接是不是自己：

看这段 [ProxyTunnelChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelChannelHandler.java#L93-L99)（原文件 93～99 行，连续原样节选）：

```java
                Channel curCmdChannel = ProxyUtil.getCmdChannelByLicenseId(cmdChannelAttachInfo.getLicenseId());
                // 客户端切换网络后，连接断开，但服务端还未触发断开事件。此时客户端重连上了，然后服务端触发了断开，此时不应该更新在线状态
                if (curCmdChannel == ctx.channel()) {
                    Solon.context().getBean(ProxyMutualService.class).offline(cmdChannelAttachInfo);
                    ProxyUtil.removeCmdChannel(ctx.channel());
                    // 防止下次换一个客户端，无法连接的情况
                    ProxyUtil.removeClientIdByLicenseId(cmdChannelAttachInfo.getLicenseId());
```

为什么要比对象身份？网络切换时，新连接可能已替换索引，旧连接的 channelInactive 稍后才执行。此时不能把新会话当作旧会话一起 offline。

但这个局部判断不等于整个跨表清理过程具有原子事务。ProxyUtil 中还有多张全局索引与锁，哪些读写受保护、重复关闭是否幂等、并发回调如何交错，都要继续按路径验证。

### 失败通知得落到正确的查找方式

服务端 DISCONNECT Handler 当前这样取访问者：

看这段 [ProxyMessageDisconnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageDisconnectHandler.java#L27-L36)（原文件 27～36 行，连续原样节选）：

```java
		Integer licenseId = ctx.channel().attr(Constants.LICENSE_ID).get();
		// licenseId为空，说明访问者通道已经关闭，无需处理
		if (null == licenseId) {
			return;
		}
		// 代理连接没有连上服务器由控制连接发送用户端断开连接消息
		Channel visitorChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
		if (null != visitorChannel) {
			// 数据发送完成后再关闭连接，解决http1.0数据传输问题
			visitorChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
```

注意它先看当前 Channel 的 LICENSE_ID 和 NEXT_CHANNEL。若客户端连接真实目标失败，通知是从控制连接发来的，info 虽然带 visitorId，这段有效代码却没有按 visitorId 去控制连接的 map 查找；底下旧的查表逻辑被注释了。

所以不能仅看到客户端“发送了 DISCONNECT”，就断言服务端必然关闭对应访问者。01.01 的真实实验中，不可达目标在 3 秒内没有让访问者收到关闭或拒绝；这个失败仍保留在[实验记录](/labs/project-overview-result.json)。上述分支是解释该现象的源码线索，尚未用专门的逐事件回归测试确认为唯一根因。

### 清理可以列成一张责任表

| 起点 | 重点检查 |
| --- | --- |
| 访问者关闭 | visitorId、附件、数据隧道关联 |
| 数据隧道关闭 | 对应访问者/真实目标、池和属性 |
| 控制连接关闭 | 当前会话身份、License 在线状态、所属访问者 |
| 真实目标未连接成功 | 失败通知发在哪条 Channel、能否定位访问者 |

一条正常 roundtrip 不能覆盖这张表。清理问题往往需要给每个对象一个 ID，再观察事件顺序和最终索引状态。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：重跑 01.01 的隔离实验，先正常往返，再让第二条映射指向本地未监听端口，最后退出 Java 客户端。分别记录访问者收到 EOF、异常或超时，以及事件对应的 Channel 角色。用超时结束等待，不无限挂起。

**已有实测**：健康映射继续可用、退出客户端后不能再完成转发；不可达目标及时关闭一项未通过，3 秒内未收到关闭或拒绝。结果不删改、不放宽超时伪造通过。本轮没有修改断开逻辑；重复关闭、旧连接迟到和并发清理仍需后续专门测试。

<span id="完善清单"></span>

## 合上代码前想一想

你能指出“发出了失败消息”和“清理了访问者”之间缺少的证据吗？旧 Channel 迟到时，为什么要先比较当前关联？下一组进入 [Java 客户端配置](/learn/client-configuration/)。
