---
title: "09.02 UDP 端口分配 响应次数与超时"
date: 2026-10-30
permalink: /learn/udp-lifecycle/
article: false
status: Review
updated: 2026-10-30
lesson: "09.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/UdpServerUtil.java"
    symbol: "UdpServerUtil"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java"
    symbol: "buildAuthMessage"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/UdpRealServerHandler.java"
    symbol: "UdpRealServerHandler"
sourceExcerpts:
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/UdpServerUtil.java"
    startLine: 145
    endLine: 154
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/UdpRealServerHandler.java"
    startLine: 42
    endLine: 43
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/UdpServerUtil.java"
    startLine: 190
    endLine: 205
---

# 09.02 UDP 端口分配 响应次数与超时

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

UDP 没有 TCP 那样的自然断开事件，客户端得自己决定一个本地端口何时可以交给下一位。项目用“期待响应数量”和“最近活跃超时”做这件事，我们把它读成资源租用的过程。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

proxyResponses=0、-1 和正数分别意味着什么？端口不够时会失败还是降级？超时扫描一次能处理多少条？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [client / UdpServerUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/UdpServerUtil.java) | `UdpServerUtil` |
| [core / ProxyMessage.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/ProxyMessage.java) | `buildAuthMessage` |
| [client / UdpRealServerHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/UdpRealServerHandler.java) | `UdpRealServerHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 端口范围里有一个基础通道

initCache 解析 puppetPortRange，初始化一个默认 UDP 通道，并预先绑定最多额外五个端口；后续端口先进入可用队列，需要时才绑定。端口范围对客户端本机生效，与公网映射端口是两套编号。

范围解析代码要求 max > min，所以 min=max 在当前实现中会被当成错误；不要只按注释猜测“单端口范围一定支持”。初始化被 AOT 检查和配置条件控制，没进入初始化时 default 通道也不能凭空可用。

### 不需要响应与资源不足，都可能走默认通道

看这段 [UdpServerUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/UdpServerUtil.java#L145-L154)（原文件 145～154 行，连续原样节选）：

```java
        // 响应数量为零、超时时间<=0，则不需要响应（注意：响应数量为-1 则不限制响应数量）
        if (info.getProxyResponses() == 0 || info.getProxyTimeoutMs() <= 0) {
            return defaultUdpServerChannel;
        }
        // 没有空闲的 傀儡端口，降级为不需要响应
        Integer port = udpServerFreePortPool.poll();
        if (null == port) {
            return defaultUdpServerChannel;
        }
        realServerChannel = portToChannelMap.get(port);
```

proxyResponses=0 或 timeout<=0 表示这条路径不建立需要响应的专用绑定。-1 在注释与扫描判断中表示不按响应数量结束，仍受活跃超时约束。

空闲端口耗尽时，代码返回默认通道，降级为不需要响应，而不是阻塞等待或统一抛“容量不足”。所以调用方拿到非空 Channel，也不能据此保证一定收到回包。

若隧道已经关联真实 UDP 通道，takeChannel 会复用它，重置 responseCount 和 lastActiveTime。响应次数是相对最近一次发送计数，不能简单理解成整个会话总响应数。

### 收到回包，更新两项信息

看这段 [UdpRealServerHandler.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/core/UdpRealServerHandler.java#L42-L43)（原文件 42～43 行，连续原样节选）：

```java
            udpChannelBindInfo.getLockChannel().setResponseCount(udpChannelBindInfo.getLockChannel().getResponseCount() + 1);
            udpChannelBindInfo.getLockChannel().setLastActiveTime(new Date());
```

响应 Handler 发送回隧道后增加计数、更新最近活跃时间。计数更新与扫描发生在不同执行路径，线程可见性和复合更新是否充分，要结合字段与锁审查；方法上有 synchronized 不会自动锁住所有 Handler。

### 扫描器实际只看列表第一项

看这段 [UdpServerUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/UdpServerUtil.java#L190-L205)（原文件 190～205 行，连续原样节选）：

```java
    public static synchronized void lockChannelScan() {
        if (lockChannelList.isEmpty()) {
            return;
        }
        Iterator<LockChannel> iter = lockChannelList.iterator();
        if (iter.hasNext()) {
            LockChannel lockChannel = iter.next();
            if ((lockChannel.getProxyResponses() > 0 && lockChannel.getResponseCount() >= lockChannel.getProxyResponses()) ||
                    System.currentTimeMillis() - lockChannel.getLastActiveTime().getTime() > lockChannel.getProxyTimeoutMs()
            ) {
                iter.remove();
                UdpChannelBindInfo udpChannelBindInfo = lockChannel.getChannel().attr(Constants.UDP_CHANNEL_BIND_KEY).get();
                // 此处必须释放代理隧道
                closeChannel(udpChannelBindInfo.getTunnelChannel());
                lockChannel.getChannel().attr(Constants.UDP_CHANNEL_BIND_KEY).set(null);
                udpServerFreePortPool.offer(lockChannel.getPort());
```

特别留意 if(iter.hasNext())，这里不是 while。每次扫描最多检查一个 LockChannel；如果第一项长期未到释放条件，后面的即便已超时，也可能没有被本轮看到。

扫描初始延迟 5 秒、之后固定延迟 3 秒。由此不能承诺“配置超时 1 秒，就一定在 1 秒后释放”。除了调度延迟，还有这个遍历边界。当前是源码观察，尚未用多会话时序实验复现。

达到响应次数或活跃超时后，代码关闭隧道、清绑定、归还端口并解绑 NEXT_CHANNEL。资源的复用是否正确，还要检查迟到响应会不会进入下一个会话。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：本地准备可控 UDP 目标，分别返回 0、1、3 个数据报；设置期望响应 1、3、-1，并用小端口范围触发耗尽。再创建两条锁定记录，第一条持续活跃、第二条停止响应，观察扫描是否处理第二条。数据报加会话编号。

**怎么验收**：记录实际释放时间、归还端口、迟到响应归属和降级结果，不能只看日志有 release。上述 UDP 生命周期实验本轮尚未执行。扫描只检查一项、端口不足降级，是当前源码事实，不等于已经确认所有运行表现。

<span id="完善清单"></span>

## 合上代码前想一想

为什么“超时”需要区分配置阈值和实际回收时刻？默认通道能发包，为什么未必有会话回包？下一篇切换到 [HTTP 域名路由](/learn/http-domain-routing/)。
