---
title: "08.06 定时重连 可见性与并发边界"
date: 2026-10-30
permalink: /learn/client-reconnection/
article: false
status: Review
updated: 2026-10-30
lesson: "08.06"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    symbol: "userEventTriggered"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 42
    endLine: 50
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 115
    endLine: 127
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 99
    endLine: 107
---

# 08.06 定时重连 可见性与并发边界

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

看到 reconnect 方法上的 synchronized，很容易觉得重连并发已经安排妥了。我们把目光再放宽一点：谁定时叫它，连接在哪个线程完成，channel 和计数又在什么时候更新？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

固定延迟与固定频率有什么区别？volatile 保证什么、没保证什么？TCP 接通后立即认证失败，重连计数会怎样？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [client / CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java) | `userEventTriggered` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先看谁负责“再试一次”

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L42-L50)（原文件 42～50 行，连续原样节选）：

```java
	private static final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor(new CustomThreadFactory("ClientReconnect"));

	@Init
	public void init() {
		this.reconnectExecutor.scheduleWithFixedDelay(this::reconnect, 10, proxyConfig.getTunnel().getReconnection().getIntervalSeconds(), TimeUnit.SECONDS);

		try {
			this.start();
			UdpServerUtil.initCache(proxyConfig, udpServerBootstrap);
```

初始化先注册单线程 ScheduledExecutorService 的固定延迟任务，初始延迟 10 秒，之后采用配置的 intervalSeconds。与此同时还立即 start，所以首次连接并不是一定要等 10 秒。

scheduleWithFixedDelay 是本次任务结束后再等待一个间隔；如果任务中 connect.sync 等了很久，下次开始也会往后推。它不是严格每隔 N 秒就发起一次，尤其不能忽略连接操作自身的等待时间。

### synchronized 保护的是当前实例方法

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

控制 Channel 活跃就返回；失活则尝试关闭，然后递增计数再连接。方法锁让同一实例经这个入口执行的重连不重叠；它不自动锁住所有 Netty 回调，也不使其他 start 入口获得同一把锁。

channel 和 reconnectCount 声明为 volatile，支持不同线程读取更新后的值。但 ++ 是读、改、写组合，volatile 不能把所有复合操作变成原子事务。此处还要结合调用线程和 synchronized 的范围判断，而不是机械地把 volatile 字段换成原子类就宣布问题解决。

### 连接回调在另一条时间线上

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L99-L107)（原文件 99～107 行，连续原样节选）：

```java
					if (future.isSuccess()) {
						channel = future.channel();
						// 连接成功，向服务器发送客户端认证信息（licenseKey）
						ProxyUtil.setCmdChannel(future.channel());
						future.channel().writeAndFlush(ProxyMessage.buildAuthMessage(proxyConfig.getTunnel().getLicenseKey(), ProxyUtil.getClientId()));
						log.info("[CmdChannel] connect proxy server success. channelId:{}", future.channel().id().asLongText());

//						reconnectServiceEnable = true;
						reconnectCount = 0;
```

TCP 成功回调会更新 channel、设置工具类控制连接、发送认证、计数归零。假如认证随后失败且应用继续运行，下一轮可能再次开始计数；因此日志中的 seq 不是从进程启动到现在的“所有失败次数累计”。

当前没有指数退避、随机抖动、统一取消令牌或重连代次字段。它实现的是固定延迟基础重试。需要扩展时，先定义网络失败、认证失败、用户主动停止各自的策略，再决定哪些状态能重试。

### 从一个具体竞态练习思考

设想用户触发停止，连接 Future 却刚好成功。是否还能把新 Channel 保存成当前连接？当前片段没有展示统一的“停止后拒绝迟到成功”的机制。

这不等于现在每次都会复现问题，而是提示测试应控制事件顺序：先发起连接、再发停止、最后完成连接。随意多点几次启动按钮，很难稳定证明这个边界。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在本地隔离环境记录启动立即连接、断网后重试、恢复监听后三个阶段的开始/结束时间。再把一次连接等待拉长，比较间隔是否从任务结束计算。并发与迟到回调练习先用可控 Future 的教学副本完成，别在共享服务端频繁重连。

**怎么验收**：时间线能区分 initialDelay、连接耗时和 fixedDelay，并分别记录 TCP 成功与 AUTH 结果。基础实验已验证并发容器复合操作与原子 compute 的区别；尚未执行完整重连故障恢复与停止竞态测试，不能把该小实验当成当前重连器的并发证明。

<span id="完善清单"></span>

## 合上代码前想一想

为什么一个单线程调度器还会与 Netty 回调并发？为什么 synchronized 和 volatile 分工不同？接着看 [通道池与资源](/learn/client-pool-cleanup/)，找出重连之外的连接生命周期。
