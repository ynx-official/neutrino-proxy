---
title: "04.06 配置动态生效与运行状态一致性"
date: 2026-10-30
permalink: /learn/runtime-consistency/
article: false
status: Review
updated: 2026-10-30
lesson: "04.06"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java"
    symbol: "updateEnableStatus"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    symbol: "initVisitorChannel"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java"
    symbol: "addCmdChannel"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 145
    endLine: 150
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 193
    endLine: 211
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 225
    endLine: 233
---

# 04.06 配置动态生效与运行状态一致性

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

“配置明明是对的，为什么还不通？”如果只盯数据库，代理项目里这个问题会很难回答。我们把状态拆成几份看：持久记录、内存关联、系统监听和活动连接。它们有关联，但不会靠一条 SQL 自动同时变好。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

把一条映射的目标端口改了之后，正在传输的旧连接应该怎样处理？新的访问又该走哪里？先把“旧会话”和“新访问”分开想。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / PortMappingService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java) | `updateEnableStatus` |
| [server / VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java) | `initVisitorChannel` |
| [server / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java) | `addCmdChannel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先列四张小清单

| 状态放在哪儿 | 回答什么问题 |
| --- | --- |
| 数据库 | 希望保留怎样的配置，开关与归属是什么 |
| 内存关联 / 缓存 | 当前端口、License、CmdChannel 怎么对应 |
| 系统监听 | 哪个进程实际占着这个 TCP / UDP 端口 |
| 活动连接 | 哪个访问者正与哪个目标通道绑定 |

这四栏可以帮助你定位“哪里还没跟上”。数据库里启用，不能直接证明某个端口由本应用监听；端口能握手，也不直接证明目标服务可用。

同一客户端下面，正常目标能转发而另一个目标不可达，已经在本地实验里出现。这是很直观的提醒：别用单个在线标志代表整条链路所有节点。

### 更新映射时 运行侧先拆再接

看这段 [VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L145-L150)（原文件 145～150 行，连续原样节选）：

```java
    public void updateVisitorChannelByPortMapping(PortMappingDO oldPortMappingDO, PortMappingDO newPortMappingDO) {
        if (null == oldPortMappingDO || null == newPortMappingDO) {
            return;
        }
        removeVisitorChannelByPortMapping(oldPortMappingDO);
        addVisitorChannelByPortMapping(newPortMappingDO);
```

这里把旧关系移除，再按新映射添加。你接下来该问的是：remove 移除了什么？add 在客户端离线时做什么？其中某一步失败，另一份状态是否已经改变？

这些都是状态转换的问题。只把方法名翻译成“更新配置”，就会漏掉真正影响可用性的那几步。

### 移除配置关系 不要自动等价成所有连接都结束

看这段 [VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L193-L211)（原文件 193～211 行，连续原样节选）：

```java
    public void removeVisitorChannelByPortMapping(PortMappingDO portMappingDO) {
        if (null == portMappingDO) {
            return;
        }
        Channel cmdChannel = ProxyUtil.getCmdChannelByLicenseId(portMappingDO.getLicenseId());
        if (null == cmdChannel) {
            // 如果不存在有效的cmdChannel，则无需更新VisitorChannel
            return;
        }
        Channel visitorChannel = ProxyUtil.getVisitorChannelByServerPort(portMappingDO.getServerPort());
        if (null != visitorChannel) {
            Channel proxyChannel = visitorChannel.attr(Constants.NEXT_CHANNEL).get();
            if (null != proxyChannel) {
                proxyChannel.close();
            }
            // TODO 此处如果时UDP的visitorChannel,则不能close，后续重构考虑
//            visitorChannel.close();
        }
        ProxyUtil.removeProxyInfo(portMappingDO.getServerPort());
```

代码先找控制连接与访问者，再尝试关闭相关数据通道，最后移除代理信息。中间还能看到 UDP 相关的 TODO 和被注释的关闭操作。

所以，讲解时应按 TCP / UDP、是否存在活动访问者、是否已有数据绑定分别走路径。我们可以说明当前分支在做什么，但不能看见 remove 这个名字就宣布所有资源已经彻底清理。

如果你准备做故障测试，写明观察对象：是 Map 没了，监听没了，还是 Socket 真的结束了？用不同证据回答不同问题，会更可靠。

### 监听属于另一种外部资源

看这段 [VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L225-L233)（原文件 225～233 行，连续原样节选）：

```java
                proxyMutualService.bindServerPort(cmdChannelAttachInfo, portMapping.getServerPort());

                NetworkProtocolEnum networkProtocolEnum = NetworkProtocolEnum.of(portMapping.getProtocal());
                if (networkProtocolEnum == NetworkProtocolEnum.UDP) {
                    udpServerBootstrap.bind(portMapping.getServerPort()).get();
                    log.info("bind UDP user port： {}", portMapping.getServerPort());
                } else {
                    tcpServerBootstrap.bind(portMapping.getServerPort()).get();
                    log.info("bind TCP user port： {}", portMapping.getServerPort());
```

这里才真正调用 bind，根据协议选择 UDP Bootstrap 或 TCP ServerBootstrap。数据库的事务不管理操作系统端口，Netty 的绑定结果也要单独观察。

继续看异常处理还能发现，BindException 会被特殊处理。它可能涉及端口已绑定的情形；要判断当前应用是否已经正确提供这条映射，还要结合实际占用者和运行关联，不能只靠“没有把异常往外抛”。

讨论改进时，可以从“失败之后，如何知道哪一份状态需要补齐”入手。先描述可重试的动作与不变量，再决定要不要增加状态记录或补偿逻辑，不必一上来给整个项目换架构。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：任选一种变更，把前后四栏状态各写一遍。

建议从“离线新增映射”“在线修改目标”“禁用映射”“端口被另一个本地测试进程占用”中选一个。只在可丢弃环境操作，事先写明数据库、内存、监听与活动连接分别应怎样变化，再对照实际结果。

当前[已有实测](/labs/project-overview-result.json)覆盖正常转发、目标不可达与客户端退出，没有覆盖以上所有配置变更和占用场景。本篇新增的是源码分析与可执行的观察方法，未把这些待做实验记成已通过。

当结果不符合预期时，保留它：写清触发步骤、哪个状态先变了、哪个状态没跟上。这样的记录，下一篇看服务端连接生命周期时会非常好用。

<span id="完善清单"></span>

## 合上代码前想一想

- **SQL 回滚能顺手撤销一次端口 bind 吗？** 它们属于不同资源边界。
- **Map 里删掉记录，就能断言 Socket 已结束吗？** 还要观察实际连接的生命周期。
- **下一步去哪里？** [05.01](/learn/netty-reactor/)开始把事件循环与这些连接对象放到同一张图里。
