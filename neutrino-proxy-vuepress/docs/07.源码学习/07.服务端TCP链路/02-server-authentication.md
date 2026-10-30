---
title: "07.02 License 认证与客户端绑定"
date: 2026-10-30
permalink: /learn/server-authentication/
article: false
status: Review
updated: 2026-10-30
lesson: "07.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    symbol: "initVisitorChannel"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java"
    startLine: 60
    endLine: 66
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java"
    startLine: 127
    endLine: 133
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java"
    startLine: 145
    endLine: 164
---

# 07.02 License 认证与客户端绑定

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

License 在后台是数据库中的一条记录，到了隧道里，它又成了客户端声明身份的凭据。我们顺着 AUTH 走一遍，重点看：检查了什么、绑定了什么，以及什么时候发出“认证成功”。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

同一个 License 再连一台客户端会怎样？AUTH 成功响应发出后，映射端口是否已经全部 bind 成功？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java) | `handle` |
| [server / VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java) | `initVisitorChannel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先读格式，再追校验

看这段 [ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java#L60-L66)（原文件 60～66 行，连续原样节选）：

```java
		String info = proxyMessage.getInfo();
		String[] tmp = info.split(",");
		String licenseKey = proxyMessage.getInfo();
		String clientId = "";
		if (tmp.length == 2) {
			licenseKey = tmp[0];
			clientId = tmp[1];
```

正常 Java 客户端发送 licenseKey,clientId。代码在切分恰好得到两项时拆出两者，否则先把整个 info 当作 License。这个兼容处理是当前实现行为，别替它改写成“严格只接受两段格式”。

后续依次检查 License 是否为空、能否查到、是否禁用、所属用户是否存在且启用。失败分支会写 AUTH 结果、关闭 Channel 并记录连接事件。管理 HTTP 的登录 Token 与这条 License 认证是两套入口，不要混用请求头的认证流程解释它。

### 已有连接时，还要比较 clientId

看这段 [ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java#L127-L133)（原文件 127～133 行，连续原样节选）：

```java
		Channel cmdChannel = ProxyUtil.getCmdChannelByLicenseId(licenseDO.getId());
		if (null != cmdChannel) {
			String _clientId = ProxyUtil.getClientIdByLicenseId(licenseDO.getId());
			if (!clientId.equals(_clientId)) {
				log.warn("[client connection] the license on another no used info:{} _clientId:{}", info, _clientId);
				ctx.channel().writeAndFlush(ProxyMessage.buildAuthResultMessage(ExceptionEnum.AUTH_FAILED.getCode(), "the license on another no used!", licenseKey));
				ctx.channel().close();
```

同一 License 已有关联控制连接时，会比较 clientId，不同则返回失败。这里是在表达“当前绑定的客户端身份”，不是用 clientId 替代 License，也不是经过硬件证明的设备身份。

相同 clientId 重连可能发生在网络切换期间：新连接已到，旧连接的断开事件还没到。后续清理代码会做当前 Channel 身份比较，避免旧事件轻易把新会话标记离线。这个保护点后面单独展开。

### 成功响应比端口初始化更早

看这段 [ProxyMessageAuthHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/handler/ProxyMessageAuthHandler.java#L145-L164)（原文件 145～164 行，连续原样节选）：

```java
		// 发送认证成功消息
		ctx.channel().writeAndFlush(ProxyMessage.buildAuthResultMessage(ExceptionEnum.SUCCESS.getCode(), "auth success!", licenseKey));

		clientConnectRecordService.add(new ClientConnectRecordDO()
				.setIp(ip)
				.setLicenseId(licenseDO.getId())
				.setType(ClientConnectTypeEnum.CONNECT.getType())
				.setMsg(info)
				.setCode(SuccessCodeEnum.SUCCESS.getCode())
				.setCreateTime(now));

		// 设置当前licenseId对应的客户端ID
		ProxyUtil.setLicenseIdToClientIdMap(licenseDO.getId(), clientId);

		log.warn("[client connection] auth success info:{} ", info);

		// 更新license在线状态
		licenseMapper.updateOnlineStatus(licenseDO.getId(), OnlineStatusEnum.ONLINE.getStatus(), now);
		// 初始化VisitorChannel
		visitorChannelService.initVisitorChannel(licenseDO.getId(), ctx.channel());
```

把顺序读出来：先写出 AUTH 成功，再记录成功事件、保存 clientId、更新 License 在线状态，最后 initVisitorChannel。

因此 AUTH 成功只说明本段认证检查通过；不能据此保证所有映射监听已打开、目标可达或后面的初始化没有失败。监听失败也不会自动“撤回”之前已经写出的成功帧。

这也是排障时要保留多层状态的原因：

| 观察点 | 能说明什么 |
| --- | --- |
| AUTH code 成功 | 本段身份检查通过 |
| License 显示在线 | 对应状态被更新 |
| 映射端口能建立连接 | 本次监听可接入 |
| 请求得到正确响应 | 该次完整业务链路可用 |

### 读认证代码，也顺便看执行成本

认证 Handler 直接调用 service、mapper 和事件记录逻辑；Dispatcher 没自动切换执行器。它在哪个线程被调用、数据库慢时影响谁，要回到 [线程模型](/learn/netty-reactor/) 联合分析。

源码中部分日志会记录 info；课程实验不要复制真实 License 到日志或截图。使用临时生成的教学值即可分析控制流。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在独立的回环环境列一个认证矩阵：不存在的临时 License、禁用的临时 License、有效 License、同 License 不同 clientId、同 clientId 重连。只记录结果码、Channel ID 和是否进入 initVisitorChannel，凭证值统一遮蔽。

**怎么验收**：每个结果都能对应到源码分支；把成功认证与映射可用分两列。当前端到端实验已使用临时凭证完成正常链路，但这五组认证分支本轮没有逐项集成验证，属于待执行矩阵。不要在真实用户上做占用或重连实验。

<span id="完善清单"></span>

## 合上代码前想一想

为什么 AUTH 成功和“所有映射准备完毕”之间有时间差？clientId 相同到底保证了什么，又没有保证什么？下面看 [映射监听与访问者管理](/learn/server-listeners/)。
