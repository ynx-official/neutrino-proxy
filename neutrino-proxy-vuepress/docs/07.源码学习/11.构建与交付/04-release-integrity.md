---
title: "11.04 CI 产物完整性 哈希与发布规则"
date: 2026-10-30
permalink: /learn/release-integrity/
article: false
status: Review
updated: 2026-10-30
lesson: "11.04"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: ".github/workflows/release.yml"
    symbol: "jobs:"
  - path: "scripts/release/release.py"
    symbol: "import "
sourceExcerpts:
  - path: "scripts/release/release.py"
    startLine: 135
    endLine: 140
  - path: "scripts/release/release.py"
    startLine: 187
    endLine: 205
  - path: ".github/workflows/release.yml"
    startLine: 3
    endLine: 15
---

# 11.04 CI 产物完整性 哈希与发布规则

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

发布最怕一种安静的错误：八个包少了一个，或者校验文件来自另一轮构建。项目把“该有哪些”和“实际有哪些”做成严格比对，我们顺着这条链看看代码如何约束交付。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

当前完整产物集合是什么？哈希能证明什么、不能证明什么？手动验证、推 tag 与正式发布各有什么触发条件？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [.github / release.yml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/.github/workflows/release.yml) | `jobs:` |
| [scripts / release.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/release.py) | `import ` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先列期望集合，别靠人记

看这段 [release.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/release.py#L135-L140)（原文件 135～140 行，连续原样节选）：

```python
def expected_assets(version):
    files = [f"neutrino-proxy-{module}-{version}-jdk21.zip" for module in ("server", "client")]
    files += [f"neutrino-proxy-{module}-{version}-{platform}-native.zip"
              for platform in ("linux-x64", "windows-x64") for module in ("server", "client")]
    files += [f"neutrino-proxy-{module}-{version}-linux-x64-musl-static.zip" for module in ("server", "client")]
    return files
```

server 与 client 各有 JDK21 JAR ZIP、Linux x64 native、Windows x64 native、Linux x64 musl static，一共八个分发 ZIP。桌面客户端已经独立仓库发布，不在这个集合中。

汇总还生成 SHA256SUMS 与 release-manifest.json，两者不计作八个应用包。一个负责核对内容哈希，一个记录版本、提交、工作流、测试策略和构建信息。

### 缺一个、多一个，都不能悄悄通过

看这段 [release.py](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/scripts/release/release.py#L187-L205)（原文件 187～205 行，连续原样节选）：

```python
def assemble(output, version, commit, run_url):
    expected = set(expected_assets(version))
    present = {path.name for path in output.iterdir() if path.is_file()}
    present -= {"SHA256SUMS", "release-manifest.json"}
    if expected != present:
        raise ValueError(f"Release assets mismatch: missing={sorted(expected - present)}, extra={sorted(present - expected)}")
    tests_skipped = os.environ.get("SKIP_TESTS") == "true"
    compatibility = validate_linux_static(output, version, tests_skipped)
    assets = [{"name": name, "size": require_file(output / name).stat().st_size,
               "sha256": hashlib.sha256((output / name).read_bytes()).hexdigest()} for name in sorted(expected)]
    builds = {path.stem: json.loads(path.read_text(encoding="utf-8"))
              for path in sorted((output / "build-info").glob("*.json"))}
    write_json(output / "release-manifest.json", {
        "version": version, "tag": "v" + version, "commit": commit, "workflow_run": run_url,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "tests_skipped": tests_skipped, "linux_compatibility": compatibility,
        "builds": builds, "assets": assets,
    })
    names = sorted(expected | {"release-manifest.json"})
```

实际文件集合移除两个汇总文件后，必须和 expected 完全一致。随后校验 musl 检查报告与归档哈希，给每个包计算大小和 SHA-256，再写 manifest。

哈希能检查“下载的内容与所对照清单是否一致”，但如果包和清单同时来自不可信来源，单靠哈希不建立可信发布者身份。来源提交和工作流记录同样需要与受信任仓库和发布过程结合理解。

### 工作流触发与本机授权分开看

看这段 [release.yml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/.github/workflows/release.yml#L3-L15)（原文件 3～15 行，连续原样节选）：

```yaml
on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: 'Existing tag to build, for example v2.1.0'
        required: true
        type: string
      publish:
        description: 'Automatically publish a public, stable GitHub Release'
        type: boolean
        default: false
```

文件里配置 v* tag push 触发发布流程；手动 workflow_dispatch 的 publish 默认 false，另有 skip_tests 当次开关。完整 workflow 的正式公开发布条件是 tag push 或本次手动 publish；不是每次运行都公开发布。

skip_tests 不绕过构建、产物完整集合、musl 全静态检查与哈希约束。它也不应成为教学时的默认捷径。

本仓库协作约定另外禁止擅自提交、推送、创建 tag 或发布。本章只是阅读与本地测试，没有触发远程工作流；代码中存在自动规则，也不是本次可以自行推 tag 的授权。

### 回归测试是本地可练的一步

在仓库根目录运行：

```powershell
python -m unittest discover -s scripts/release -p "test_*.py" -v
```

测试用临时 fixture 验证归档命名、缺包、多包、哈希和发布前置条件等。测试通过并不表示当前工作区已构建出全部八个真实产物，也不代表本次已公开 Release。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：只运行本地发布脚本测试，再阅读一个缺包用例与一个哈希不匹配用例，说明它们应在哪个阶段失败。若自建教学目录，全部使用虚构小文件，输出到新临时路径；不运行 publish.py，不创建 tag。

**怎么验收**：能列全八个分发包和两个汇总文件，解释测试开关与硬检查的区别。本篇不重新构建或发布全部平台产物；本地脚本回归结果以课程进度文档的实际运行记录为准。任何后续正式发布仍需当次授权。

<span id="完善清单"></span>

## 合上代码前想一想

为什么检查额外文件与检查缺失文件同样有价值？为什么测试脚本通过不等于真实发布完整？Java 主线至此收束；有兴趣可选修 [Java 与 Rust 协议兼容](/learn/desktop-protocol/)。
