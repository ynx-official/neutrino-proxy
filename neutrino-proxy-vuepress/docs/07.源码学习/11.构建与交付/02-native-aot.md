---
title: "11.02 Solon AOT 与 Native Image 元数据"
date: 2026-10-30
permalink: /learn/native-aot/
article: false
status: Review
updated: 2026-10-30
lesson: "11.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "pom.xml"
    symbol: "<modules>"
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/aot/NeutrinoCoreRuntimeNativeRegistrar.java"
    symbol: "NeutrinoCoreRuntimeNativeRegistrar"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    symbol: "proxyServerCommonInitHandler"
sourceExcerpts:
  - path: "neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/aot/NeutrinoCoreRuntimeNativeRegistrar.java"
    startLine: 20
    endLine: 38
  - path: "pom.xml"
    startLine: 241
    endLine: 243
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java"
    startLine: 48
    endLine: 51
---

# 11.02 Solon AOT 与 Native Image 元数据

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

JVM 能在运行时反射、扫描类型、加载资源；原生构建要提前判断哪些东西会被用到。有些动态入口静态分析看不见，项目就得把这些“别漏掉”的信息主动交出去。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

项目为哪些类注册了反射元数据？为什么启动监听和数据库初始化要识别 AOT 阶段？构建成功是否足以证明运行路径完整？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml) | `<modules>` |
| [core / NeutrinoCoreRuntimeNativeRegistrar.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/aot/NeutrinoCoreRuntimeNativeRegistrar.java) | `NeutrinoCoreRuntimeNativeRegistrar` |
| [server / ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java) | `proxyServerCommonInitHandler` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 元数据在帮分析器看见动态入口

看这段 [NeutrinoCoreRuntimeNativeRegistrar.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-core/src/main/java/org/dromara/neutrinoproxy/core/aot/NeutrinoCoreRuntimeNativeRegistrar.java#L20-L38)（原文件 20～38 行，连续原样节选）：

```java
    public void register(AppContext context, RuntimeNativeMetadata metadata) {
        Set<Class<?>> channelInboundClasses = ClassUtil.scanPackageBySuper("org.dromara.neutrinoproxy", SimpleChannelInboundHandler.class);
        for (Class<?> clazz : channelInboundClasses) {
            metadata.registerReflection(clazz, MemberCategory.INVOKE_DECLARED_METHODS);
        }

        Set<Class<?>> byteBufferClasses = ClassUtil.scanPackageBySuper("java", ByteBuffer.class);
        for (Class<?> clazz : byteBufferClasses) {
            metadata.registerReflection(clazz, MemberCategory.INVOKE_DECLARED_METHODS);
        }

        metadata.registerReflection(ProxyMessage.class, MemberCategory.DECLARED_FIELDS, MemberCategory.INVOKE_DECLARED_METHODS, MemberCategory.INVOKE_DECLARED_CONSTRUCTORS);
        metadata.registerReflection(ProxyMessage.UdpBaseInfo.class, MemberCategory.DECLARED_FIELDS, MemberCategory.INVOKE_DECLARED_METHODS, MemberCategory.INVOKE_DECLARED_CONSTRUCTORS);

        metadata.registerArg("-J--add-opens=java.base/java.lang.invoke=ALL-UNNAMED");
        metadata.registerArg("-J--add-opens=java.base/java.nio=ALL-UNNAMED");
        metadata.registerArg("-J--add-exports=java.base/jdk.internal.misc=ALL-UNNAMED");

        metadata.registerArg("-march=compatibility");
```

注册器扫描 SimpleChannelInboundHandler 子类，登记方法反射；还登记 ByteBuffer 子类，以及 ProxyMessage、UdpBaseInfo 的字段、方法和构造器。JSON 序列化、框架查找和网络库动态使用都可能依赖这些信息。

这不是“把所有类都注册一下”这么简单。哪些动态访问真的发生、资源能否被打进产物、第三方库需要哪些提示，都要按实际依赖核对。基础概念可参考 [GraalVM Reachability Metadata](https://www.graalvm.org/latest/reference-manual/native-image/metadata/)；该在线文档包含新版本能力，本文不把新选项直接套给项目固定的 JDK 21 工具链。

### Solon 的 AOT 与 Native Image 构建相接

POM 的 native profile 包含：

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L241-L243)（原文件 241～243 行，连续原样节选）：

```xml
                                <id>process-aot</id>
                                <goals>
                                    <goal>process-aot</goal>
```

另外启用 GraalVM 的 reachability metadata repository，帮助补第三方依赖的动态信息。构建流程还需要正确的 GraalVM、C 工具链与平台配置，普通 JDK 21 能编译 JAR，不代表当前就能运行 native:compile。

-march=compatibility 关注生成代码的 CPU 指令兼容方向，也不能替代 libc 或操作系统验证。不同层的兼容条件要拆开。

### 分析阶段别真的去打开业务资源

看这段 [ProxyTunnelServer.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/proxy/core/ProxyTunnelServer.java#L48-L51)（原文件 48～51 行，连续原样节选）：

```java
        // aot 阶段，不启动代理服务
        if (NativeDetector.isNotAotRuntime()) {
            startProxyServer();
            startProxyServerForSSL();
```

若框架分析 Bean 时真的 bind 端口、连数据库或启动后台任务，会把构建环境与运行环境混在一起。项目多个初始化入口用 NativeDetector 跳过分析阶段的副作用；运行期再按配置执行。

这里读条件时尤其要小心：方法名中的 isNotAotRuntime 是项目框架提供的阶段判断，应该结合使用位置理解，别把“本次不启动监听”误写成“原生程序永久不支持监听”。

### 原生测试要打到动态路径

至少检查：配置绑定、协议编解码、JSON 认证信息、数据库初始化/mapper、资源读取、TLS 证书和网络连接。缺元数据可能直到特定分支才暴露，仅 main 能启动不够。

当前课程跑的是 JVM JAR 实验，不能因此给 native 运行路径盖章。发布脚本的不同平台烟测也是各自范围证据，后面还会看平台差异。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：从注册器挑 ProxyMessage.UdpBaseInfo，追到 ONode 序列化/反序列化调用，解释为什么字段、方法和构造器可能被动态访问。若已有完整原生工具链，再在临时构建副本比较 JVM 与 native 的同一协议样本；不要为本练习随意升级项目插件。

**怎么验收**：把每项元数据连到实际动态调用，并列出分析阶段必须跳过的副作用。当前未在本轮执行 native 编译和运行，不声明各平台 AOT 已验证。JVM 实验只提供协议与网络的 JVM 证据。

<span id="完善清单"></span>

## 合上代码前想一想

为什么补了元数据仍需要运行测试？为什么构建时访问真实数据库尤其不合适？下一篇 [glibc 与 musl](/learn/native-platforms/) 看系统依赖。
