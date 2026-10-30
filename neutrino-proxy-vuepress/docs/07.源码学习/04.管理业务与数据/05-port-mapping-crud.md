---
title: "04.05 端口映射 CRUD 完整纵向切片"
date: 2026-10-30
permalink: /learn/port-mapping-crud/
article: false
status: Review
updated: 2026-10-30
lesson: "04.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    symbol: "create"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java"
    symbol: "updateEnableStatus"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/dal/PortMappingMapper.java"
    symbol: "findByPort"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    symbol: "VisitorChannelService"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java"
    startLine: 148
    endLine: 158
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java"
    startLine: 185
    endLine: 191
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 158
    endLine: 167
---

# 04.05 端口映射 CRUD 完整纵向切片

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

普通 CRUD 看到 insert 成功，很容易准备收工。端口映射偏偏还有后半场：它要把一条数据库记录变成运行中的转发关系。我们就用 create 当一条纵向切片，把熟悉的业务代码和 Netty 那边接起来。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

数据库里已经有映射了，为什么访问端口还可能不通？这次先列几个可能原因，再看代码把你带到哪一步。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / PortMappingController.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java) | `create` |
| [server / PortMappingService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java) | `updateEnableStatus` |
| [server / PortMappingMapper.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/dal/PortMappingMapper.java) | `findByPort` |
| [server / VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java) | `VisitorChannelService` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先把输入检查和业务检查接起来

Controller 已经补默认值、检查必要字段、整理协议。进入 Service 后，还要确认 License、端口池与重复映射等条件：

看这段 [PortMappingService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java#L148-L158)（原文件 148～158 行，连续原样节选）：

```java
    public PortMappingCreateRes create(PortMappingCreateReq req) {
        LicenseDO licenseDO = licenseMapper.findById(req.getLicenseId());
        ParamCheckUtil.checkNotNull(licenseDO, ExceptionConstant.LICENSE_NOT_EXIST);
        if (!SystemContextHolder.isAdmin()) {
            // 临时处理，如果当前用户不是管理员，则操作userId不能为1
            ParamCheckUtil.checkExpression(!licenseDO.getUserId().equals(1), ExceptionConstant.NO_PERMISSION_VISIT);
        }
        PortPoolDO portPoolDO = portPoolMapper.findByPort(req.getServerPort());
        ParamCheckUtil.checkNotNull(portPoolDO, ExceptionConstant.PORT_NOT_EXIST);
        ParamCheckUtil.checkExpression(null == portMappingMapper.findByPort(req.getServerPort(), null), ExceptionConstant.PORT_CANNOT_REPEAT_MAPPING, req.getServerPort());
        //验证域名映射相关参数条件
```

如果你正在核对权限，记得沿用[上一组的矩阵](/learn/login-authorization/)；不要把这几项存在性和重复检查直接等价成完整对象权限保证。

重复检查也值得留个问题：两次并发请求都通过查询时，最终由哪一层保证唯一？数据库中的普通索引和 Java 里的先查后写，要分别确认，之后再设计真实数据库并发实验。

### insert 后面 还有一个运行状态通知

看这段 [PortMappingService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java#L185-L191)（原文件 185～191 行，连续原样节选）：

```java
        portMappingDO.setIsOnline(OnlineStatusEnum.OFFLINE.getStatus());
        portMappingDO.setEnable(EnableStatusEnum.ENABLE.getStatus());
        portMappingDO.setCreateTime(now);
        portMappingDO.setUpdateTime(now);
        portMappingMapper.insert(portMappingDO);
        // 更新VisitorChannel
        visitorChannelService.addVisitorChannelByPortMapping(portMappingDO);
```

新记录先带着离线状态写进数据库，随后立即调用 VisitorChannelService。这就是这条业务与网络资源交汇的位置。

再往下还有域名映射、限速和缓存相关更新。因此，读到一处 insert 并不等于读完了创建操作；你至少要找到它返回前还有哪些副作用，失败时哪些步骤可能已经发生。

### 客户端离线时 这一步会怎样

看这段 [VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L158-L167)（原文件 158～167 行，连续原样节选）：

```java
    public void addVisitorChannelByPortMapping(PortMappingDO portMappingDO) {
        if (null == portMappingDO) {
            return;
        }
        Channel cmdChannel = ProxyUtil.getCmdChannelByLicenseId(portMappingDO.getLicenseId());
        if (null == cmdChannel) {
            // 如果不存在有效的cmdChannel，则无需更新VisitorChannel
            return;
        }
        // 判断端口映射是否启用
```

没有有效 CmdChannel 时，运行更新直接返回。这不一定意味着创建请求失败：配置可以先保存在数据库，客户端后续认证时再初始化映射。

现在再看“保存了但不通”，就多了一条很具体的解释路径：配置存在，控制连接尚未就绪。接着还要查启用状态、用户状态、端口池状态、监听与目标可达性，不能只凭数据库一行数据定结论。

### 用同一套视角看 update 和 delete

update 不只是改列：它会把旧映射与新映射交给运行服务，移除旧关系、添加新关系。delete 也需要处理域名、缓存和运行信息等关联。

你可以给每个方法画四栏：输入与权限、数据库变更、内存状态、网络资源。这样同样的 CRUD 名字，就不会遮住每种操作不同的成本。

还要单独找事务边界。看见连续的几次数据库调用，不表示它们天然属于一个事务；而即便数据库事务完整，端口绑定和 Channel 操作也不会自动随 SQL 回滚。先观察当前实现，再讨论补偿或重试该落在哪儿。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：把 create 从第一项校验跟到返回，再用四栏记录每一步。

四栏分别写“数据库”“内存映射/缓存”“监听端口”“活动连接”。在每个 Service 调用旁边标明它可能改变哪一栏，以及客户端离线时会不会执行。

[本地集成报告](/labs/project-overview-result.json)已经通过实际管理 API 创建测试映射并完成正常 TCP 往返。它没有把并发创建、更新中途失败或删除全部关联的场景都执行一遍；这些可作为你继续添加的独立实验。

你可以先提出一个精确问题，例如“离线保存后，哪个认证方法重新读取这行配置”，然后回到 [服务端初始化](/learn/server-listeners/)继续找答案。

<span id="完善清单"></span>

## 合上代码前想一想

- **insert 成功能证明映射已监听吗？** 中间还有运行资源那一栏。
- **客户端离线时保存配置是否必然无效？** 看初始化如何重新加载配置。
- **继续哪一层？** [04.06](/learn/runtime-consistency/)专门讨论几种状态如何对上。
