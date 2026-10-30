---
title: "08.08 从现有回调整理客户端状态机"
date: 2026-10-30
permalink: /learn/client-state-machine/
article: false
status: Review
updated: 2026-10-30
lesson: "08.08"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    symbol: "userEventTriggered"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java"
    symbol: "ProxyMessageAuthHandler"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 79
    endLine: 86
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java"
    startLine: 33
    endLine: 38
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 45
    endLine: 51
---

# 08.08 从现有回调整理客户端状态机

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

读完启动、认证、目标连接、心跳和重连，脑子里可能已有很多回调，却还说不清“客户端现在到底在哪一步”。我们不急着重构，先把现有行为翻译成状态与事件，这本身就是很实用的设计训练。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

哪些状态是源码显式保存的，哪些只是我们整理出的教学模型？怎样让停止、失败和迟到回调都有明确去向？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [client / CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java) | `userEventTriggered` |
| [client / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | `handle` |
| [client / ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java) | `ProxyMessageAuthHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先区分控制会话和业务会话

客户端不是只有一个状态机。控制会话负责“连到服务端并保持身份”；每个 visitorId 的业务会话负责“连真实目标、取得隧道、转发、关闭”。一个业务失败时，控制会话可能仍正常，也可能还有别的业务正在转发。

现有启动逻辑只直接判断 Channel 是否活跃：

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L79-L86)（原文件 79～86 行，连续原样节选）：

```java
		if (null == channel || !channel.isActive()) {
			try {
				connectProxyServer();
			} catch (Exception e) {
				log.error("client start error", e);
			}
		} else {
			channel.writeAndFlush(ProxyMessage.buildAuthMessage(proxyConfig.getTunnel().getLicenseKey(), ProxyUtil.getClientId()));
```

AUTH 失败另有分支：

看这段 [ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java#L33-L38)（原文件 33～38 行，连续原样节选）：

```java
		if (ExceptionEnum.AUTH_FAILED.getCode().equals(code)) {
			// 客户端认证失败，直接停止服务
			log.info("client auth failed , client stop.");
			context.channel().close();
			if (!proxyConfig.getTunnel().getReconnection().getUnlimited()) {
				Solon.stop();
```

两段没有统一状态枚举把它们收拢。因此下面的名字是**根据现有回调整理的教学模型**，不是已经存在于项目里的类或字段。

### 控制会话可以先列这张表

| 当前阶段 | 事件 | 行为/下一阶段 |
| --- | --- | --- |
| 尚无活跃连接 | start 或定时重连 | 发起 TCP 连接 |
| TCP 连接中 | Future 成功 | 保存 Channel，发送 AUTH |
| 等待认证 | AUTH 成功结果 | 保持会话；服务端继续初始化映射 |
| 等待认证 | AUTH_FAILED | 关闭；按 unlimited 决定停应用 |
| 会话活跃 | channelInactive | 清理真实连接，等待后续重连 |
| 任意阶段 | 用户明确停止 | 需要定义停止调度、关闭与拒绝迟到结果的规则 |

最后一行是设计补充议题，现有分散代码并未提供一套集中式停止状态约束。别为了让表格好看，就把它写成已实现保证。

### 每条业务还有自己的准备阶段

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L45-L51)（原文件 45～51 行，连续原样节选）：

```java
				if (future.isSuccess()) {
					final Channel realServerChannel = future.channel();

					realServerChannel.config().setOption(ChannelOption.AUTO_READ, false);

					// 获取连接
					ProxyUtil.borrowTcpProxyChanel(tcpProxyTunnelBootstrap, new ProxyChannelBorrowListener() {
```

可以整理为：等待目标 → 目标已连接但暂停读 → 等待数据隧道 → 双向绑定 → 转发中 → 清理结束。目标失败、隧道失败、访问者取消分别要收尾；不能都用一句“重连会恢复”带过。

例如，目标成功后隧道失败，要收回真实目标；旧业务迟到成功时，不能重新挂到新会话。前几篇已指出源码中值得验证的边界，我们在表里保留它们，而不是擅自修改业务策略。

### 设计改进时，先定不变量

三条练习用不变量足够起步：

- 一个 visitorId 在本次会话中只关联一组有效业务连接。
- 进入终止阶段后，迟到的成功结果只做资源回收，不重新开始转发。
- 关闭一条业务只清理它拥有的资源；控制会话关闭才扩大清理范围。

如果要实现代次号或取消令牌，应先写能控制事件顺序的测试，证明旧回调无法污染新会话，再做最小修改。这是后续改进方案，不是当前版本已有能力。

对三年经验的学习者来说，能从代码推导出“事件、状态、资源所有者、不变量”，比背一个状态机框架更有迁移价值。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：选三个场景手工走表：正常连接转发后关闭；目标成功但隧道失败；用户停止后目标 Future 才成功。每一步记录控制状态、业务状态、持有资源、允许的下一个事件。再为后两个场景写教学伪代码或测试草案，不改真实协议。

**怎么验收**：表里每条“当前行为”都有源码出处，每条“建议规则”明确标注，失败结束后资源列表应为空或说明待核实原因。当前仅完成源码推演；迟到回调与停止规则未被本轮实现或运行验证。网络证据仍以 01.01 的实际报告为准。

<span id="完善清单"></span>

## 合上代码前想一想

试着给别人讲两分钟：为什么客户端在线时仍可能只有某一个业务失败？为什么状态机必须同时说清资源归属？至此 Java 客户端主线已串起来，可回到[学习目录](/learn/)进入 UDP、HTTP 与稳定性专题。
