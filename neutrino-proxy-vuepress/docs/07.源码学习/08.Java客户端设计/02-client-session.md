---
title: "08.02 控制会话与认证结果处理"
date: 2026-10-30
permalink: /learn/client-session/
article: false
status: Review
updated: 2026-10-30
lesson: "08.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    symbol: "userEventTriggered"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java"
    symbol: "handle"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 99
    endLine: 107
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java"
    startLine: 28
    endLine: 37
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java"
    startLine: 55
    endLine: 60
---

# 08.02 控制会话与认证结果处理

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

客户端在线，听起来像一个开关；实现里却至少有 TCP 已连接、AUTH 已发送、认证结果已到、映射可转发几个阶段。我们先把这些状态拆开，后面的重连才不容易绕晕。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

控制 Channel 在什么时候被保存？认证失败是否总会退出进程？unlimited 影响的是哪个分支？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [client / CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java) | `userEventTriggered` |
| [client / ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java) | `handle` |

<span id="正文提纲"></span>

## 一起顺着代码走

### TCP 成功先保存控制连接

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

这里给 ProxyClientService.channel 赋值，也把同一 Channel 保存到 ProxyUtil.cmdChannel，然后发 AUTH，重连计数归零。请注意，归零发生在 TCP 成功时；不是等服务端认证通过才归零。

两处保存的都是对象引用，但作用范围不同：服务对象用它判断是否需要重连，工具类供其他业务流程取得控制连接。排障时不只看一个字段“非空”，还应查 isActive、认证返回和引用是否指向同一会话。

### AUTH 结果由另一条入站链处理

看这段 [ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageAuthHandler.java#L28-L37)（原文件 28～37 行，连续原样节选）：

```java
	public void handle(ChannelHandlerContext context, ProxyMessage proxyMessage) {
		String info = proxyMessage.getInfo();
        ONode load = ONode.load(info);
        Integer code = load.get("code").getInt();
		log.info("Auth result:{}", info);
		if (ExceptionEnum.AUTH_FAILED.getCode().equals(code)) {
			// 客户端认证失败，直接停止服务
			log.info("client auth failed , client stop.");
			context.channel().close();
			if (!proxyConfig.getTunnel().getReconnection().getUnlimited()) {
```

响应 info 作为 JSON 读取 code。AUTH_FAILED 会关闭当前 Channel；是否停应用，还要看 reconnection.unlimited。CONNECT_FAILED 或 LICENSE_CANNOT_REPEAT_CONNECT 也有关闭分支。节选展示认证失败入口，完整方法的后续判断请从源码链接继续读。

这里没有显式设置一个 authenticated=true 字段，成功分支也没有发布“全部映射就绪”的状态。因此我们后面整理状态机时，是从多个回调中提炼教学模型，不是声称项目已经有一个集中式会话状态枚举。

unlimited 的名字容易让人想到重试次数，但在当前代码里，它直接影响认证失败后是否调用 Solon.stop。定时重连函数本身没有按最大次数终止的计数判断；两处要合起来看。

### 控制连接失活时，清理业务连接

看这段 [CmdChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/CmdChannelHandler.java#L55-L60)（原文件 55～60 行，连续原样节选）：

```java
    public void channelInactive(ChannelHandlerContext ctx) throws Exception {
        log.info("[CMD Channel]Client CmdChannel disconnect");
        ProxyUtil.setCmdChannel(null);
        ProxyUtil.clearRealServerChannels();

        super.channelInactive(ctx);
```

控制连接断开后，ProxyUtil 的引用清空，并关闭/清理已登记的真实服务连接。这样下次连接成功并认证后，可以重新建立业务会话。

不过 ProxyClientService.channel 仍是另一个字段，靠后续 isActive 判断失活；不要要求所有字段在同一行代码里同时变成 null。真正该验证的是：旧业务不能继续乱发、调度器能发现失活、重建后不会沿用过时关联。

### 把“在线”变成可检查的描述

日志里至少分清连接成功、认证失败、控制连接失活和目标连接失败。UI 或运维状态若只有一个“在线”，也应该约定它具体代表哪一层；否则一个用户说“在线但用不了”，两个人可能在谈完全不同的事。

本项目 Java 客户端负责通信，桌面进阶才讨论把这些事件转换成界面状态，先把内核语义读准。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在本地服务端使用临时 License，分别让 AUTH 成功、AUTH_FAILED 且 unlimited=false、AUTH_FAILED 且 unlimited=true。记录 TCP 成功日志、AUTH 返回码、Channel 关闭、进程是否结束和后续重试；凭证值不落日志报告。

**怎么验收**：明确区分“TCP 成功但认证失败”和“认证成功但目标不可达”。已有 01.01 覆盖正常会话；unlimited 两组分支未在本轮单独运行。若测试进程被停止，先核对业务策略，不要直接当作重连器失效。

<span id="完善清单"></span>

## 合上代码前想一想

为什么 reconnectCount=0 不能当作认证成功的信号？两个地方保存同一控制 Channel，断开时又如何逐步收敛？接着看 [目标连接](/learn/client-target-connection/)。
