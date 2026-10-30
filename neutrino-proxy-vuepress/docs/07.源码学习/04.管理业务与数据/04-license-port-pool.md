---
title: "04.04 License 与端口池业务规则"
date: 2026-10-30
permalink: /learn/license-port-pool/
article: false
status: Review
updated: 2026-10-30
lesson: "04.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/LicenseService.java"
    symbol: "LicenseService"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortPoolService.java"
    symbol: "PortPoolService"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java"
    symbol: "handle"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/LicenseService.java"
    startLine: 235
    endLine: 239
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortPoolService.java"
    startLine: 103
    endLine: 118
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortPoolService.java"
    startLine: 139
    endLine: 145
---

# 04.04 License 与端口池业务规则

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

后台里重置一个 License、禁用一个端口，看起来都只是点一下按钮。可对正在运行的代理来说，它们可能牵动不同范围的连接。我们从“下次拿什么凭证来”和“这次连接还能不能用”这两个问题拆开看。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

License 的 key 换了，已经连上的客户端会立刻断开吗？禁用端口池，跟删除某一条映射又是不是同一回事？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / LicenseService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/LicenseService.java) | `LicenseService` |
| [server / PortPoolService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortPoolService.java) | `PortPoolService` |
| [server / ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java) | `handle` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 重置凭证 先看它实际通知了谁

看这段 [LicenseService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/LicenseService.java#L235-L239)（原文件 235～239 行，连续原样节选）：

```java
    public void reset(Integer id) {
        String key = UUID.randomUUID().toString().replaceAll("-", "");
        Date now = new Date();

        licenseMapper.reset(id, key, now);
```

这段生成新 key 并更新数据库。单看这个方法，没有看到主动关闭现有控制连接的调用。

再去看 VisitorChannelService 的说明，会提醒重置 key 不会立即影响已成功连接的 License，若要立即影响需走禁用相关路径。这里把“新的认证尝试用什么值”和“已有会话何时结束”分开，才接近真实行为。

客户端上线时还有用户状态、License 状态与 clientId 冲突等检查。不要把 key 想成脱离其他业务条件就能独自决定一切的万能开关。

### 端口池描述可以使用的入口资源

看这段 [PortPoolService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortPoolService.java#L103-L118)（原文件 103～118 行，连续原样节选）：

```java
    public PortPoolCreateRes create(PortPoolCreateReq req) {
        Consumer<Integer> consumer = port -> {
            PortPoolDO oldPortPoolDO = portPoolMapper.findByPort(port);
            ParamCheckUtil.checkMustNull(oldPortPoolDO, PORT_CANNOT_REPEAT);
            PortGroupDO portGroupDO = portGroupMapper.selectById(req.getGroupId());
            ParamCheckUtil.checkNotNull(portGroupDO, PORT_GROUP_NAME_DOES_NOT_EXIST);
            Date now = new Date();
            portPoolMapper.insert(new PortPoolDO()
                    .setPort(port)
                    .setGroupId(req.getGroupId())
                    .setEnable(EnableStatusEnum.ENABLE.getStatus())
                    .setCreateTime(now)
                    .setUpdateTime(now)
            );
            // 更新visitorChannel
            visitorChannelService.updateVisitorChannelByPortPool(port, EnableStatusEnum.ENABLE.getStatus());
```

创建端口池记录时，先确认端口没有重复，再确认分组存在，写入记录后通知 VisitorChannelService。分组又能表达全局、用户或 License 等归属范围，具体可用列表还要沿查询方法确认。

注意“数据库里允许配置这个端口”和“操作系统已经成功监听这个端口”是两个观察。其他进程占用了它，或者运行条件不满足，都需要继续看实际监听结果。

### 禁用会沿另一条路径通知运行状态

看这段 [PortPoolService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortPoolService.java#L139-L145)（原文件 139～145 行，连续原样节选）：

```java
    public PortPoolUpdateEnableStatusRes updateEnableStatus(PortPoolUpdateEnableStatusReq req) {
        PortPoolDO portPoolDO = portPoolMapper.findById(req.getId());
        ParamCheckUtil.checkNotNull(portPoolDO, ExceptionConstant.PORT_NOT_EXIST);
        portPoolMapper.updateEnableStatus(req.getId(), req.getEnable(), new Date());

        // 更新visitorChannel
        visitorChannelService.updateVisitorChannelByPortPool(portPoolDO.getPort(), req.getEnable());
```

这里先保存启用状态，再通知访问者通道服务，后者按端口查找关联映射并处理启停。它影响的范围由关联关系决定，不能和只改一条映射混着理解。

但我们仍得把入口逐个看完：在线新增映射的检查，与认证后初始化监听的代码不完全相同。初始化的 startUserPortServer 里还留着端口池禁用处理相关 TODO。因此，本篇只解释已经看到的通知路径，不把单个分支的判断讲成所有重连场景都已严格保证的规则。

### 批量创建时 总响应也未必代表逐项成功

PortPoolService 接受单个端口或范围。范围循环里，单项异常会记日志再继续。你如果要判断每个端口的结果，就应对照返回设计、数据库记录与日志，而不是只看最外层请求完成。

这个细节很适合作为业务学习的小练习：一个方便的批量入口，怎样让用户知道哪些成功、哪些失败？先看当前实现，再讨论可能的改进。本轮我们不改业务规则。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：把重置、禁用、删除的影响范围各写一行。

对 LicenseService 与 PortPoolService 各选一个方法，记录“改了哪张表 → 通知了谁 → 是否直接关闭连接 → 影响下一次认证还是当前会话”。

在临时环境做实操时，先只创建少量测试端口。若练范围创建，把每个端口的结果独立核对；这里没有执行批量范围或禁用后重连的完整场景，也不以管理员成功创建一条端口记录代替它们。

[已有本地记录](/labs/project-overview-result.json)可作为正常创建与连接的起点。实验中不重置或禁用你日常使用的真实 License。

<span id="完善清单"></span>

## 合上代码前想一想

- **重置凭证和结束已有会话为什么要分开问？** 前者改变后续校验的数据，后者要触达运行中的连接。
- **看到批量接口成功响应，还想补哪份证据？** 每个端口的记录、实际状态或对应日志。
- **接下来串哪条线？** [04.05](/learn/port-mapping-crud/)把一次映射创建从头走到尾。
