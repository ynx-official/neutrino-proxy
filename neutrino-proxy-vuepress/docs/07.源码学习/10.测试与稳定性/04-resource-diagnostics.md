---
title: "10.04 线程 Channel 与内存排障"
date: 2026-10-30
permalink: /learn/resource-diagnostics/
article: false
status: Review
updated: 2026-10-30
lesson: "10.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    symbol: "decode"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    symbol: "reconnect"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    symbol: "borrowTcpProxyChanel"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java"
    startLine: 42
    endLine: 42
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    startLine: 150
    endLine: 159
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java"
    startLine: 63
    endLine: 72
---

# 10.04 线程 Channel 与内存排障

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

“代理卡住了”不是一个能直接修复的问题。把它拆成线程不动、连接没配好、字节在排队、内存未回收，通常就能找到下一个观察点。我们用项目里的两个资源入口练习排查。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

该先抓线程栈还是先数 Channel？如何把某个 visitorId 的连接变化与内存现象联系起来？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [core / ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java) | `decode` |
| [client / ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java) | `reconnect` |
| [client / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java) | `borrowTcpProxyChanel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先保留一个能串起来的身份

日志先记 visitorId、Channel ID、连接角色、事件和时间，避免直接打印完整 ProxyMessage。后者的 toString 可能带 data 或凭证，既噪声大，也不利于分享诊断记录。

对于“连上但无响应”，先按链核对：控制连接活跃 → AUTH → 映射监听 → 目标连接 → 数据隧道绑定 → AUTO_READ → 请求/响应字节。缺哪一站就定位哪一层，不必先抓整台机器的所有数据。

### 线程不动时，问它在等什么

看这段 [ProxyClientService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/ProxyClientService.java#L42-L42)（原文件 42～42 行，连续原样节选）：

```java
	private static final ScheduledExecutorService reconnectExecutor = Executors.newSingleThreadScheduledExecutor(new CustomThreadFactory("ClientReconnect"));
```

重连调度器独立存在，Netty 还有各类 EventLoop。线程栈中看到 connect.sync 等待，要结合线程名字判断它是否处在调度任务；看到 EventLoop 里同步数据库或长循环，则考虑同组连接是否一起受影响。

可以在实验进程仍活着时执行 JDK 诊断命令：

```powershell
jcmd -l
jcmd <实验PID> Thread.print
jcmd <实验PID> GC.heap_info
```

把占位符换成你刚启动的实验进程 PID。命令输出可能含路径或参数，保存前检查脱敏。GC.heap_info 不等于直接内存统计；不要只看一个堆数字就排除 ByteBuf 问题。

### 连接清了，索引也得检查

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java#L150-L159)（原文件 150～159 行，连续原样节选）：

```java
	public static void clearRealServerChannels() {
		Iterator<Map.Entry<String, Channel>> ite = realServerChannels.entrySet().iterator();
		while (ite.hasNext()) {
			Channel realServerChannel = ite.next().getValue();
			if (realServerChannel.isActive()) {
				realServerChannel.writeAndFlush(Unpooled.EMPTY_BUFFER).addListener(ChannelFutureListener.CLOSE);
			}
		}

		realServerChannels.clear();
```

清理函数遍历已登记真实连接，写空缓冲后关闭，再 clear map。它没有在这一行同步等待所有 close Future 完成。所以 map 已空与所有操作系统连接已关闭，可能有短暂时差。

服务端 ProxyUtil.getCacheInfo 还暴露多张索引的数量。用它比对阶段前后趋势有帮助，但某张表数量不为 0 可能是预期保留的映射，不应无差别要求所有缓存清零。

### 内存问题要回到所有权

看这段 [ProxyMessageDecoder.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessageDecoder.java#L63-L72)（原文件 63～72 行，连续原样节选）：

```java
        int infoLength = in.readInt();
        byte[] infoBytes = new byte[infoLength];
        in.readBytes(infoBytes);
        proxyMessage.setInfo(new String(infoBytes));

        byte[] data = new byte[frameLength - TYPE_SIZE - SERIAL_NUMBER_SIZE - INFO_LENGTH_SIZE - infoLength];
        in.readBytes(data);
        proxyMessage.setData(data);

        in.release();
```

正常 release 在读取之后。基础实验已经发现所测畸形 infoLength 的异常路径多保留一个引用；这比“内存看起来上涨”更具体。但它也不说明所有内存增长都来自这个位置。

还应分别看堆数组、直接内存、线程数量、连接句柄和池容量。只在临时实验进程按需要开启 Netty 泄漏检测或 Native Memory Tracking；开启方式和开销另行核对，别临时把高开销诊断设置带到共享服务。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在正常转发前、连接中、关闭后各取一份线程与连接数量记录。再运行基础畸形帧实验，比较“确定的多余引用”与 JVM 总内存变化的证据强度。报告使用阶段和角色，不发布真实凭证、完整请求或数据库连接参数。

**已有实测**：两个 Decoder 异常资源观察见[基础记录](/labs/foundations-result.json)，工具已手动清理其诊断资源。**尚未执行**：进程级长时泄漏分析与完整 jcmd 采样。本篇给出排查路线，不宣称定位全部内存或线程问题。

<span id="完善清单"></span>

## 合上代码前想一想

为什么缓存条目数、活跃 Channel 数与 OS socket 数未必在同一瞬间相等？下一次遇到卡住，你会先补哪一条身份日志？最后看 [流量与定时任务](/learn/flow-jobs/)，把运行数据连到持久化。
