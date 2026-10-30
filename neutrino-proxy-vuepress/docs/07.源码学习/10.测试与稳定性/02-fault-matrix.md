---
title: "10.02 连接故障矩阵与恢复验证"
date: 2026-10-30
permalink: /learn/fault-matrix/
article: false
status: Review
updated: 2026-10-30
lesson: "10.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    symbol: "initVisitorChannel"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java"
    symbol: "channelActive"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "ProxyMessageConnectHandler"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 76
    endLine: 77
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 115
    endLine: 127
---

# 10.02 连接故障矩阵与恢复验证

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

正常访问像一条直线，故障却可以发生在每个拐点。我们不靠随机拔网线碰碰运气，而是按“哪个对象、哪个阶段、怎么失败、最后谁清理”列一张能逐项验证的表。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

连接失败和已连接后断开是一种情况吗？恢复要验证新业务成功，还是旧会话自动复活？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [server / VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java) | `initVisitorChannel` |
| [server / TcpVisitorChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/TcpVisitorChannelHandler.java) | `channelActive` |
| [client / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | `ProxyMessageConnectHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先把失败放到明确位置

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L76-L77)（原文件 76～77 行，连续原样节选）：

```java
				} else {
					cmdChannel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));
```

目标 connect Future 失败只是其中一个入口。相比之下，真实目标已经接通后再退出，会进入 RealServerChannelHandler.channelInactive，资源和通知路径不同。因此“目标故障”至少要拆成连接前和转发中两类。

| 故障点 | 注入方式（仅本地） | 观察断言 |
| --- | --- | --- |
| 服务端未监听 | 指向本地空端口 | connect 失败，应用按策略重试 |
| AUTH 失败 | 临时无效 License | 关闭与退出策略可解释 |
| 真实目标未监听 | 临时映射到空端口 | 对应访问者应结束等待 |
| 目标中途退出 | 收到部分数据后关闭 | 字节数量明确、两侧关系清理 |
| 控制连接断开 | 停本地服务端/客户端 | 旧业务结束，重连策略可观察 |
| 数据隧道断开 | 关闭指定本地测试连接 | 只影响对应业务 |
| 旧回调迟到 | 教学 Future 控制顺序 | 不能污染新会话 |

这张表是实验计划，不是逐项已通过清单。

### 恢复不等于原来的 TCP 业务继续

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L115-L127)（原文件 115～127 行，连续原样节选）：

```java
	protected synchronized void reconnect() {
		if (null != channel) {
			if (channel.isActive()) {
				return;
			}
			channel.close();
		}

		log.info("[CmdChannel] client reconnect seq:{}", ++reconnectCount);
		try {
			connectProxyServer();
		} catch (Exception e) {
			log.error("[CmdChannel] reconnect error", e);
```

重连器重建的是控制连接，随后再认证并初始化映射。原访问者 TCP 连接上的应用协议状态、已读写进度，不会自动由这个方法恢复。

所以恢复验收应先问产品语义：旧请求允许失败并由调用方重试吗？新连接何时能成功？项目当前没有通用的应用级断点续传机制，不能用“自动重连”承诺上传文件无损续传。

### 一次只改变一个条件

先证明正常链路可用，再注入指定故障，最后撤掉故障验证新业务。每个阶段使用有身份的载荷，记录 visitorId、Channel ID、时间和字节数。

拒绝连接通常能快速得到明确失败；超时要用可控丢弃而不是任意外部地址。测试超时应由单调计时和明确截止控制，失败后总能关闭进程与 socket。

### 现有失败正好作为第一条练习

01.01 已观察到不可达目标的访问者在 3 秒内未收到关闭或拒绝。客户端确实发送了 DISCONNECT，但服务端处理是否能在控制连接上按 visitorId 定位访问者，是重要线索。

将它缩成一个确定性回归用例，比先做一百种随机故障更有效。这里保留原结果，未修改协议，也没把 3 秒偷偷调大来掩盖现象。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先重跑现有端到端实验，再选“目标中途退出”这一项扩展：目标读到固定 N 字节后关闭，访问者记录已发送与已收到数量。最后恢复目标并新开访问者连接，证明新的请求可以成功；全程只使用临时数据。

**已有实测**：正常转发、坏目标不影响健康映射、退出客户端后转发失败等见[01.01 记录](/labs/project-overview-result.json)。**尚未执行**：服务端重启后的自动恢复、隧道中断、迟到回调和中途目标退出完整矩阵。没有把计划写成既有能力。

<span id="完善清单"></span>

## 合上代码前想一想

如果恢复后新请求成功，但旧上传失败，报告应怎么写？为什么删除故障条件之后，还要检查旧连接和索引没有残留？下一篇 [慢消费者与压力](/learn/slow-consumer-load/) 看“没断但很慢”的情况。
