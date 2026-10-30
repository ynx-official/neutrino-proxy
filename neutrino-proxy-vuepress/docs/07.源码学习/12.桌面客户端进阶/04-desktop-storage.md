---
title: "12.04 配置导入 凭证存储与诊断日志"
date: 2026-10-30
permalink: /learn/desktop-storage/
article: false
status: Review
updated: 2026-10-30
lesson: "12.04"
track: desktop
sourceBaseline: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
sourceReferences:
  - repository: desktop
    path: "src-tauri/src/storage.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/storage.rs"
  - repository: desktop
    path: "docs/03-architecture/client-app-java-compatibility.md"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/docs/03-architecture/client-app-java-compatibility.md"
  - repository: desktop
    path: "src-tauri/src/config_import.rs"
    url: "https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/config_import.rs"
sourceExcerpts:
  - repository: desktop
    path: "src-tauri/src/storage.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 11
    endLine: 20
  - repository: desktop
    path: "src-tauri/src/storage.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 72
    endLine: 83
  - repository: desktop
    path: "src-tauri/src/storage.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 104
    endLine: 115
  - repository: desktop
    path: "src-tauri/src/config_import.rs"
    commit: eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c
    startLine: 68
    endLine: 76
---

# 12.04 配置导入 凭证存储与诊断日志

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[Java 客户端状态机](/learn/client-state-machine/)

界面要记住服务器和偏好，也要保存 License 与证书库密码。它们不该一股脑写进同一个 JSON。我们看现有项目怎样把普通配置与系统凭证关联起来，再检查保存一半失败时如何收尾。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

config.json 里保存了什么？系统凭证写成功、配置文件替换失败怎么办？导入预览为什么只暴露一个 ID 和摘要？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

本篇选修使用独立桌面仓库提交 `eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c`，不把桌面源码迁回 Java 仓库。本站构建只校验已核对的离线节选，不要求检出相邻桌面目录。

| 文件 | 阅读入口 |
| --- | --- |
| [storage.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/storage.rs) | 独立仓库固定提交的完整上下文 |
| [client-app-java-compatibility.md](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/docs/03-architecture/client-app-java-compatibility.md) | 独立仓库固定提交的完整上下文 |
| [config_import.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/config_import.rs) | 独立仓库固定提交的完整上下文 |

<span id="正文提纲"></span>

## 一起顺着代码走

### JSON 保存索引，秘密另放

看这段 [storage.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/storage.rs#L11-L20)（桌面仓库原文件 11～20 行，连续原样节选）：

```rust
#[serde(rename_all = "camelCase")]
struct Stored {
    schema_version: u32,
    config: ClientConfig,
    credential_id: String,
}
#[derive(Serialize, Deserialize)]
struct Credential {
    license: String,
    store_password: String,
```

Stored 包含 schema_version、ClientConfig 和 credential_id；Credential 保存 License 与证书库密码，交给系统 keyring。JSON 并不直接包含这两个字段，启动时再用 SERVICE 与 credential_id 取回秘密。

这不是“秘密从此无法被任何程序读取”的承诺。系统账户、凭证存储权限、宿主进程和导出逻辑仍是边界；但把配置文件与秘密分开，让常规配置检查和分享更可控。

读取失败会保留原配置文件并提示重新填写，不悄悄删除用户数据。schemaVersion 不兼容也显式报错。

### 保存用新凭证关联到新文件

看这段 [storage.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/storage.rs#L72-L83)（桌面仓库原文件 72～83 行，连续原样节选）：

```rust
    pub fn save(&mut self, config: ClientConfig, secrets: Secrets) -> Result<(), String> {
        let id = uuid::Uuid::new_v4().to_string();
        let entry =
            keyring::Entry::new(SERVICE, &id).map_err(|_| "系统安全存储不可用".to_owned())?;
        let credential = serde_json::to_string(&Credential {
            license: secrets.license.clone(),
            store_password: secrets.store_password.clone(),
        })
        .map_err(|_| "无法保存凭证".to_owned())?;
        entry
            .set_password(&credential)
            .map_err(|_| "无法写入系统安全存储，配置尚未保存".to_owned())?;
```

先生成新 ID，写系统凭证，再构造 Stored，写临时文件、sync_all、rename 替换配置。保存文件失败会删除刚创建的凭证；文件完成后才清理旧凭证并更新内存。

看这段 [storage.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/storage.rs#L104-L115)（桌面仓库原文件 104～115 行，连续原样节选）：

```rust
        if let Err(error) = saved {
            let _ = entry.delete_credential();
            return Err(error);
        }
        if !self.credential_id.is_empty() {
            if let Ok(old) = keyring::Entry::new(SERVICE, &self.credential_id) {
                let _ = old.delete_credential();
            }
        }
        self.config = config;
        self.secrets = secrets;
        self.credential_id = id;
```

这是补偿式保存流程，不是跨 keyring 与文件系统的真正原子事务。进程在不同语句间崩溃，仍可能留下待清理条目；删除旧凭证也忽略错误。分析时应区分一般错误分支和进程崩溃边界。

### 导入先预览，再按一次性 ID 应用

preview_import 限制文件大小，解析到内存后，返回 config、是否含 License、提示与 imported_fields；秘密保存在 PendingImport 中，不随预览明文返回。应用时校验预览 ID 并 take，失效 ID 不能继续用。

旧 ClientId 导入也收窄到用户选中的 YAML 同目录：

看这段 [config_import.rs](https://github.com/ynx-official/neutrino-proxy-client-desktop/blob/eb0c697d27f5ca6834cf4e1f5f3c536d77faf10c/src-tauri/src/config_import.rs#L68-L76)（桌面仓库原文件 68～76 行，连续原样节选）：

```rust
        // Selection of the YAML authorizes only its sibling identity, never cwd/home discovery.
        let identity = path
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(".NEUTRINO_PROXY_CLIENT_ID");
        if let Ok(metadata) = std::fs::symlink_metadata(&identity) {
            if metadata.is_file() && !metadata.file_type().is_symlink() && metadata.len() <= 4096 {
                if let Some(id) = std::fs::read_to_string(identity).ok().and_then(non_blank) {
                    config.client_id = id;
```

显式 YAML clientId 优先；只考虑同目录普通非符号链接且最多4KiB的身份文件，不去当前目录或 home 到处搜索。相对证书路径也按所选 YAML 的目录解释，避免和 Java 启动工作目录混淆。

### 日志有上限，不等于自动脱敏万能

Engine.log 截断消息长度并限制条目数，快照提供 license_hint；这些机制不能替代调用方检查。若未来把原始 AUTH info、异常参数或导入文件内容直接传给 log，长度限制不会自动删除秘密。

分享诊断日志应只含状态、时间、角色与错误类别，不记录真实凭证。桌面 TLS 的名称校验策略已在独立仓库记录为明确兼容选择，本篇不变更这项规则。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：用虚构 YAML 和单独测试账户/隔离存储验证导入预览、取消、ID失效和相对证书路径。配置写失败的补偿先用替身测试，不手动破坏现有系统凭证。比较保存前后 JSON，只核对字段名称与 credential_id，不输出真实 keyring 值。

**怎么验收**：JSON 没有明文秘密，失败不覆盖原配置，取消预览不应用，日志不含虚构秘密样本。本轮只核对这条实现链，未对真实系统 keyring 做故障注入或重新执行各平台持久化矩阵。不同操作系统需独立验证。

<span id="完善清单"></span>

## 合上代码前想一想

为什么“写临时文件再 rename”不能让 keyring 和文件成为一个事务？为什么导入只读用户选中文件的相邻身份文件更容易解释授权范围？至此选修也串完了，可以回到[学习目录](/learn/)按兴趣重跑某条链。
