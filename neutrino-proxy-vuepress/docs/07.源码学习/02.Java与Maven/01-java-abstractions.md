---
title: "02.01 接口 泛型 注解与消息分发"
date: 2026-10-30
permalink: /learn/java-abstractions/
article: false
status: Review
updated: 2026-10-30
lesson: "02.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java"
    symbol: "dispatch"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Match.java"
    symbol: "Match"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Handler.java"
    symbol: "Handler"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Handler.java"
    startLine: 8
    endLine: 15
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Match.java"
    startLine: 10
    endLine: 14
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java"
    startLine: 48
    endLine: 62
---

# 02.01 接口 泛型 注解与消息分发

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

这篇先不背“泛型、注解、反射”三件套。我们就看一个小机关：收到不同消息，项目怎么找到对应的 Handler？你把这个机关拆明白，三个概念会自己落到代码上。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

如果新加一种消息，你准备在总入口塞一段 if，还是让它找到自己的处理器？先想想这两种写法分别把变化放在哪儿。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / DefaultDispatcher.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java) | `dispatch` |
| [core / Match.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Match.java) | `Match` |
| [core / Handler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Handler.java) | `Handler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 接口先约定一件能共同完成的事

看这段 [Handler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Handler.java#L8-L15)（原文件 8～15 行，连续原样节选）：

```java
public interface Handler<Context, Data> {

	/**
	 * 处理
	 * @param context
	 * @param data
	 */
	void handle(Context context, Data data);
```

接口不关心你在处理认证、连接还是转发，只约定“拿到上下文与数据，做一次处理”。泛型把两者的类型留给使用者决定。放到代理消息里，Context 可以是 Netty 的 ChannelHandlerContext，Data 可以是 ProxyMessage。

这样，上层分发器不用知道每个处理器有多少字段，只要能通过同一个接口调用它。先把这层关系看成“统一插口”，再去学更抽象的设计术语，会容易一些。

你还会看到 Handler 的默认 `name()` 返回空字符串。它是可选的日志名字，不是查找处理器用的路由键。路由键在下一段。

### 注解本身不会替你分发消息

看这段 [Match.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/Match.java#L10-L14)（原文件 10～14 行，连续原样节选）：

```java
@Target({ElementType.TYPE})
@Retention(RetentionPolicy.RUNTIME)
@Documented
public @interface Match {
	String type();
```

`@Target(TYPE)` 表示它贴在类型上，`RUNTIME` 表示运行时还能读到。这里放了一个字符串 type，用来描述这个处理器想接哪类消息。

但注解不是后台偷偷运行的小程序。得有人主动把它读出来，标记才能参与工作。项目里这位“读标记的人”就是 DefaultDispatcher 的构造过程。

### 真正把注解用起来的是这段循环

看这段 [DefaultDispatcher.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/dispatcher/DefaultDispatcher.java#L48-L62)（原文件 48～62 行，连续原样节选）：

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
```

跟着循环走一遍：拿到处理器对象，反射读取类上的 Match；没标记就跳过；type 为空也跳过；路由键已经有人占了，记录日志并保留前一个；都没问题，才放进 handlerMap。

到这里再回想泛型：Map 的值统一面向 Handler 接口，Key 是运行时从注解读到的字符串。接口、泛型和注解，分别解决“能怎么调用”“输入是什么类型”“用哪个键注册”三个问题。

构造完成以后，`dispatch` 先调用 matcher 从数据中取键，再查 Map，最后调用 handler.handle。matcher 是传进来的函数，所以分发器不必硬编码“代理消息的哪一位是类型”。

### 没匹配上时 先看真实分支

这个实现里，找不到 Handler 就直接返回。不要把它想当然地理解成“自动报协议错误并断开”。同样，重复键保留谁，取决于传入处理器列表的顺序；“保留第一个”不等于配置重复是一个值得依赖的业务规则。

这也是读源码的乐趣：概念很漂亮，真正的行为仍藏在几个 if 里。你要接着判断，这种行为是否符合所处协议的需求，而不是只给它贴一个设计模式名字。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：直接运行项目分发器，看看已知、未知和重复路由三种情况。

仓库根目录已有 `scripts/learning/FoundationsLab.java`，通过真实的 DefaultDispatcher、Handler 和 Match 做小实验。先构建 JAR，再运行：

```powershell
mvn -B -pl neutrino-proxy-server -am package
python scripts/learning/foundations_lab.py
```

在[实测记录](/labs/foundations-result.json)里找 dispatcher_known_type、dispatcher_duplicate_keeps_first、dispatcher_unknown_type_ignored。三个检查已通过：已知键命中；重复键的后一个没有被调用；未知键没有调用任何处理器。

实验的 Hit 是教学用小处理器，直接调用的是项目分发器；它没有启动真实隧道，也不能替代 AUTH 的网络集成测试。接着试着只改教学处理器的 Match 值，先预测哪条断言会变，再运行核对。

<span id="完善清单"></span>

## 合上代码前想一想

- **把 RUNTIME 换掉会影响哪一步？** 先回去看 getAnnotation，而不是先改 dispatch。
- **泛型能保证路由键永不重复吗？** 不能，键冲突是运行时注册逻辑检查的。
- **想继续挖？** [06.04](/learn/protocol-dispatcher/)会把这套分发器接回真实协议消息。
