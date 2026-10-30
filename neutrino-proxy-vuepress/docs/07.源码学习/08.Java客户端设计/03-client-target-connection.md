---
title: "08.03 内网目标连接与异步绑定"
date: 2026-10-30
permalink: /learn/client-target-connection/
article: false
status: Review
updated: 2026-10-30
lesson: "08.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "handle"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    symbol: "realServerBootstrap"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 33
    endLine: 48
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java"
    startLine: 164
    endLine: 170
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 54
    endLine: 64
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 68
    endLine: 77
---

# 08.03 内网目标连接与异步绑定

状态：Review · 最后更新：2026-10-30

关联阅读：[01.03 可保留的实验会话](/learn/local-debugging/)、[05.02 Future](/learn/netty-bootstrap/)、[学习目录](/learn/)

访问者连上 server 之后，client 还要接好两段：一段去目标服务，一段回 server 传业务数据。目标连接成功，只是完成了前半件事。这篇先把正常绑定走完，再用一个不会监听的目标端口观察失败。大约留 30 分钟，先不急着碰取消和竞态。

<span id="本篇要解决的问题"></span>

<span id="先带着一个问题读下去"></span>

## 先拿一组具体值放进脑子里

下面的 `v001`、`127.0.0.1:8080` 只是讲解用的值；真实实验中的 visitorId 由项目生成，目标端口由脚本动态分配。

| 值或对象 | 代表什么 | 容易误会的地方 |
| --- | --- | --- |
| `visitorId = v001` | 这次访问者的关联标识 | 不是用户 ID，也不是 License |
| CONNECT 的 `info` | 这里携带 visitorId | 同一种消息在不同方向、连接上含义可能不同 |
| CONNECT 的 `data` | 目标文本 `127.0.0.1:8080` | 地址由 client 的网络视角解释 |
| `cmdChannel` | 已存在的控制连接 | 用于收控制命令、发失败通知 |
| `realServerChannel` | client → 目标的连接 | 业务字节最终写到这里 |
| `success(Channel channel)` 的 `channel` | client → server 的数据隧道 | 不是方法入口的 cmdChannel |

<span id="正文提纲"></span>

<span id="一起顺着代码走"></span>

<span id="项目源码入口"></span>

<span id="这次先打开哪几个文件"></span>

## 顺着一次成功连接读源码

本节主要看 client 模块的 `ProxyMessageConnectHandler.handle` 和 `ProxyConfiguration.realServerBootstrap`，节选固定于提交 `94cafdd1f36e1f64b316e10466a8f54912c75467`。

### 目标地址来自服务端命令

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L33-L48)（原文件 33～48 行，连续原样节选）：

```java
		final Channel cmdChannel = ctx.channel();
		final String visitorId = proxyMessage.getInfo();
		String[] serverInfo = new String(proxyMessage.getData()).split(":");
		String ip = serverInfo[0];
		int port = Integer.parseInt(serverInfo[1]);
		// 连接真实的、被代理的服务
		realServerBootstrap.connect(ip, port).addListener(new ChannelFutureListener() {

			@Override
			public void operationComplete(ChannelFuture future) throws Exception {

				// 连接后端服务器成功
				if (future.isSuccess()) {
					final Channel realServerChannel = future.channel();

					realServerChannel.config().setOption(ChannelOption.AUTO_READ, false);
```

代入示例：`info → v001`，`data → 127.0.0.1:8080`，于是 client 执行 `realServerBootstrap.connect("127.0.0.1", 8080)`。`addListener` 表示连接结果确定后执行回调，不是当前方法已经同步完成了目标建连。

`future.isSuccess()` 为真时，取得目标 Channel，然后关掉它的 `AUTO_READ`。目标可能一连上就主动回数据，先暂停自动读取，等数据隧道绑定好再继续。暂停读取不等于关闭连接，操作系统仍可能缓存收到的字节。

server、client、Echo 分开部署时，localhost 始终指向 **client 所在的网络空间**。不要用“server 能访问这个地址”替代“client 能访问它”。

### 两个异步操作，两个失败点

第一个是目标 `connect` 的 ChannelFuture；第二个是 `ProxyUtil.borrowTcpProxyChanel(...)` 的成功/失败回调。后者可能复用池中连接，也可能新建到 server 的数据连接，拼写 `Chanel` 是当前源码的方法名。

目标 Bootstrap 来自这里，入口名是 **`realServerBootstrap`**：

看这段 [ProxyConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/config/ProxyConfiguration.java#L164-L170)（原文件 164～170 行，连续原样节选）：

```java
    @Bean("realServerBootstrap")
    public Bootstrap realServerBootstrap(@Inject ProxyConfig proxyConfig,
                                             @Inject("tcpRealServerWorkGroup") NioEventLoopGroup tcpRealServerWorkGroup
                                             ) {
        Bootstrap bootstrap = new Bootstrap();
        bootstrap.group(tcpRealServerWorkGroup);
        bootstrap.channel(NioSocketChannel.class);
```

它注册到 `tcpRealServerWorkGroup`，使用 `NioSocketChannel`。后续初始化安装 `RealServerChannelHandler`，而不是隧道的编解码器。Echo 收到业务字节，不需要解析 ProxyMessage。

### 正常绑定到底做了哪几步

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L54-L64)（原文件 54～64 行，连续原样节选）：

```java
						public void success(Channel channel) {
							// 连接绑定
							channel.attr(Constants.NEXT_CHANNEL).set(realServerChannel);
							realServerChannel.attr(Constants.NEXT_CHANNEL).set(channel);

							// 远程绑定
							channel.writeAndFlush(ProxyMessage.buildConnectMessage(visitorId + "@" + proxyConfig.getTunnel().getLicenseKey()));

							realServerChannel.config().setOption(ChannelOption.AUTO_READ, true);
							ProxyUtil.addRealServerChannel(visitorId, realServerChannel);
							ProxyUtil.setRealServerChannelVisitorId(realServerChannel, visitorId);
```

盯住 `success(Channel channel)`：这次的 `channel` 是刚借到的数据隧道。先互写 `NEXT_CHANNEL`，再通知 server 绑定 visitorId，最后恢复目标自动读取，并保存目标连接索引。

```text
本地关联：ProxyChannel.NEXT_CHANNEL ──> RealServerChannel
          RealServerChannel.NEXT_CHANNEL ──> ProxyChannel

远端关联：client 经 ProxyChannel 发 CONNECT(visitorId@业务凭证)
          → server 查到 VisitorChannel
          → server 将 VisitorChannel 与 ProxyChannel 双向绑定
          → server 恢复 VisitorChannel 的 AUTO_READ
```

| 观察时机 | 目标 `AUTO_READ` | 目标 `NEXT_CHANNEL` | 可以怎么理解 |
| --- | --- | --- | --- |
| 目标连接成功、借隧道前 | `false` | 尚未在这里设置 | 目标已接通，转发条件还没齐 |
| `success` 中双向 set 之后 | 仍为 `false` | 指向 ProxyChannel | 本地两端已配对 |
| 恢复读取之后 | `true` | 仍指向 ProxyChannel | 目标响应可进入转发处理器 |

`writeAndFlush(CONNECT)` 发出绑定消息，不等于此时 server 已经处理完成。client 的代码继续执行，两个进程通过协议顺序和各自处理器衔接；这不是跨进程的同步方法返回。

请求回来时，client 的 `ProxyMessageTransferHandler` 通过数据隧道上的 `NEXT_CHANNEL` 找目标；目标回话时，`RealServerChannelHandler` 找反方向的下一跳。这对属性就是每次字节转发不用重新查业务映射的原因。

<span id="动手实验与验收"></span>

<span id="动手试一小步"></span>

## 动手：正常、坏目标、再正常

**动手试试**：使用真实 Java JAR，保留 10 分钟的本地会话。先完成正常路径，再制造故障，最后确认健康映射仍可用。

### 1 终端 A 准备会话

先停止旧会话。需要 Java 21、Maven、Python 3.10+，在仓库根目录执行：

```powershell
Set-Location D:\study\neutrino-proxy
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
$sessionFile = Join-Path $env:TEMP "np-reader-session.json"
python scripts/learning/project_overview.py --mode demo --windows-tcp-pipe --keep-alive 600 --debug --session-file $sessionFile
```

Windows 使用上面的兼容参数，其他系统去掉它并调整终端写法。等 `LAB_READY` 后再去 B。这里准备两条映射：正常映射到 Echo；坏映射到本机一个已保留、但不监听的端口。故障不需要手工停止隧道或改现有配置。

### 2 终端 B 先确认成功路径

```powershell
Set-Location D:\study\neutrino-proxy
$sessionFile = Join-Path $env:TEMP "np-reader-session.json"
python scripts/learning/lab_request.py --session-file $sessionFile --route mapping
$LASTEXITCODE
```

预期 `outcome: echo`、`passed: true`，`hello-neutrino` 原样回来，退出码 `0`。这证明这次目标连接、隧道与绑定共同完成了一次真实业务往返。

### 3 访问坏目标，明确等待上限

```powershell
python scripts/learning/lab_request.py --session-file $sessionFile --route unreachable --timeout 3
$LASTEXITCODE
```

本次实测输出关键字段如下，退出码为 **2**：

```json
{ "sent": "hello-neutrino", "passed": false, "outcome": "timeout" }
```

这里的预期是**复现已知现象**，不是把超时算通过：目标不可达后，访问者在 3 秒内没有得到关闭或拒绝。若你观察到 `connection_rejected` 或 `closed_before_echo`，请记录版本、结果与时间窗口；它们同样不是成功回显，但和本次超时是不同观察。

### 4 回到健康映射，再停止

```powershell
python scripts/learning/lab_request.py --session-file $sessionFile --route mapping
$LASTEXITCODE
python scripts/learning/lab_request.py --session-file $sessionFile --stop
```

第一条预期再次 `echo` 且退出 `0`，说明这次坏目标没有拖垮健康映射。停止后等待 A 结束，核对 `state: stopped` 与 `temporaryStateRemoved: true`。

[查看正常与坏目标的实际记录](/labs/reader-session-result.json)。本轮没有模拟“目标已连接，但借隧道失败”，也没有验证取消后的迟到回调；不能用本次结果替这两个场景验收。

## 选做：用断点看见绑定前后

按照 [05.01 的远程附加步骤](/learn/netty-reactor/) 附加 **client JVM**，使用刚才 `--debug` 创建的客户端端口。重新开一轮会话并等就绪，再发请求。

| 断点位置（client CONNECT Handler） | 停住时看什么 | 继续后的预期 |
| --- | --- | --- |
| `realServerChannel.config().setOption(AUTO_READ, false)` 之后，即 `borrowTcpProxyChanel` 调用行 | `future.isSuccess()`、`realServerChannel.isActive()`、`realServerChannel.config().isAutoRead()` | 正常目标为 true、true、false |
| `success` 中发送 CONNECT 的那行 | `channel.attr(Constants.NEXT_CHANNEL).get() == realServerChannel`；反向属性是否等于 channel | 两个方向都为 true |
| `ProxyUtil.addRealServerChannel` 那行 | `realServerChannel.config().isAutoRead()` | 已恢复为 true |
| `else` 分支发送 DISCONNECT 那行 | `future.isSuccess()`、`future.cause()` | 坏目标为 false，并有实际建连错误 |

行断点在当前语句执行前暂停，所以“检查设置结果”要停在**下一条可执行语句**。使用 Suspend Thread，发普通请求时可加 `--timeout 60` 给观察留时间，然后尽快恢复。不要把调试暂停造成的超时当成原始故障；这里只给出观察指引，未执行 IDE 界面操作。

## 排错先按连接阶段拆

| 现象 | 下一步 | 为什么 |
| --- | --- | --- |
| 目标直连就失败 | 用 `--route target` 核对会话与 Echo 是否存活 | 先确认目标，避免一上来追隧道 |
| client 显示在线，映射仍超时 | 查目标 connect 的 Future，而不只看在线标记 | 控制连接认证不等于目标连接成功 |
| IDE 看不到变量或断点漂移 | 用当前源码重新构建 JAR、重启会话并重新附加 | 旧 JAR 和编辑器源码可能不是同一份 |
| 暂停后所有请求似乎都慢 | 恢复线程再重发；检查是否暂停了同一 EventLoop | 调试动作本身会让其他回调排队 |
| 坏目标超时以后正常映射也失败 | 先排除会话 600 秒到期或 client 已退出，再分别测目标与映射 | 单个超时不足以证明所有映射损坏 |
| B 提示没有活动会话 | 重新启动 A，等 `LAB_READY`，重读会话文件 | 旧报告端口不能当运行中的配置 |

<span id="第二步失败-别只看通知"></span>

## 进阶阅读：失败通知与资源回收是两件事

正常链路看懂后，再读这个分支：

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L68-L77)（原文件 68～77 行，连续原样节选）：

```java
						public void error(Throwable cause) {
							ProxyMessage proxyMessage = new ProxyMessage();
							proxyMessage.setType(ProxyMessage.TYPE_DISCONNECT);
							proxyMessage.setInfo(visitorId);
							cmdChannel.writeAndFlush(proxyMessage);
						}
					});

				} else {
					cmdChannel.writeAndFlush(ProxyMessage.buildDisconnectMessage(visitorId));
```

目标建连失败，通过 cmdChannel 发 DISCONNECT；借隧道失败也会通知 server。但借取失败回调里没有显式关闭已经成功创建、并暂停自动读取的 `realServerChannel`。这段只能证明“发了通知”，后续是否有其他事件清理，需要继续追生命周期。

两个 socket 之间没有隐含的事务回滚。server 收到通知能否找到并关闭正确的访问者，还取决于 [服务端断开处理](/learn/server-disconnection/)。本次实验已确认的是 3 秒内未及时结束等待；具体根因仍需断点追踪，不把源码疑点写成已验证结论。

<span id="连接成功后仍要防迟到"></span>

<details>
<summary>进阶选读：地址格式、取消和迟到回调</summary>

当前地址通过 `split(":")` 解析，普通 host:port 比较直观，带冒号的 IPv6 字面量却不能直接按这个方式处理；此处也没有结构化 schema 做完整字段校验。可以在 [协议边界测试](/learn/protocol-boundary-tests/) 之后再研究格式与兼容性。

### 迟到的连接怎么收尾

若访问者已经离开，目标 Future 稍后才成功，会不会留下没人使用的连接？当前节选没有统一的取消令牌或会话代次检查。后续研究可以分别记录目标与数据通道的创建、关闭和回调顺序，再设计可控的延迟与失败注入。本轮没有提供这部分故障注入器，也没有将它列为本篇必须完成的实验。

</details>

<span id="完善清单"></span>

<span id="合上代码前想一想"></span>

## 自测与参考答案

<details>
<summary>1. 目标 connect 成功，为什么还不能恢复所有读取？</summary>

还缺 client 到 server 的数据通道及两侧绑定。目标先暂停自动读取，借到隧道后写好双向 NEXT_CHANNEL，再通知 server 并恢复目标读取；server 还需要绑定自己的访问者一侧。

</details>

<details>
<summary>2. success(Channel channel) 中的 channel 是谁？</summary>

是 ProxyChannel，即数据隧道。`cmdChannel` 是 handle 入口保存的控制连接，`realServerChannel` 是目标 Future 返回的连接。三个变量属于不同角色，不要因为都叫 Channel 就混成同一对象。

</details>

<details>
<summary>3. 为什么发了 DISCONNECT 还不能宣称资源回收完成？</summary>

消息发送、远端正确处理、本地连接关闭是不同动作。要分别检查写入结果、server 的访问者定位和 client 的目标连接清理；借取失败片段没有显式关闭已建目标连接，仍需跟踪其他清理路径。

</details>

<details>
<summary>4. 坏目标超时后，为什么还要测正常映射？</summary>

用一个对照区分“本次访问失败”和“整个代理不再可用”。本次健康映射再次成功，只证明这个局部隔离观察成立，不代表连接泄漏、长期负载或全部失败路径都已通过。

</details>

下一篇 [08.04 多访问者转发](/learn/client-forwarding/)，继续看这对 NEXT_CHANNEL 如何承接每一条消息。
