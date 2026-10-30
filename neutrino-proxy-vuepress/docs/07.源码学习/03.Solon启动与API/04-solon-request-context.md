---
title: "03.04 登录上下文 拦截器与清理边界"
date: 2026-10-30
permalink: /learn/solon-request-context/
article: false
status: Review
updated: 2026-10-30
lesson: "03.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    symbol: "doIntercept"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/SystemContextHolder.java"
    symbol: "remove"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    startLine: 38
    endLine: 40
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/SystemContextHolder.java"
    startLine: 11
    endLine: 18
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    startLine: 69
    endLine: 71
---

# 03.04 登录上下文 拦截器与清理边界

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

业务方法里明明没传 user 参数，却能拿到“当前用户”。这通常是读后端时一个很自然的好奇点。我们顺着 SystemContextHolder 看看它怎么存、怎么取，再故意忘一次清理，观察线程复用时会发生什么。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

一个线程先处理用户 A，再处理用户 B，ThreadLocal 会在两次请求之间自动清空吗？如果把任务交给另一个线程，当前用户又会自动跟过去吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java) | `doIntercept` |
| [server / SystemContextHolder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/SystemContextHolder.java) | `remove` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 请求进来时 先放一个上下文进去

看这段 [BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java#L38-L40)（原文件 38～40 行，连续原样节选）：

```java
        SystemContext systemContext = new SystemContext();
        SystemContextHolder.set(systemContext);
        systemContext.setIp(ctx.realIp());
```

拦截器在当前线程放入一个新的 SystemContext，先记录 IP。接下来读取 Authorize 头、查 Token、检查用户状态和管理员限制，通过后再把 Token 与用户对象写进去。

注意它不是收到请求就已经有了可信用户。上下文对象存在、登录校验成功、拥有某项操作权限，是要分别判断的状态。后续 Service 读取当前用户，也不能替代对具体业务对象的权限检查。

### Holder 实际用的是 ThreadLocal

看这段 [SystemContextHolder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/SystemContextHolder.java#L11-L18)（原文件 11～18 行，连续原样节选）：

```java
	private static final ThreadLocal<SystemContext> systemContextHolder = new ThreadLocal<>();

	public static void remove() {
		systemContextHolder.remove();
	}

	public static void set(SystemContext systemContext) {
		systemContextHolder.set(systemContext);
```

ThreadLocal 把值关联到当前线程。它让这个线程里的方法少传一些重复参数，但也引入一个生命周期问题：线程可能被复用，而请求已经结束。

你可以把“当前用户”想成贴在线程座位上的纸条。换一个请求坐过来，纸条不会因为你换了任务就自己消失；得有人明确换掉或收走。这个比喻只帮助记住清理责任，真正的语义还是按 ThreadLocal 与实际调用路径核对。

另外，普通 ThreadLocal 里的值不会自动跑到另一个线程。把任务丢给线程池、进入 Netty 的 EventLoop，不能顺手假设原请求用户还在那里。

### 清理写在结果处理的开头

看这段 [BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java#L69-L71)（原文件 69～71 行，连续原样节选）：

```java
    public Object postResult(Context ctx, Object result) throws Throwable {
        SystemContextHolder.remove();
        if (result instanceof ResponseBody) {
```

当前实现把 remove 放在 postResult 的开头，再做响应包装。这样能看出作者安排的清理位置。

不过，“源码有 remove”与“所有异常都经过了它”仍要分开。认证之前抛出的异常、业务异常、框架提前结束、异步任务，这些路径各自有没有进入清理钩子，需要用框架实际行为验证。这里不凭一个方法就宣布整个请求系统没有上下文残留。

读辅助方法时也能发现差异：getUser 会处理上下文为空的情况，而某些直接从 holder.get() 往下取字段的方法没有同样的空值保护。到了不是 HTTP 请求的线程，更应该先确认上下文是否存在。

### 先把线程复用这个现象跑出来

基础实验使用项目真实的 SystemContextHolder：主线程放入上下文，单线程执行器第一次读取时拿不到它；执行器自己的线程放入新上下文后，下一次任务仍能读到；调用 remove，再下一次才回到空值。

这几个现象合起来，比一句“ThreadLocal 线程安全”更具体。它隔离的是线程之间的值，不会自动替你管理一次请求的开始和结束，也不会自动替你传递跨线程身份。

如果将来确实需要传递身份，先明确传哪些最少必要信息、任务结束时谁清理，再选择传参或项目里的其他机制；本篇先把现有实现读准确。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在同一个池线程上连续提交三个任务，观察设置、残留和清理。

运行基础实验：

```powershell
python scripts/learning/foundations_lab.py
```

[实测记录](/labs/foundations-result.json)中的 threadlocal_not_automatically_inherited、pooled_thread_keeps_uncleared_context、remove_clears_reused_thread、main_context_is_separate 已通过，直接使用了项目 Holder。

这验证了 Holder 与线程复用的基础语义，没有替代完整 HTTP 拦截器的异常集成测试。继续动手时，可在临时本地 API 环境分别制造未登录、业务校验失败和正常返回，记录 postResult 是否执行以及下一次请求的上下文。这里列的是待你核对的请求路径，报告没有把它们写成已全部执行。

<span id="完善清单"></span>

## 合上代码前想一想

- **为什么换了任务，池线程还能读到旧值？** 值跟线程关联，任务切换本身不等于 remove。
- **新线程拿不到值，是不是 Holder 坏了？** 普通 ThreadLocal 的隔离正是这样工作的。
- **下一步怎么接业务？** 去 [04.01](/learn/database-model/)把用户、License 和端口映射的对象关系先理顺。
