---
title: "11.01 多模块构建 胖 JAR 与启动验证"
date: 2026-10-30
permalink: /learn/jar-build/
article: false
status: Review
updated: 2026-10-30
lesson: "11.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "pom.xml"
    symbol: "<modules>"
  - path: "scripts/release/release.py"
    symbol: "import "
  - path: "scripts/release/smoke.py"
    symbol: "import "
  - path: "neutrino-proxy-server/pom.xml"
    symbol: "pom"
sourceExcerpts:
  - path: "pom.xml"
    startLine: 19
    endLine: 23
  - path: "neutrino-proxy-server/pom.xml"
    startLine: 81
    endLine: 84
  - path: "scripts/release/release.py"
    startLine: 97
    endLine: 116
  - path: "scripts/release/release.py"
    startLine: 75
    endLine: 80
---

# 11.01 多模块构建 胖 JAR 与启动验证

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

代码在 IDE 里能跑，是第一步；把包交给别人，换个目录还能按说明跑，是另一回事。这篇从 Maven 模块到发布 ZIP，看看配置、静态资源和启动目录怎么一起成为产物的一部分。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

core 为什么先构建？胖 JAR 与分发 ZIP 有什么区别？从别的工作目录启动，配置文件会去哪找？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml) | `<modules>` |
| [scripts / release.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/release.py) | `import ` |
| [scripts / smoke.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/smoke.py) | `import ` |
| [server / pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/pom.xml) | `pom` |

<span id="正文提纲"></span>

## 一起顺着代码走

### Maven 先处理模块依赖

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/pom.xml#L19-L23)（原文件 19～23 行，连续原样节选）：

```xml
    <modules>
        <module>neutrino-proxy-core</module>
        <module>neutrino-proxy-client</module>
        <module>neutrino-proxy-server</module>
    </modules>
```

core 提供两端共用协议，client 和 server 依赖它。使用 -pl 选择目标模块、-am 连带构建依赖，不要只进 client 目录后假设本机 Maven 缓存里一定已有正确版本的 core。

在仓库根目录执行：

```powershell
mvn -B -pl neutrino-proxy-server,neutrino-proxy-client -am package
```

打包插件沿用项目 Solon 约定：

看这段 [pom.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/pom.xml#L81-L84)（原文件 81～84 行，连续原样节选）：

```xml
            <!-- 配置打包插件（并打包成胖包） -->
            <plugin>
                <groupId>org.noear</groupId>
                <artifactId>solon-maven-plugin</artifactId>
```

胖 JAR 把应用与运行依赖整理到一个可启动文件中；它仍需要兼容的 JDK。原生可执行文件是后两篇的另一种产物，不要把“打成一个 JAR”称为不需要 Java。

### ZIP 还包含启动所需的周边

看这段 [release.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/release.py#L97-L116)（原文件 97～116 行，连续原样节选）：

```python
def package_java(root, output, module, kind, platform, version):
    parse_version("v" + version)
    name = f"neutrino-proxy-{module}"
    suffix = ".jar" if kind == "jar" else ".exe" if platform == "windows-x64" else ""
    source = require_file(root / name / "target" / (name + suffix))
    layout = f"{name}-{version}-{java_distribution_suffix(kind, platform)}"
    with tempfile.TemporaryDirectory() as temp:
        directory = Path(temp) / layout
        directory.mkdir()
        shutil.copy2(source, directory / source.name)
        # A partial app-copy.yml contains empty YAML maps that can erase protocol defaults.
        # Distribute the complete build-resolved baseline, including the injected app version.
        shutil.copy2(require_file(root / name / "target/classes/app.yml"), directory / "app.yml")
        shutil.copy2(require_file(root / "LICENSE"), directory / "LICENSE")
        unix, windows = launchers(source.name, kind)
        if kind == "jar" or platform != "windows-x64":
            (directory / "start.sh").write_text(unix, encoding="utf-8", newline="\n")
        if kind == "jar" or platform == "windows-x64":
            (directory / "start.cmd").write_bytes(windows.encode("utf-8"))
        return zip_directory(directory, output / (layout + ".zip"))
```

脚本复制构建后的主产物、完整解析后的 app.yml、许可证和启动器，再压缩。特意不分发一个残缺配置示例，原因写在注释里：空 YAML map 可能抹掉协议默认值。

服务端管理页面还需要先构建并放入正确静态资源位置。CI 在 Java 作业前构建管理端并下载产物；普通本地 Maven 编译成功，不自动证明页面资源来自本次前端构建。

### 启动器固定工作目录

看这段 [release.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/release.py#L75-L80)（原文件 75～80 行，连续原样节选）：

```python
    # Resolve relative config and logs against the installation, regardless of caller cwd.
    unix = '#!/bin/sh\nset -eu\ncd -- "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"\n'
    unix += unix_setup + unix_command + "\n"
    windows = '@echo off\r\nsetlocal\r\ncd /d "%~dp0"\r\n' + windows_setup
    windows += windows_command + '\r\nexit /b %errorlevel%\r\n'
    return unix, windows
```

Unix 与 Windows 启动器都先切换到安装目录。这样相对配置、日志和 ClientId 文件不会因调用者站在别处而漂移；这和直接在任意目录 java -jar /path/app.jar 的行为需要区分。

JAR 启动器优先读取 JAVA_HOME，透传用户参数并保留退出码。路径中有空格、参数带特殊字符、启动失败返回码，都是发布脚本测试应覆盖的行为。

### 验证要在隔离目录

先列 ZIP 内文件，再解压到临时目录，使用临时 H2 和回环配置启动。不要从仓库根目录直接运行来“顺便”借到本地 app.yml 或数据库，否则产物缺文件也可能被掩盖。

课程 01.01 已用临时工作目录启动两端 JAR 并完成真实转发；已有 release smoke 工具则针对解压后的分发包。两种证据互补，不能把某一次 JAR 启动扩大成所有 ZIP/native 均验证。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：先构建 JAR，再只读检查 jar tf 输出里的主类、依赖和 app.yml。使用 01.01 脚本完成临时目录转发；进阶练习用 release.py 的 java 子命令打到新临时输出目录，只生成教学本地包，不运行 prepare 修改版本，也不发布。

**已有实测**：当前 JAR 已构建，01.01 正常 65536 字节往返通过，基础实验记录了实际 JAR 哈希。**待执行**：本轮重新制作并启动各平台全部分发包。打包参数先看 python scripts/release/release.py --help，版本填写合法教学值，输出不要覆盖既有发布目录。

<span id="完善清单"></span>

## 合上代码前想一想

为什么构建 core 通过，不等于两个应用能启动？为什么临时目录启动更容易发现缺文件？下一篇 [AOT 元数据](/learn/native-aot/) 解释原生构建为什么需要额外信息。
