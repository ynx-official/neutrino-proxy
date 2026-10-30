---
title: "01.03 本地调试与第一条 TCP 映射"
date: 2026-10-30
permalink: /learn/local-debugging/
article: false
status: Review
updated: 2026-10-30
lesson: "01.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java"
    symbol: "Solon.start"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java"
    symbol: "setAlias"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    symbol: "create"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "ProxyMessageConnectHandler"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java"
    startLine: 39
    endLine: 42
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 34
    endLine: 39
---

# 01.03 本地调试与第一条 TCP 映射

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

项目一启动就是几个端口、两份配置，再加一个目标服务，第一次跑很容易变成“改一处、再试一次”。我们先把环境缩到最小：同一台机器、一条 TCP 映射、一个会原样回话的 Echo 服务。先知道数据去哪儿，再考虑公网和域名。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

你在映射里填了 127.0.0.1，这个“本机”到底属于谁？先回答这个问题，很多看似玄学的连接失败就能少走一半弯路。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / ProxyServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java) | `Solon.start` |
| [client / ProxyClient.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java) | `setAlias` |
| [server / PortMappingController.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java) | `create` |
| [client / ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java) | `ProxyMessageConnectHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先画四个端口 不用急着启动

| 名字 | 谁访问它 | 我们这次拿它做什么 |
| --- | --- | --- |
| 管理端口 | 本地实验脚本 | 登录并创建测试配置 |
| 隧道端口 | Java 客户端 | 建控制连接和数据连接 |
| 映射端口 | 模拟访问者 | 发送准备好的二进制字节 |
| 目标端口 | Java 客户端 | 连接 Echo 服务 |

实验脚本会动态分配端口。它们承担的职责固定，具体数字每次可以不同。先给端口写上角色，再抄数字，排障时就不容易把隧道端口当成业务访问入口。

我们沿用 [01.01](/learn/project-overview/) 的真实进程实验：server、client 是项目 JAR，Echo 是本地测试目标。H2 和运行配置都放在新建临时目录里。实验结束后进程会停止，报告里的端口用于回看当时的拓扑。

### 短参数最后落到哪里

看这段 [ProxyClient.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java#L39-L42)（原文件 39～42 行，连续原样节选）：

```java
	private static void setAlias(String key, String alias) {
		String val = Solon.cfg().argx().get(alias);
		if (StrUtil.isNotBlank(val)) {
			Solon.cfg().put(key, val);
```

客户端启动入口会为 serverIp、serverPort、sslEnable 等短参数设置别名。这里读的是启动参数：短参数非空，就把对应长键写进应用配置。你至少可以沿着这条路径解释一次覆盖过程。

先别据此宣布所有配置来源的完整优先级。环境变量、资源文件、外部 app.yml 和启动参数如何汇合，还要结合配置加载过程看。初次调试时，用一份明确的测试配置，逐项记录最终消费的值，通常比同时改四个来源更快。

### 目标连接发生在客户端

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L34-L39)（原文件 34～39 行，连续原样节选）：

```java
		final String visitorId = proxyMessage.getInfo();
		String[] serverInfo = new String(proxyMessage.getData()).split(":");
		String ip = serverInfo[0];
		int port = Integer.parseInt(serverInfo[1]);
		// 连接真实的、被代理的服务
		realServerBootstrap.connect(ip, port).addListener(new ChannelFutureListener() {
```

看 `realServerBootstrap.connect(ip, port)`。发起目标连接的，是 Java 客户端所在进程。因而目标地址为 localhost 时，目标要在客户端能访问的那一侧；客户端放进容器后，要按容器的网络视角重新理解它。

可以用一个很小的对照来检查自己：server 在机器 A，client 和 Echo 在机器 B，映射指向 127.0.0.1。Echo 应该在 B 上。这个判断来自连接发起的位置，不需要猜公网地址。

### 给每一步留一个能看见的证据

我通常把“启动成功”拆开记：

1. Maven 产物存在，而且确实由本次源码构建。
2. server 进程存活，管理 API 可调用。
3. client 连上隧道，服务端返回认证结果。
4. 映射能接入访问者。
5. client 能连接目标，请求和响应字节一致。

它们是逐层增加的条件。第 2 步成功，不能替第 5 步签字。文章里的“在线”，也要看它具体在描述控制连接、License 状态还是目标服务。

### 先让实验帮你兜住环境

现成脚本会创建自己的测试 License、端口池和两条映射，不读取你原来的连接配置。它只主动访问 127.0.0.1，并把管理 HTTP 调用的环境代理关掉，方便把注意力留在项目逻辑上。

本机 Windows 的 JDK 曾在 Selector 初始化时遇到 AF_UNIX 管道错误。那发生在代理认证之前，环境处理方式集中放在 [01.01 的实验说明](/learn/project-overview/)；别把一段底层启动栈直接解释成 License 错误。

还有一件值得提前知道：我们已经实测到，不可达目标那条映射在 3 秒内没有关闭访问者。脚本会保留失败结果并退出 1。拿到这个结果时，正常转发不一定有问题，先按报告里的检查项拆开看。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：跑一次真实链路，再对照报告标出四个端口。

在仓库根目录执行：

```powershell
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
python scripts/learning/project_overview.py
```

若命中前文所述的 Windows JDK 管道错误，再使用文章中对应的本地兼容选项：

```powershell
python scripts/learning/project_overview.py --windows-tcp-pipe
```

对照[已有实测记录](/labs/project-overview-result.json)，找到 management、tunnel、mapping 和 target。记录代理往返的字节数、哈希，以及失败检查的名字。不要把已有报告的动态端口复制到下一次配置里。

已有记录证明的是这次本地集成结果：65,536 字节往返一致，另有目标不可达超时未满足关闭要求。公网 NAT、跨机器 TLS 和长期负载仍在这个实验范围之外。

<span id="完善清单"></span>

## 合上代码前想一想

- **把 serverPort 当成映射端口会怎样？** 可能访问到隧道协议入口，表现和目标服务无关。
- **管理接口能登录，目标却不可达，先查哪一侧？** 先从 client 的网络视角检查目标地址。
- **下一步怎么读得更快？** 到 [01.04](/learn/source-reading-method/)给一次访问串上 visitorId 和断点。
