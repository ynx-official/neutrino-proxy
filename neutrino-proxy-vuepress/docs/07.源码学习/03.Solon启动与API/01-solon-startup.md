---
title: "03.01 从 main 到应用加载完成"
date: 2026-10-30
permalink: /learn/solon-startup/
article: false
status: Review
updated: 2026-10-30
lesson: "03.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java"
    symbol: "Solon.start"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/AppLoadEndExecutor.java"
    symbol: "onEvent"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    symbol: "proxyServerCommonInitHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java"
    symbol: "DBInitialize"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java"
    startLine: 20
    endLine: 26
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java"
    startLine: 38
    endLine: 50
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    startLine: 47
    endLine: 51
---

# 03.01 从 main 到应用加载完成

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

main 方法看起来只有十来行，服务端却能接 HTTP、初始化数据库、再开一组隧道监听。中间发生了什么？这篇不用把容器源码一口气翻完，我们先找应用自己留下的几个接力点。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

控制台出现“应用已启动”，是不是就能宣布映射已经能用了？先想想它至少还欠哪些条件，再跟着入口往下走。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / ProxyServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java) | `Solon.start` |
| [server / AppLoadEndExecutor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/AppLoadEndExecutor.java) | `onEvent` |
| [server / ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java) | `proxyServerCommonInitHandler` |
| [server / DBInitialize.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java) | `DBInitialize` |

<span id="正文提纲"></span>

## 一起顺着代码走

### main 把应用交给容器

看这段 [ProxyServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java#L20-L26)（原文件 20～26 行，连续原样节选）：

```java
	public static void main(String[] args) {
		Solon.start(ProxyServer.class, args, app -> {
			// 跨域支持。加-1 优先级更高
			app.filter(-1, new CrossFilter().allowedOrigins("*"));
            String loglevel = System.getenv("LOG_LEVEL");
            if (Utils.isNotEmpty(loglevel)) {
                app.cfg().put("solon.logging.logger.root.level", loglevel);
```

入口把 ProxyServer 交给 Solon，顺便设置跨域过滤器和日志配置。类上的组件、配置、事件监听器等声明，接下来由框架参与组装。

你在这里没有看到手写 `new PortMappingService()`，不代表对象没人创建。读这类项目时，除了方法调用，还要顺着注解和注入关系找。一个对象能被引用，往往先要经过配置解析、Bean 创建和依赖注入。

跨域过滤器位于 HTTP 处理链；它不替代后面的登录、权限或代理认证。看到一个全局过滤器，也别把它理解成“所有流量都已经经过这套 HTTP 逻辑”，Netty 数据链路另有入口。

### 初始化动作可能藏在另一种钩子里

看这段 [DBInitialize.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java#L38-L50)（原文件 38～50 行，连续原样节选）：

```java
	@Init
	public void init() throws Throwable {
        // aot 阶段，不初始化数据库
        if (NativeDetector.isAotRuntime()) {
            return;
        }
		Assert.notNull(dbConfig.getType(), "neutrino.data.db.type不能为空!");
		dbTypeEnum = DbTypeEnum.of(dbConfig.getType());
		Assert.notNull(dbTypeEnum, "neutrino.data.db.type取值异常!");

		log.info("{} database init...", dbConfig.getType());
		initDBStructure();
		initDBData();
```

DBInitialize 虽然也实现了 AppLoadEndEvent 的监听接口，实际建表与初始数据操作却写在 `@Init` 的 init 方法里，它自己的 onEvent 是空实现。

这就是一个很适合停一下的地方：如果只搜事件接口，会不会漏掉真正的工作？看生命周期时，方法注解、接口实现和依赖关系都要照顾到。文件在目录里的先后顺序，不是可靠的执行顺序说明书。

这里还区分了 AOT 阶段。生成原生相关元数据时，不应该顺手把真实数据库或监听端口都启动起来。具体 AOT 逻辑到[后面的课程](/learn/native-aot/)再细看，现在先记住“构建阶段”和“正常运行阶段”是有边界的。

### 应用加载完成后 隧道再接过接力棒

看这段 [ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java#L47-L51)（原文件 47～51 行，连续原样节选）：

```java
	public void onEvent(AppLoadEndEvent appLoadEndEvent) throws Throwable {
        // aot 阶段，不启动代理服务
        if (NativeDetector.isNotAotRuntime()) {
            startProxyServer();
            startProxyServerForSSL();
```

ProxyTunnelServer 在应用加载完成事件里开启明文与 SSL 监听。监听用的线程组和配置，前面已经通过注入拿到。

可以先画一张局部依赖图：

```text
main → Solon 应用
  → 配置与 Bean 组装
  → DBInitialize 的初始化逻辑
  → 应用加载完成事件
  → ProxyTunnelServer 开启隧道监听
```

这张图帮助你理解应用自己的钩子，不用于断言所有 Bean 之间都有这一个固定总顺序。想知道某两个组件谁先执行，还需要看实际依赖、框架生命周期和日志。

### 就绪最好分成几个能观察的台阶

进程活着、管理 API 能调用、隧道端口能握手、客户端认证完成、映射已经监听、目标连接成功，分别是不同台阶。

我们的本地集成实验就是逐步等这些条件，再做字节往返，而不是看到 banner 就直接认定一切可用。以后自己加启动检查，也可以按这个思路写：每条“已就绪”都要对应一个具体、能失败的观察点。

另外，Maven 构建成功不表示启动过程已经发生。打包插件的输出、应用运行日志和真实 Socket 请求，是不同证据，别混成一句“启动没问题”。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：把三个钩子连起来，再用本地实验验证从启动到请求的几层条件。

先在源码里找到 main、DBInitialize.init、ProxyTunnelServer.onEvent，写下“它由谁触发、拿到了哪些依赖、会产生什么副作用”。

再运行本地集成实验：

```powershell
python scripts/learning/project_overview.py
```

如果遇到本机 Windows JDK 的已知管道环境错误，使用 [01.01](/learn/project-overview/) 中说明的专用选项。已有[实测结果](/labs/project-overview-result.json)证明正常链路能够往返，也保留了不可达目标的失败项。

这次练习的预期是：你能把“构建完成、进程启动、监听建立、认证、转发”拆开记录。完整初始化时序仍需自己按实际日志或断点核对，不能把上面的局部依赖图当成已采集的全量启动追踪。

<span id="完善清单"></span>

## 合上代码前想一想

- **实现了事件接口，就能只看 onEvent 吗？** 看看同一个类里还有没有 Init 或其他生命周期入口。
- **为什么 AOT 分支跳过数据库与监听？** 构建期间不应该自动执行正常运行的外部副作用。
- **想继续找对象从哪来？** 接着看 [03.02](/learn/solon-injection/)。
