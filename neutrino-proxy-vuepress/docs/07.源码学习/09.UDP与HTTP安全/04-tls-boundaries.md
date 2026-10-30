---
title: "09.04 HTTPS 与隧道 TLS 的不同边界"
date: 2026-10-30
permalink: /learn/tls-boundaries/
article: false
status: Review
updated: 2026-10-30
lesson: "09.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpsProxy.java"
    symbol: "HttpsProxy"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/SslContextManager.java"
    symbol: "SslContextManager"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    symbol: "proxyServerCommonInitHandler"
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    symbol: "borrowTcpProxyChanel"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpsProxy.java"
    startLine: 52
    endLine: 56
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpsProxy.java"
    startLine: 68
    endLine: 76
  - path: "neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java"
    startLine: 185
    endLine: 196
---

# 09.04 HTTPS 与隧道 TLS 的不同边界

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

项目里既有 HTTPS 代理，又有隧道 ssl-enable，看起来都跟证书有关，却保护着不同的一段网络。把证书配在错误的位置，最常见的结果是“我明明开了 SSL，为什么另一段还是明文”。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

HTTPS 在哪里解密？隧道 TLS 在哪里解密？开启其中一层，能否说明访问者到内网目标的每一段都加密？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / HttpsProxy.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpsProxy.java) | `HttpsProxy` |
| [server / SslContextManager.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/SslContextManager.java) | `SslContextManager` |
| [server / ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java) | `proxyServerCommonInitHandler` |
| [client / ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java) | `borrowTcpProxyChanel` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先画清加密在哪一段结束

| 网络段 | 相关入口/配置 | 当前代码的边界 |
| --- | --- | --- |
| 访问者 → 公网 HTTPS 入口 | HttpsProxy、域名证书 | 服务端终止 TLS，后面可读 HTTP |
| Java 客户端 ↔ 服务端隧道 | tunnel.ssl-enable、SSL 隧道监听 | 包裹 ProxyMessage 传输 |
| Java 客户端 → 内网目标 | realServerBootstrap | 普通 TCP 转发；目标协议另定 |

最后一段不会因为前两项启用，就自动变成目标 HTTPS 客户端。若代理的是完整业务 TLS 字节，也要按实际映射方式分析，不能把两类场景混着讲。

### HTTPS 入口先按 SNI 选上下文

看这段 [HttpsProxy.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpsProxy.java#L52-L56)（原文件 52～56 行，连续原样节选）：

```java
                            ch.pipeline().addLast(createSniHandler());
//                            ch.pipeline().addFirst(new BytesMetricsHandler());
                            ch.pipeline().addLast(new HttpVisitorSecurityChannelHandler(true));
                            ch.pipeline().addLast("flowLimiter",new VisitorFlowLimiterChannelHandler());
                            ch.pipeline().addLast(new HttpVisitorChannelHandler());
```

SNI Handler 在 HTTP 处理之前；TLS 解密后，HttpVisitorSecurityChannelHandler(true) 才能读取 Host。SNI 与 Host 出现在不同层，并非同一个字段。

看这段 [HttpsProxy.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/enhance/HttpsProxy.java#L68-L76)（原文件 68～76 行，连续原样节选）：

```java
            return new SniHandler(domainName -> {
                SslContext sslContext = sslContextManager.getSslContextByFullDomain(domainName);
                if (sslContext != null) {
                    return sslContext;
                } else {
                    log.info("No SSL context available for domain: {}", domainName);
                    return null;
                }
            });
```

SslContextManager 维护域名到 SslContext 的映射，从数据库中的 JKS 字节和密码加载密钥材料；查询完整域名时，还经过项目的域名解析关系。这里不能从 getSslContext 非空直接推断证书链、有效期和域名均被真实客户端接受。

找不到上下文返回 null 的握手表现，应由实际 TLS 客户端测试，而不是只看方法返回值猜测。

### 隧道 TLS 是另一套证书用途

看这段 [ProxyUtil.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-client/src/main/java/org/dromara/neutrinoproxy/client/util/ProxyUtil.java#L185-L196)（原文件 185～196 行，连续原样节选）：

```java
			SSLContext clientContext = SSLContext.getInstance("TLS");
			final KeyStore ks = KeyStore.getInstance("JKS");
			ks.load(jksInputStream, proxyConfig.getTunnel().getKeyStorePassword().toCharArray());
			TrustManagerFactory tmf = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm());
			tmf.init(ks);
			TrustManager[] trustManagers = tmf.getTrustManagers();
			clientContext.init(null, trustManagers, null);

			SSLEngine sslEngine = clientContext.createSSLEngine();
			sslEngine.setUseClientMode(true);

			return new SslHandler(sslEngine);
```

Java 客户端从 JKS 建立 TrustManager，再创建客户端模式 SSLEngine。服务端 SSL 隧道加载自己的密钥，先安装 SslHandler 再走共同的协议 Pipeline。

SSL 参数必须与所连端口匹配：TLS 客户端连普通隧道端口，或明文客户端连 SSL 端口，都不是 License 错误。排障顺序应先握手，再协议，再认证。

这段客户端代码没有展示显式设置 endpointIdentificationAlgorithm 的步骤。信任链验证、主机名验证和业务 License 认证是不同检查，不能用“使用 TrustManager”一句话证明它们全部成立。本文没有完成证书安全审计，也不改变认证策略。

### 实验要检查两层证据

访问者 HTTPS 用测试 CA 签的 .test 域名证书，客户端隧道用单独测试信任库。分别改变域名、信任库和目标端口，观察在哪一层失败；不要通过关闭验证来让实验表面成功。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：在隔离环境分别测试 HTTPS 域名入口和 SSL 隧道：正确信任与域名、不受信任证书、域名不匹配、TLS/明文端口配错。测试 CA 和私钥只保存在临时目录，不加入仓库；把结果表分成握手、AUTH、业务响应三列。

**怎么验收**：说明每个证书由哪一端出示、哪一端验证，以及服务端哪里看到明文 HTTP。上述 TLS 矩阵本轮尚未执行，01.01 的明文回环实验不提供证书验证证据。源码能说明处理顺序，不能替代实际握手结果。

<span id="完善清单"></span>

## 合上代码前想一想

为什么浏览器 HTTPS 成功不能证明 Java 隧道启用了 TLS？反过来，隧道 TLS 正常又为什么不能证明内网目标连接加密？下一篇看 [安全组和限速](/learn/security-rate-limiting/)。
