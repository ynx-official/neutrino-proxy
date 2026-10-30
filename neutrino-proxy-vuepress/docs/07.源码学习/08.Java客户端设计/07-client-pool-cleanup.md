---
title: "08.07 通道池 连接关闭与资源所有权"
date: 2026-10-30
permalink: /learn/client-pool-cleanup/
article: false
status: Review
updated: 2026-10-30
lesson: "08.07"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    symbol: "borrowTcpProxyChanel"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageDisconnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    symbol: "channelWritabilityChanged"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    startLine: 54
    endLine: 67
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    startLine: 70
    endLine: 76
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java"
    startLine: 45
    endLine: 57
---

# 08.07 通道池 连接关闭与资源所有权

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

看到 MAX_POOL_SIZE=100，先猜一下：它限制一百个在线用户吗？答案要沿 borrow、return、inactive 三个入口一起看。只看常量名，很容易把空闲池容量读成整个客户端并发上限。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

池里没有连接时是等待还是新建？归还时检查连接活跃吗？channelInactive 又为什么先归还、随后移除？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java) | `borrowTcpProxyChanel` |
| [client / ProxyMessageDisconnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageDisconnectHandler.java) | `handle` |
| [client / TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java) | `channelWritabilityChanged` |

<span id="正文提纲"></span>

## 一起顺着代码走

### borrow 没有等待一个“名额”

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java#L54-L67)（原文件 54～67 行，连续原样节选）：

```java
	public static void borrowTcpProxyChanel(Bootstrap tcpProxyTunnelBootstrap, final ProxyChannelBorrowListener borrowListener) {
		Channel channel = tcpProxyChannelPool.poll();
		if (null != channel) {
			borrowListener.success(channel);
			return;
		}

		tcpProxyTunnelBootstrap.connect().addListener((ChannelFutureListener) future -> {
			if (future.isSuccess()) {
				borrowListener.success(future.channel());
			} else {
				borrowListener.error(future.cause());
			}
		});
```

先 poll 队列，有连接就直接回调成功；没有就 connect 新建。这里没有 semaphore，也没有“活动连接达到 100 就拒绝”的逻辑。

因此 MAX_POOL_SIZE 管的是归还时的池容量意图，不是同时在线业务数量上限。大量访问者仍可能创建很多活动连接。若要设计真正的并发配额，还需要计数、排队/拒绝策略和释放许可，不能复用一个常量名充当它们。

### return 的细节比名字更有用

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java#L70-L76)（原文件 70～76 行，连续原样节选）：

```java
	public static void returnTcpProxyChanel(Channel proxyChanel) {
		if (tcpProxyChannelPool.size() > MAX_POOL_SIZE) {
			proxyChanel.close();
		} else {
			proxyChanel.config().setOption(ChannelOption.AUTO_READ, true);
			proxyChanel.attr(Constants.NEXT_CHANNEL).remove();
			tcpProxyChannelPool.offer(proxyChanel);
```

归还时恢复 AUTO_READ、删除 NEXT_CHANNEL、放回队列。条件是 size > MAX_POOL_SIZE 而不是 >=；单次顺序情况下 size 为 100 时仍可再 offer 一个，并发 size 检查与 offer 也不是同一个原子操作。

borrow 分支没有在返回前显式验证 isActive，return 也未统一检查会话属性是否全清空。不要因为方法叫“连接池”，就假设具备成熟池组件的健康检查、淘汰和租借所有权保障。

### 再看真实调用路径，复用未必发生

看这段 [TcpProxyChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/TcpProxyChannelHandler.java#L45-L57)（原文件 45～57 行，连续原样节选）：

```java
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        // 数据传输连接
        Channel realServerChannel = ctx.channel().attr(Constants.NEXT_CHANNEL).get();
        if (null != realServerChannel && realServerChannel.isActive()) {
            // realServerChannel.close();
            realServerChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
        }

        ProxyUtil.returnTcpProxyChanel(ctx.channel());
        ctx.channel().attr(Constants.NEXT_CHANNEL).remove();
        ProxyUtil.removeTcpProxyChanel(ctx.channel());

        super.channelInactive(ctx);
```

channelInactive 中先尝试关闭真实连接，然后 returnTcpProxyChanel，紧接着移除 NEXT_CHANNEL 和 removeTcpProxyChanel。也就是说，这条失活路径把连接放入后又移出了；不能据此宣传“每次请求结束都复用连接”。

客户端收到 DISCONNECT 的有效实现直接 ctx.close；真实服务 channelInactive 也常关闭数据隧道。实际复用率要观察活跃归还路径和运行指标，而不是从队列存在就推导。

### 所有权至少分三段

| 阶段 | 需要回答的问题 |
| --- | --- |
| 借到但未绑定 | 谁持有，失败谁关 |
| 已绑定业务 | 谁能关闭，双方属性如何清理 |
| 空闲/失活 | 是否仍可借出，如何防旧属性串入新会话 |

控制连接退出时 clearRealServerChannels 会清理已登记的真实连接，队列是另一组资源。重新连接成功，不意味着所有历史资源已自动消失。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：用教学 EmbeddedChannel 为 pool 构造借出/归还/移除的可控序列，记录队列变化、isActive 和 NEXT_CHANNEL。再在本地真实网络中跑两次短连接业务，比较 Channel ID 是否复用。不要只用 size 断言代替资源检查。

**怎么验收**：能说明容量常量的真实作用、顺序条件可能到 101 的边界，以及 inactive 先归还后移除的当前路径。这些池场景本轮未新增实测；01.01 的正常往返不提供复用率或大量并发证据。

<span id="完善清单"></span>

## 合上代码前想一想

如果有人说“池最大 100，所以最多 100 用户”，你会指出哪段代码？若要稳定复用，归还前至少应确认哪些状态？最后到 [客户端状态机](/learn/client-state-machine/) 把散落回调收成一张表。
