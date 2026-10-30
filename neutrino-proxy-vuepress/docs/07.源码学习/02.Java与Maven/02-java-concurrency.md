---
title: "02.02 并发容器 可见性与复合操作"
date: 2026-10-30
permalink: /learn/java-concurrency/
article: false
status: Review
updated: 2026-10-30
lesson: "02.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    symbol: "borrowTcpProxyChanel"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    startLine: 42
    endLine: 49
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 115
    endLine: 123
---

# 02.02 并发容器 可见性与复合操作

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

看到 ConcurrentHashMap，很多人的第一反应是：这块线程安全，放心了。先给它留个小问号。一个容器操作安全，和一串业务步骤一起安全，是两件需要分别检查的事。我们就从客户端的共享状态下手。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

两个线程都先读到 0，再分别写回 1。即使用 ConcurrentHashMap，最后会自动变成 2 吗？先把答案写在旁边，等会儿真跑一次。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [client / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java) | `borrowTcpProxyChanel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先找到大家共同摸得到的状态

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java#L42-L49)（原文件 42～49 行，连续原样节选）：

```java
	private static final int MAX_POOL_SIZE = 100;

	private static Map<String, Channel> realServerChannels = new ConcurrentHashMap<String, Channel>();

	private static ConcurrentLinkedQueue<Channel> tcpProxyChannelPool = new ConcurrentLinkedQueue<Channel>();
	private static ConcurrentLinkedQueue<Channel> udpProxyChannelPool = new ConcurrentLinkedQueue<>();

	private static volatile Channel cmdChannel;
```

这里有三种不同的工具：ConcurrentHashMap 存目标连接，ConcurrentLinkedQueue 放空闲代理通道，volatile 字段保存控制连接引用。

先不要急着问“哪个性能更高”。先问读写双方在哪个线程，操作之间需不需要一起成立。例如，从池里取出一个通道，还要检查它活不活、有没有绑定旧会话；这些步骤涉及的不变量，不能只由队列这个类名替你保证。

### volatile 帮你看见更新 不替你组合步骤

`volatile Channel` 让这个引用的读写具备对应的可见性与顺序约束。它不会把“判断为空 → 建连接 → 更新引用”变成一次不可分割的操作。

同理，一个 volatile int 做 `++`，仍包含读、计算、写。要不要互斥，还得看调用路径。项目里的 reconnectCount 就和重连方法的同步边界一起出现，不能把字段修饰符单独拿出来宣布整段逻辑安全。

### 这把锁具体锁住谁

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L115-L123)（原文件 115～123 行，连续原样节选）：

```java
	protected synchronized void reconnect() {
		if (null != channel) {
			if (channel.isActive()) {
				return;
			}
			channel.close();
		}

		log.info("[CmdChannel] client reconnect seq:{}", ++reconnectCount);
```

这是实例上的 synchronized 方法，同一个实例的调用会经过同一个监视器。先看已有 Channel 是否还活着，失效则关闭，之后才继续尝试连接。

但连接又有异步回调，静态调度器还可能活得比某个对象更久。所以，锁住这个方法，不能直接推出所有回调、所有静态状态都在同一个锁里。读并发代码时，最好把“在哪加锁”和“在哪里实际读写”都圈出来。

这里先练分析边界，不把教学计数器里的问题直接算成项目重连的已证实缺陷。要判断重连会不会重复建立控制连接，还需要沿启动、调度、结果回调和退出一起验证。

### 用一个确定能复现的小例子拆开理解

我们的教学实验让两个线程都先读到 0，等两边读完再允许写回。最后得到 1，是刻意安排出来的丢更新；它证明 get 和 put 分别安全，不保证这两个动作合成“原子递增”。

接着把更新放进同一键的 compute，两个线程各加 1000 次，结果应为 2000。这个对照帮你理解边界，不意味着遇到所有并发问题都用 compute；涉及多个 Channel、多个键或外部网络动作时，还要设计更大的状态转换。

以后看到“检查之后再操作”，可以先停一下：检查的结果到使用时还成立吗？这个问题比机械地加一把全局锁更接近业务。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：复现一次丢更新，再解释为什么第二个实验没有丢。

运行：

```powershell
python scripts/learning/foundations_lab.py
```

[记录中的两个检查](/labs/foundations-result.json)分别是 compound_get_put_loses_update 与 compute_preserves_updates，已实际通过。第一项的“通过”表示稳定复现了教学里的错误写法，不表示丢更新是正确业务结果。

然后回到 ProxyUtil，分别写出“池中通道可借”“借到后可用于这次访问”“会话结束后能清理”需要哪些条件。这个分析部分是你的源码练习；当前报告没有声称已完成项目所有重连与连接池的并发验证。

<span id="完善清单"></span>

## 合上代码前想一想

- **为什么线程安全容器仍会丢更新？** 先分清单次调用和复合操作。
- **synchronized reconnect 能锁住另一个实例吗？** 实例监视器不同，不能这样推导。
- **再往哪儿走？** [08.06](/learn/client-reconnection/)把这些问题放回重连状态里继续聊。
