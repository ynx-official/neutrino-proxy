---
title: "06.04 从消息类型到 Handler 的分发"
date: 2026-10-30
permalink: /learn/protocol-dispatcher/
article: false
status: Review
updated: 2026-10-30
lesson: "06.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java"
    symbol: "dispatch"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Match.java"
    symbol: "Match"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/proxy/ProxyConfiguration.java"
    symbol: "tcpServerBootstrap"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "ProxyConfiguration"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 36
    endLine: 40
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java"
    startLine: 48
    endLine: 64
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java"
    startLine: 68
    endLine: 86
---

# 06.04 从消息类型到 Handler 的分发

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

同样是 AUTH，服务端要检查 License，客户端要处理认证结果。消息里只有一个 type，怎么就找到各自正确的业务类？答案不在一大段 switch 里，而在项目启动时建立的小路由表中。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

@Match 如何变成可执行的分发规则？新处理器缺注解、重复类型或未知类型时，当前实现到底怎么处理？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / DefaultDispatcher.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java) | `dispatch` |
| [core / Match.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Match.java) | `Match` |
| [server / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/proxy/ProxyConfiguration.java) | `tcpServerBootstrap` |
| [client / ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java) | `ProxyConfiguration` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 启动时先收集处理器

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L36-L40)（原文件 36～40 行，连续原样节选）：

```java
        List<ProxyMessageHandler> list = Solon.context().getBeansOfType(ProxyMessageHandler.class);
        Dispatcher<ChannelHandlerContext, ProxyMessage> dispatcher = new DefaultDispatcher<>("MessageDispatcher", list,
                proxyMessage -> ProxyDataTypeEnum.of((int)proxyMessage.getType()) == null ?
                        null : ProxyDataTypeEnum.of((int)proxyMessage.getType()).getName());
        Solon.context().wrapAndPut(Dispatcher.class, dispatcher);
```

Solon 收集当前应用里的 ProxyMessageHandler，交给 DefaultDispatcher。matcher 把消息的数值 type 转成 ProxyDataTypeEnum 中的名字。客户端应用收的是客户端处理器；服务端应用有自己的收集过程。所以“同名消息类型”不会自动把两端 Handler 混成同一个列表。

真实链路是：Channel Handler → Dispatcher.dispatch → matcher → handlerMap 查询 → 业务 handle。Dispatcher 本身没有另外调度线程，默认是在调用它的线程中继续执行；名字叫分发，不代表自动异步。

### 注解只是一份输入，构造器才执行规则

看这段 [DefaultDispatcher.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java#L48-L64)（原文件 48～64 行，连续原样节选）：

```java
		for (Handler handler : handlerList) {
			Match match = handler.getClass().getAnnotation(Match.class);
			if (null == match) {
				log.warn("{} class: {} notfound Match annotation", this.name, handler.getClass().getName());
				continue;
			}
			if (StrUtil.isEmpty(match.type())) {
				log.warn("{} class: {} match annotation notfound type param！", this.name, handler.getClass().getName());
				continue;
			}
			if (handlerMap.containsKey(match.type())) {
				log.warn("{} class: {} match annotation type value {} repeat!", this.name, handler.getClass().getName(), match.type());
				continue;
			}
			handlerMap.put(match.type(), handler);
		}
		log.info("{} dispatcher init success", this.name);
```

把分支逐个读出来：没 @Match 就跳过，type 为空就跳过，重复类型也跳过。**重复时保留先遇到的那个**，而不是覆盖，也不是直接终止启动。

这不意味着应用里应该故意注册重复处理器。框架返回 Bean 的列表顺序未在这段代码中定义，依赖“恰好谁先出现”会让行为难以维护。日志出现 init success，也不能证明每个期待的类型都注册成功。

### 收到一个找不到的类型会怎样

看这段 [DefaultDispatcher.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java#L68-L86)（原文件 68～86 行，连续原样节选）：

```java
	public void dispatch(Context context, Data data) {
		if (CollectionUtil.isEmpty(handlerMap)) {
			return;
		}
		String type = matcher.apply(data);
		if (null == type) {
			log.warn("{} get match type failed data:{}", this.name, ONode.serialize(data));
			return;
		}
		Handler<Context,Data> handler = handlerMap.get(type);
		if (null == handler) {
			return;
		}
		String handlerName = handler.name();
		if (StrUtil.isEmpty(handlerName)) {
			handlerName = TypeUtil.getSimpleName(handler.getClass());
		}
		log.debug("{} handler[{}]execute.", this.name, handlerName);
		handler.handle(context, data);
```

matcher 返回 null 会告警并返回；类型名字没有对应 Handler 也直接返回。当前代码没有在这里统一返回错误帧。排障时若只盯着“Decoder 没报错”，可能忽略消息已经在分发层被丢下了。

PORT_MAPPING_SYNC 在枚举中有值，是否真正可用还要继续找对应处理器与调用方。枚举里列出一种消息，并不能证明它有完整实现。

### 加一个消息要补齐哪几处

用纸笔列出最短清单：数值 type 和名字约定、构造与解析、两端各自 Handler、容器注册、方向与状态约束、协议测试。只在枚举中添一项，或者只写一个带注解的类，都可能留下缺口。

教学基础实验直接实例化真实 Dispatcher，使用自定义 Hit Handler 和按 info 匹配的教学 matcher，验证命中、重复保留第一项、未知类型忽略。它验证的是调度器规则，不是实际 Solon 扫描或 AUTH 业务认证。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先跟踪服务端 AUTH 与客户端 AUTH 两个 @Match 类，再比较 CONNECT 的两个方向。重跑基础实验的三项 dispatcher 检查；在教学副本增加一个没有 @Match 的 Handler，观察注册日志和执行计数。

**已有实测**：命中、重复与未知分支已通过，见[记录](/labs/foundations-result.json)。**待执行**：无注解分支和完整 Solon Bean 注册覆盖检查。验收时必须分别列出真实项目 matcher 与教学 matcher 的差异，避免把小工具结果扩大成全部业务链已覆盖。

<span id="完善清单"></span>

## 合上代码前想一想

如果有人新增 Handler 后消息仍不生效，你会先核对哪四件事？为什么这里的 HashMap 在构造后只读，与业务运行中随时改注册表是不同问题？最后用 [边界测试](/learn/protocol-boundary-tests/) 把前几篇串起来。
