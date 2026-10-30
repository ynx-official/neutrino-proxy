---
title: "01.03 本地调试与第一条 TCP 映射"
date: 2026-10-30
permalink: /learn/local-debugging/
article: false
status: Review
updated: 2026-10-30
lesson: "01.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/ProxyServer.java"
    symbol: "Solon.start"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java"
    symbol: "setAlias"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/controller/PortMappingController.java"
    symbol: "create"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    symbol: "ProxyMessageConnectHandler"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java"
    startLine: 39
    endLine: 42
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java"
    startLine: 34
    endLine: 39
---

# 01.03 本地调试与第一条 TCP 映射

状态：Review · 最后更新：2026-10-30

关联阅读：[01.01 项目全景](/learn/project-overview/)、[学习目录](/learn/)、[源码引用规范](/learn/authoring/)

上一节是脚本帮你发一句话。这次把环境留住，自己发请求、换内容、比较目标直连与代理转发，最后亲手停掉它。大约 20 分钟就能走完一轮，不用先学会所有配置项。

<span id="本篇要解决的问题"></span>

<span id="先带着一个问题读下去"></span>

## 这次要拿到什么结果

准备两个 PowerShell 终端，都进入仓库根目录。需要 Java 21、Maven、Python 3.10+；如果上一节已经构建过且没改 Java，可以复用 JAR。

完成后你应该有三份证据：自己发送的内容原样回来；能分清当轮的映射端口与目标端口；停止实验后会话变成 `stopped`。IDE 断点放到后面的选做，不挡住第一次运行。

<span id="正文提纲"></span>

<span id="先画四个端口-不用急着启动"></span>

<span id="一起顺着代码走"></span>

## 先把四个端口放对位置

| 会话文件中的字段 | 谁访问 | 本轮用途 |
| --- | --- | --- |
| `management` | 实验脚本 | 创建临时配置 |
| `tunnel` | Java client | 连接 server 的控制与数据隧道 |
| `mapping` | 你在终端 B 发的请求 | 业务访问入口 |
| `target` | Java client | 目标 Echo 服务 |

```text
终端 B → mapping → server → tunnel → client → target(Echo)
终端 B ← mapping ← server ← tunnel ← client ← target(Echo)
```

同机实验里地址都是 `127.0.0.1`，仍然要按角色理解端口。`rejectedMapping` 是另外准备的坏目标入口，留给 [08.03](/learn/client-target-connection/)；本节先用正常映射。

<span id="动手实验与验收"></span>

<span id="动手试一小步"></span>

<span id="先让实验帮你兜住环境"></span>

## 动手：终端 A 留住环境，终端 B 发消息

**动手试试**：以下命令可以逐段复制。Windows 本机用兼容参数；Linux/macOS 去掉 `--windows-tcp-pipe`，并用相应 shell 的临时目录变量代替 PowerShell 写法。

### 1 终端 A 构建并启动

```powershell
Set-Location D:\study\neutrino-proxy
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
$sessionFile = Join-Path $env:TEMP "np-reader-session.json"
python scripts/learning/project_overview.py --mode demo --windows-tcp-pipe --keep-alive 600 --session-file $sessionFile
```

看到 `BUILD SUCCESS` 后再关注脚本。预期终端最终打印：

```text
LAB_READY session=...np-reader-session.json
mapping=127.0.0.1:本轮映射端口 target=127.0.0.1:本轮目标端口
```

**等到 `LAB_READY` 再去终端 B。** 它表示直连和代理的预检都已经完成；此时终端 A 还在运行。`600` 表示就绪后最多保留 10 分钟，不是启动超时。

脚本启动两个真实 Java JAR 和 Echo，数据库、测试 License 和配置放在自己的临时目录里。会话文件只保存本轮端口、进程号、截止时间等调试信息，不包含认证凭证。它与 JSON 结果报告是两个文件。

### 2 终端 B 发出第一条请求

终端之间不共享 PowerShell 变量，所以这里重新定义一次路径：

```powershell
Set-Location D:\study\neutrino-proxy
$sessionFile = Join-Path $env:TEMP "np-reader-session.json"
python scripts/learning/lab_request.py --session-file $sessionFile
$LASTEXITCODE
```

预期 `route` 是 `mapping`，结果包含下面这些字段，退出码为 `0`：

```json
{
  "sent": "hello-neutrino",
  "passed": true,
  "outcome": "echo",
  "received": "hello-neutrino",
  "bytes": 14
}
```

这条请求没有调用管理 API。它只向当前映射端口发送 TCP 字节，然后等待等长回显。

### 3 换句话，再比较直连

```powershell
python scripts/learning/lab_request.py --session-file $sessionFile --message "hello-01-03"
python scripts/learning/lab_request.py --session-file $sessionFile --route target --message "hello-01-03"
```

两条都应 `passed: true`、回显 `hello-01-03`（11 字节）。第一条经过代理，第二条直接连接 Echo。直连用于先确认目标自身可用，不能替代代理链路验收。

读出当轮端口，填到自己的四角色草图上：

```powershell
$s = Get-Content $sessionFile -Raw | ConvertFrom-Json
$s.ports | Format-List
```

此时 `mapping` 和 `target` 应是两个不同端口；下次启动数字会变，不要抄本站报告里的数字。

### 4 停止实验并确认收尾

```powershell
python scripts/learning/lab_request.py --session-file $sessionFile --stop
```

终端 B 应输出 `stop_requested`。等终端 A 打印最终报告并返回命令提示符，再检查：

```powershell
$s = Get-Content $sessionFile -Raw | ConvertFrom-Json
$s.state
```

预期 `stopped`；终端 A 报告中的 `temporaryStateRemoved` 为 `true`，退出码为 `0`。也可以在 A 按 Ctrl+C 或等待 600 秒到期。会话文件留作状态记录，下次正常启动可以复用这个文件名；进程与临时数据库已经清理，旧端口不能继续使用。

[查看双终端与线程观察的实测记录](/labs/reader-session-result.json)：目标直连、代理回显、两条并发回显均成功，停止与临时状态清理也已核对。记录中的 IDE 界面没有实际操作，IDE 部分按下面的源码位置选做。

## 卡住时，按这一列查

| 现象 | 优先做什么 | 预期变化 |
| --- | --- | --- |
| `session-file` 不存在 | 确认 A 已出现 `LAB_READY`；两个终端使用相同完整路径 | B 能读到 `state: active` |
| `No active loopback lab` | A 可能已经结束或到期，重新启动并等就绪 | 获得新一轮端口 |
| `Session file is already active or unrelated` | 有旧实验时先在原终端停止；若是上次强制关终端留下的文件，换一个文件名并同步修改 A/B | 不覆盖活动实验的会话信息 |
| 找不到 JAR / `Build first` | 回仓库根目录重新构建；确认两个 `target/*.jar` | 预检能完成 |
| `Invalid argument: connect` 且栈中有 `PipeImpl` | Windows 启动命令带上 `--windows-tcp-pipe`，见 [01.01 环境说明](/learn/project-overview/) | JVM 正常启动 |
| 普通映射 `timeout`、退出码 2 | 先跑 `--route target`；如果正在调试，确认没有暂停 Java 线程，恢复后重发 | 先确认目标，再确认代理 |
| `--stop` 后立刻读到 `active` | 等 A 收到停止请求并结束，再重读文件 | 变成 `stopped` |

`lab_request.py` 约定：回显一致退出 `0`，请求未得到正确回显退出 `2`，会话或参数等准备问题退出 `1`（argparse 用法错误为 `2`）。先读输出里的 `outcome`，别只看一个退出码猜原因。

<span id="项目源码入口"></span>

<span id="这次先打开哪几个文件"></span>

## 跑通后，回到两个真正的入口

本节源码固定在提交 `94cafdd1f36e1f64b316e10466a8f54912c75467`。完整启动入口是 `server.ProxyServer.main` 与 `client.ProxyClient.main`；管理配置从 `PortMappingController.create` 进入。先把下面两个局部读懂就够了。

### 短参数最后落到哪里

看这段 [ProxyClient.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/ProxyClient.java#L39-L42)（原文件 39～42 行，连续原样节选）：

```java
	private static void setAlias(String key, String alias) {
		String val = Solon.cfg().argx().get(alias);
		if (StrUtil.isNotBlank(val)) {
			Solon.cfg().put(key, val);
```

入口调用 `setAlias`，把 `serverIp`、`serverPort` 等短参数写到对应长配置键。这里能确认的是“非空短参数会写入配置”，完整的配置优先级仍需结合加载过程。实验工具使用明确的本地环境和启动参数，不要求你同时手改多份配置。

### 目标连接发生在客户端

看这段 [ProxyMessageConnectHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/handler/ProxyMessageConnectHandler.java#L34-L39)（原文件 34～39 行，连续原样节选）：

```java
		final String visitorId = proxyMessage.getInfo();
		String[] serverInfo = new String(proxyMessage.getData()).split(":");
		String ip = serverInfo[0];
		int port = Integer.parseInt(serverInfo[1]);
		// 连接真实的、被代理的服务
		realServerBootstrap.connect(ip, port).addListener(new ChannelFutureListener() {
```

服务端通过 CONNECT 传来目标地址；真正执行 `connect(ip, port)` 的是 client。server 在 A，client 和 Echo 在 B，映射填 `127.0.0.1`，连接的就是 B。这也是 client 放到容器以后，需要重新检查目标地址的原因。

<span id="给每一步留一个能看见的证据"></span>

## 选做：为断点准备可附加的进程

普通 `java -jar` 进程不能因为你在 IDE 点了红点就自动停住。重新启动终端 A 时加上 `--debug`：

```powershell
python scripts/learning/project_overview.py --mode demo --windows-tcp-pipe --keep-alive 600 --debug --session-file $sessionFile
```

先结束上一轮，再执行它。终端会打印 server/client 各自的本机 JDWP 端口。完整附加步骤和线程观察放在 [05.01](/learn/netty-reactor/)；这里先记住：**附加到哪个 JVM，断点就观察哪个进程。** 源码改动也需要重新构建 JAR，断点不会自动更新旧产物。

<span id="完善清单"></span>

<span id="合上代码前想一想"></span>

## 自测与参考答案

先遮住答案，试着解释给同事听：

<details>
<summary>1. 隧道端口能直接当 Echo 端口访问吗？</summary>

不能。隧道入口期待代理协议；访问者应该连接映射端口。`serverPort` 是 client 连接 server 的隧道端口，不等于映射的业务入口。

</details>

<details>
<summary>2. 直连成功、代理失败，下一步查哪里？</summary>

先确认会话仍在运行，然后查 client 认证、映射监听与异步绑定。直连只证明 Echo 可用，不能证明中间三段都接好了。按“目标 → client → 隧道 → server 映射”的角色逐层缩小范围。

</details>

<details>
<summary>3. 为什么有了结果报告，还需要会话文件？</summary>

报告用来回看一次运行。会话文件告诉第二个终端当前实验是否活动、使用哪些端口；脚本停止后它会标记 `stopped`。上次报告里的端口没有当前存活保证。

</details>

下一篇 [01.04](/learn/source-reading-method/) 练习用 visitorId 串起一次访问；想直接观察处理线程，就去 [05.01](/learn/netty-reactor/)。
