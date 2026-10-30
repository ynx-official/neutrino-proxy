---
title: "09.05 安全组 访问规则与流量限制"
date: 2026-10-30
permalink: /learn/security-rate-limiting/
article: false
status: Review
updated: 2026-10-30
lesson: "09.05"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/SecurityGroupService.java"
    symbol: "SecurityGroupService"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/TcpVisitorSecurityChannelHandler.java"
    symbol: "TcpVisitorSecurityChannelHandler"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/VisitorFlowLimiterChannelHandler.java"
    symbol: "VisitorFlowLimiterChannelHandler"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/TcpVisitorSecurityChannelHandler.java"
    startLine: 38
    endLine: 46
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/SecurityGroupService.java"
    startLine: 238
    endLine: 263
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/VisitorFlowLimiterChannelHandler.java"
    startLine: 35
    endLine: 41
---

# 09.05 安全组 访问规则与流量限制

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

端口能转发以后，接下来才是“允许谁进来、每条连接能跑多快”。我们把安全组与流量限制并排看：一个回答是否放行，一个改变传输速率，它们还依赖前面已经确定的映射端口。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

规则如何排序，没匹配时采用什么默认值？HTTP 转发头里的 IP 能直接当可信身份吗？配置限速后，旧连接会立即刷新吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / SecurityGroupService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/SecurityGroupService.java) | `SecurityGroupService` |
| [server / TcpVisitorSecurityChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/TcpVisitorSecurityChannelHandler.java) | `TcpVisitorSecurityChannelHandler` |
| [server / VisitorFlowLimiterChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/VisitorFlowLimiterChannelHandler.java) | `VisitorFlowLimiterChannelHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 访问规则先看来源和匹配顺序

TCP 在 channelActive 用 socket 远端 IP 判断，读入数据时又可能从 HTTP 风格转发头提取地址：

看这段 [TcpVisitorSecurityChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/TcpVisitorSecurityChannelHandler.java#L38-L46)（原文件 38～46 行，连续原样节选）：

```java
        // 判断IP是否在该端口绑定的安全组允许的规则内
        String ip = IpUtil.getRealRemoteIp(new String(bytes));
        if (StringUtils.isEmpty(ip)) {
            ip = IpUtil.getRemoteIp(ctx);
        }
        InetSocketAddress sa = (InetSocketAddress) visitorChannel.localAddress();
        if (!securityGroupService.judgeAllow(ip, portMappingService.getSecurityGroupIdByMappingPort(sa.getPort()))) {
            // 不在安全组规则放行范围内
            ctx.channel().close();
```

IpUtil.getRealRemoteIp 先取 X-Forwarded-For，再取 X-Real-IP；代码返回头部值，并没有在这个工具中完成可信代理名单验证或一整套多跳地址规范化。因此不能把“头里有一个 IP”当作“已验证的真实来源”。

HTTP 入口也有类似逻辑。若部署在可信反向代理之后，应另外明确谁可以提供这些头、谁负责清洗。本文只是指出实现边界，不擅自改变用户访问策略。

### 规则按优先级遇到首个匹配就停

看这段 [SecurityGroupService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/SecurityGroupService.java#L238-L263)（原文件 238～263 行，连续原样节选）：

```java
        List<SecurityRuleDO>  ruleDOList = securityRuleMapper.selectList(Wrappers.lambdaQuery(SecurityRuleDO.class)
            .eq(SecurityRuleDO::getGroupId, groupId)
            .eq(SecurityRuleDO::getEnable, EnableStatusEnum.ENABLE.getStatus())
            .orderByAsc(SecurityRuleDO::getPriority)
        );
        for (SecurityRuleDO ruleDO : ruleDOList) {
            SecurityRulePassTypeEnum passType = ruleDO.judge(ip);
            if (passType == SecurityRulePassTypeEnum.ALLOW) {
                allow = true;
                log.debug("[SecurityGroup] ip:{} groupId:{} ruleId:{} security strategy:{}", ip, groupId, ruleDO.getId(), "allow");
                break;
            }
            if (passType == SecurityRulePassTypeEnum.DENY) {
                allow = false;
                log.info("[SecurityGroup] ip:{} groupId:{} ruleId:{} security strategy:{}", ip, groupId, ruleDO.getId(), "reject");
                break;
            }
        }

        // 当前IP没有匹配到任何一条规则，则使用安全组默认规则
        if (allow == null) {
            allow = SecurityRulePassTypeEnum.ALLOW.getType().equals(groupDO.getDefaultPassType());
            log.debug("[SecurityGroup] ip:{} groupId{} use security group default strategy:{}", ip, groupId, allow ? "allow" : "reject");
        }

        ipAllowControlCache.put(judgeAllowMapKey, allow);
```

规则查询只取启用项，按 priority 升序；遇到 ALLOW 或 DENY 就 break，没有匹配采用组的 defaultPassType，之后缓存结果。

前面的代码在 groupId 为空或找不到组时返回 true，所以这里不是“未配置安全组一律拒绝”。改规则后，还应追服务的缓存失效路径与现有连接行为，不能只更新数据库就宣布所有连接即时生效。

judgeAllow 开头先 toLowerCase 再做空值检查，因此 null 与空字符串并非完全等价的安全返回路径；调用方契约同样要核对。不要只照注释复述“拿不到 IP 一定保守拒绝”。

### 限速按连接首次处理安装

看这段 [VisitorFlowLimiterChannelHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/security/VisitorFlowLimiterChannelHandler.java#L35-L41)（原文件 35～41 行，连续原样节选）：

```java
            if (null != upLimitRate || null != downLimitRate) {
                // 如果不全为空，则需要做限速
                ctx.pipeline().addAfter("flowLimiter", "trafficShaping", new ChannelTrafficShapingHandler(downLimitRate == null ? 0 : downLimitRate, upLimitRate == null ? 0 : upLimitRate, 100, 600000));
            }

            // 每个连接第一次处理之后。无论是否限速，该连接后续都不在处理，避免频繁执行影响性能
            ctx.channel().attr(Constants.FLOW_LIMITER_FLAG).set(Boolean.TRUE);
```

需要限速时，在 flowLimiter 之后插入 ChannelTrafficShapingHandler，构造参数依次使用 downLimitRate 与 upLimitRate；站在服务端来看写给访问者是下行，读访问者是上行。

FLOW_LIMITER_FLAG 让同一连接后续不重复安装。即便第一次没有限速，也会标记已处理，因此后台改限速后，旧连接是否更新还要看是否存在其他重配置逻辑；这段代码本身不会每次重读新值。

它是 Channel 级流量整形，不是从这几行就能证明“某 License 的所有并发连接共享一个总速率”。两条连接各自限速，与用户级总配额是不同设计。

### 将安全与吞吐分别验收

先验证 ALLOW/DENY 命中分支，再测单连接上、下行，再测并发连接的合计速率。慢目标引发的背压也会降低速率，不能据此判断限速设置已生效；需要控制目标处理能力和传输数据量。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在本地临时映射建立两条有优先级冲突的规则，测试命中首项与默认规则，再修改并观察缓存。限速用足够长但有上限的二进制传输，分别测单连接与两连接；记录实际吞吐、耗时和目标是否足够快。转发头用虚构地址，只测试自己的服务。

**怎么验收**：规则结果能对应到顺序与缓存，限速结果区分单连接和聚合速率；注明旧连接与新连接的差异。安全组、可信代理和限速矩阵本轮尚未实测，不把正常 TCP 转发或编解码通过当作权限/速率证据。

<span id="完善清单"></span>

## 合上代码前想一想

现在回答：来源地址、消息凭证、后台 Token 是同一种身份吗？单连接整形能否表达整个用户的总配额？接着去 [测试分层](/learn/testing-strategy/) 整理这些边界各该用什么测试。
