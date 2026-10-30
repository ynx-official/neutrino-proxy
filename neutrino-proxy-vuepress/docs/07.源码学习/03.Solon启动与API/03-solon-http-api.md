---
title: "03.03 HTTP 路由 参数与响应包装"
date: 2026-10-30
permalink: /learn/solon-http-api/
article: false
status: Review
updated: 2026-10-30
lesson: "03.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    symbol: "create"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    symbol: "doIntercept"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    startLine: 23
    endLine: 25
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    startLine: 37
    endLine: 49
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    startLine: 69
    endLine: 82
---

# 03.03 HTTP 路由 参数与响应包装

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

回到比较熟悉的 HTTP 接口，我们选“创建端口映射”来走一遍。熟悉归熟悉，这里也有几个很容易凭经验看错的点：路由在哪里拼起来、默认值在哪补、最后那个业务 code 是谁加上的？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

接口返回了 HTTP 200，是不是说明映射创建成功？先别急着回答，看看响应包装把成功和失败写到了哪里。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / PortMappingController.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java) | `create` |
| [server / BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java) | `doIntercept` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 路由先从两层声明拼起来

看这段 [PortMappingController.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java#L23-L25)（原文件 23～25 行，连续原样节选）：

```java
@Mapping("/port-mapping")
@Controller
public class PortMappingController {
```

类上给了一段公共路径，方法上再声明具体操作。创建对应 /port-mapping/create，分页对应 /port-mapping/page；部署配置还会加应用的 context-path。

读接口地址时，这三层都别漏：应用前缀、Controller 路径、方法路径。源码里少了部署前缀，不表示实际 HTTP 请求也没有它。反过来，别把前缀重复拼两遍。

### Controller 接住协议输入 并做一轮检查

看这段 [PortMappingController.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java#L37-L49)（原文件 37～49 行，连续原样节选）：

```java
    @Mapping("/create")
    public PortMappingCreateRes create(PortMappingCreateReq req) {
        ParamCheckUtil.checkNotNull(req, "req");
        ParamCheckUtil.checkNotNull(req.getLicenseId(), "licenseId");
        ParamCheckUtil.checkNotNull(req.getServerPort(), "serverPort");
        ParamCheckUtil.checkNotNull(req.getClientPort(), "clientPort");
        ParamCheckUtil.checkNotEmpty(req.getProtocal(), "protocal");
		ParamCheckUtil.checkMaxLength(req.getDescription(), 50, "描述", "50");
        ParamCheckUtil.checkBytesDesc(req.getUpLimitRate(), "upLimitRate");
        ParamCheckUtil.checkBytesDesc(req.getDownLimitRate(), "downLimitRate");
        if (StringUtils.isBlank(req.getClientIp())) {
            // 没传客户端ip，默认为127.0.0.1
            req.setClientIp("127.0.0.1");
```

请求对象接住输入后，这里先检查必要字段，再把空的 clientIp 补成 127.0.0.1。往下还会解析协议、处理域名映射字段、补 UDP 相关参数等默认值。

所以，当前实现的 Controller 既有协议入口校验，也做了一些输入归一化。不要只按理想分层把这部分行为忽略掉。然后它才调用 PortMappingService.create，进入 License、端口池、重复映射与持久化等业务处理。

如果你平时写 CRUD，很容易把这条链路看到 Mapper 就收尾。但端口映射还有网络副作用：保存后可能继续更新运行中的监听和缓存。我们到[纵向切片课程](/learn/port-mapping-crud/)再把这一段追完。

### 参数怎么传 先跟实际请求对上

本地实验脚本通过表单编码调用管理 API，已经走通过当前创建流程。你读接口时，可以同时打开前端 API 封装或这个脚本，对照字段名、内容类型和认证头。

尤其是 `protocal` 这个项目现有拼写，调用时需要与真实字段对齐。教学里把它改得“更好看”，却不说明改动，读者照着发请求就会踩坑。

至于别的 JSON 形状能否绑定，不要只凭 Req 类推断。它还和路由框架、序列化支持及入口声明有关，最好用一条真实请求确认。

### 响应最后还会经过包装

看这段 [BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java#L69-L82)（原文件 69～82 行，连续原样节选）：

```java
    public Object postResult(Context ctx, Object result) throws Throwable {
        SystemContextHolder.remove();
        if (result instanceof ResponseBody) {
            return result;
        }

        if (result instanceof Throwable) {
            log.error("global error", (Throwable) result);

            if (result instanceof ServiceException) {
                ServiceException exception = (ServiceException) result;
                return new ResponseBody<>()
                        .setCode(exception.getCode())
                        .setMsg(exception.getMsg());
```

postResult 开头移除上下文；已有 ResponseBody 就保留，遇到业务异常则把错误码与消息放进统一响应对象。往下还能看到普通结果包装成 code 为 0 的分支。

这就是为什么不能只盯着 HTTP 200。业务返回体里的 code、msg、data 也要检查；路由不存在、协议处理失败等情况还可能属于框架层的另一种结果，别反过来推成“所有错误一定都是 200”。

对调用者来说，最实用的做法是分别记录传输层结果和业务结果。对测试来说，也应该明确正在验证哪个边界，而不是只断言“请求没抛异常”。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：选一个成功请求和一个输入不完整的请求，对照它们经过的分支。

先阅读 `scripts/learning/project_overview.py` 里的本地 api 函数，确认它除了 HTTP 请求，还检查了返回体的 code。

成功路径已有[本地集成记录](/labs/project-overview-result.json)：脚本调用真实管理 API 创建了测试配置，随后正常映射完成字节往返。若要自己增加缺少 serverPort 的请求，请只在这个新建临时环境中做，并记录 HTTP 状态、响应 code / msg、Controller 是否继续进入 Service。

后一条缺字段场景是本篇提供的练习预期，当前报告没有单独记录它的返回码。先找 `checkNotNull` 的分支，再通过实际请求核对，不要拿正常创建成功推导所有输入校验都已测试。

<span id="完善清单"></span>

## 合上代码前想一想

- **context-path 是类上的 Mapping 吗？** 它来自应用配置，地址要分层拼起来。
- **为什么 Controller 通过还不能说业务合法？** 还有 Service 的业务条件和运行资源结果。
- **下一篇继续哪儿？** [03.04](/learn/solon-request-context/)看看“当前用户”是怎么跟着请求走的。
