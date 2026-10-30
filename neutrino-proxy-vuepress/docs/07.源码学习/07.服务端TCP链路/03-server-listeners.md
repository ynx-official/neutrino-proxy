---
title: "07.03 映射监听与访问者连接管理"
date: 2026-10-30
permalink: /learn/server-listeners/
article: false
status: Review
updated: 2026-10-30
lesson: "07.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    symbol: "initVisitorChannel"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java"
    symbol: "addCmdChannel"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 59
    endLine: 66
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java"
    startLine: 191
    endLine: 211
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java"
    startLine: 219
    endLine: 233
---

# 07.03 映射监听与访问者连接管理

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

有了已认证的客户端，服务端还得知道：公网的哪个端口，应该找它转发到哪里？这一篇把数据库映射、内存索引和操作系统监听连起来，顺便辨认三个名字都带 Channel 的不同角色。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

配置一条映射，是否一定马上创建一条访问者连接？serverPort → cmdChannel 这张表，和 visitorId → visitorChannel 的表有什么区别？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java) | `initVisitorChannel` |
| [server / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java) | `addCmdChannel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 没有业务请求，也可以先有控制连接

看这段 [VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L59-L66)（原文件 59～66 行，连续原样节选）：

```java
    public void initVisitorChannel(Integer licenseId, Channel cmdChannel) {
        List<PortMappingDO> portMappingList = portMappingMapper.findEnableListByLicenseId(licenseId);
        // 没有端口映射仍然保持连接
        ProxyUtil.initProxyInfo(licenseId, ProxyMapping.buildList(portMappingList));

        ProxyUtil.addCmdChannel(licenseId, cmdChannel, portMappingList.stream().map(PortMappingDO::getServerPort).collect(Collectors.toSet()));

        startUserPortServer(ProxyUtil.getAttachInfo(cmdChannel), portMappingList);
```

先查启用映射，初始化代理信息，再登记控制连接，最后按映射开启监听。即使映射列表为空，控制连接也会登记；代码注释明确写了“没有端口映射仍然保持连接”。

所以“客户端已在线、映射为空”不是自相矛盾。控制连接维持客户端会话，访问者连接则要等真正有人访问映射端口才会出现。

### 两张索引，两个查找方向

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/util/ProxyUtil.java#L191-L211)（原文件 191～211 行，连续原样节选）：

```java
	public static void addCmdChannel(Integer licenseId, Channel cmdChannel, Set<Integer> serverPorts) {
		if (!CollectionUtil.isEmpty(serverPorts)) {
			for (int port : serverPorts) {
				serverPortToCmdChannelMap.put(port, cmdChannel);
			}
		}
		CmdChannelAttachInfo cmdChannelAttachInfo = getAttachInfo(cmdChannel);
		if (null == cmdChannelAttachInfo) {
			cmdChannelAttachInfo = new CmdChannelAttachInfo()
					.setIp(((InetSocketAddress)cmdChannel.remoteAddress()).getAddress().getHostAddress())
					.setLicenseId(licenseId)
					.setVisitorChannelMap(new HashMap<>(16))
					.setServerPorts(Sets.newHashSet());
			setAttachInfo(cmdChannel, cmdChannelAttachInfo);
		}

		if (!CollectionUtil.isEmpty(serverPorts)) {
			cmdChannelAttachInfo.getServerPorts().addAll(serverPorts);
		}

		licenseToCmdChannelMap.put(licenseId, cmdChannel);
```

serverPortToCmdChannelMap 让访问者从本地接入端口找到控制连接；licenseToCmdChannelMap 让认证、更新与断开流程按 License 找到它。CmdChannelAttachInfo 中还保存该客户端的端口集合和 visitorChannelMap。

| 对象 | 生命周期起点 | 用来做什么 |
| --- | --- | --- |
| 监听 Channel | bind 映射端口 | 接受后续访问 |
| 控制 Channel | 客户端建立隧道并认证 | 接收连接命令、维持会话 |
| 访问者 Channel | 外部连接被接受 | 承载这次业务字节 |
| 数据隧道 Channel | 客户端为业务取得连接 | 与访问者成对转发 |

端口集合不是访问者连接集合；监听存在也不意味着每时每刻都有数据连接。

### 真正监听要到 Bootstrap.bind

看这段 [VisitorChannelService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/VisitorChannelService.java#L219-L233)（原文件 219～233 行，连续原样节选）：

```java
        for (PortMappingDO portMapping : portMappingList) {
            if (EnableStatusEnum.DISABLE.getStatus().equals(portMapping.getEnable())) {
                // 端口映射被禁用了，忽略 TODO 映射没被禁用，但端口被禁用了也需要处理
                continue;
            }
            try {
                proxyMutualService.bindServerPort(cmdChannelAttachInfo, portMapping.getServerPort());

                NetworkProtocolEnum networkProtocolEnum = NetworkProtocolEnum.of(portMapping.getProtocal());
                if (networkProtocolEnum == NetworkProtocolEnum.UDP) {
                    udpServerBootstrap.bind(portMapping.getServerPort()).get();
                    log.info("bind UDP user port： {}", portMapping.getServerPort());
                } else {
                    tcpServerBootstrap.bind(portMapping.getServerPort()).get();
                    log.info("bind TCP user port： {}", portMapping.getServerPort());
```

proxyMutualService.bindServerPort 与 Bootstrap.bind 是两个不同动作。前者维护项目侧关系和状态，后者才请求操作系统绑定 TCP 或 UDP 端口。

方法后面的异常处理对 BindException 做了特判，但“地址已占用”不等于“本进程已经正确监听这条映射”。启动路径上还有关于禁用端口池的 TODO，所以不要把增量更新路径的所有校验都套给初始化路径。具体差异可以回看 [运行态一致性](/learn/runtime-consistency/)。

### 请求到了，才分配 visitorId

访问者的 channelActive 会读取 localAddress.port，找到 cmdChannel 和目标 lanInfo，分配 visitorId 并登记，然后向客户端发 CONNECT。每次访问者连接有自己的身份；同一个映射端口可以同时服务多个访问者。

serverPortToVisitorChannel 是单个端口到一个 Channel 的索引，不能单靠它枚举该端口全部并发连接。要看所有访问者，需要追控制连接附带的 visitorChannelMap。读集合名时，多问一次“这是全集，还是某种快捷索引”，会少很多误会。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：用一个临时 License 建立两条本地 TCP 映射，再对同一映射并行建立两条访问者连接。记录端口数、控制连接数、visitorId 数量和数据隧道数量；再在副本中删除全部映射，观察控制连接是否保留。

**怎么验收**：能把四种 Channel 画成不同对象，说明一个端口为什么对应多个 visitorId。01.01 已实测两条映射中的健康链路与不可达目标互不等同；本篇的并发数量与删除后控制连接观测尚未执行。记录观察值，别靠估算填表。

<span id="完善清单"></span>

## 合上代码前想一想

为什么“端口已登记”和“端口已 bind”不能用同一个勾表示？空映射时客户端保持在线有什么意义？下一篇 [VisitorId 与绑定](/learn/server-connect-binding/) 看会话如何接起来。
