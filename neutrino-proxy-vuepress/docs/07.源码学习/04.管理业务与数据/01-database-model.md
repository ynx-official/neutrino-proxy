---
title: "04.01 用户 License 与映射数据模型"
date: 2026-10-30
permalink: /learn/database-model/
article: false
status: Review
updated: 2026-10-30
lesson: "04.01"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/resources/sql/mysql/init-structure.sql"
    symbol: "CREATE TABLE"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java"
    symbol: "initDBStructure"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/resources/sql/mysql/init-structure.sql"
    startLine: 85
    endLine: 98
  - path: "neutrino-proxy-server/src/main/resources/sql/mysql/init-structure.sql"
    startLine: 101
    endLine: 120
---

# 04.01 用户 License 与映射数据模型

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

用户、License、端口池、端口映射……名字一多，后台页面就容易变成一排互不相干的菜单。我们先拿一个小场景串起来：某个用户，想让一个客户端把内网 Echo 服务开放出去。为了描述这件事，数据库到底记了哪些东西？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

已经有用户了，为什么还要 License？已经有端口映射了，为什么又有端口池？先给这几个对象各分配一个职责，再去看字段。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / init-structure.sql](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/resources/sql/mysql/init-structure.sql) | `CREATE TABLE` |
| [server / DBInitialize.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java) | `initDBStructure` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先画一条最短的业务关系

```text
用户
  → 拥有 License
    → License 下配置端口映射
      → 服务端映射端口 → 客户端可达的目标 IP:端口

端口池 / 分组：描述可使用端口及其归属
域名映射：把域名入口关联到某条映射
安全组：给访问规则提供配置
```

用户是管理业务里的身份；License 是客户端连接时使用的业务凭证；端口映射描述“哪一个外部入口，转到哪里”。它们可以关联，但不需要混成同一个概念。

比如，管理用户登录后可以配置多条映射，客户端则按 License 认证。你退出浏览器，不代表客户端的控制连接也跟着退出。前面实测的“不再发管理请求仍可转发”，正好能帮这个区别落地。

### License 记下的是哪种归属

看这段 [init-structure.sql](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/resources/sql/mysql/init-structure.sql#L85-L98)（原文件 85～98 行，连续原样节选）：

```sql
CREATE TABLE IF NOT EXISTS `license` (
    `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `name` varchar(50) NOT NULL COMMENT 'license名称',
    `key` varchar(100) NOT NULL COMMENT 'license key',
    `user_id` int NOT NULL COMMENT '用户ID',
    `up_limit_rate` varchar(20) DEFAULT NULL COMMENT '上传限速',
    `down_limit_rate` varchar(20) DEFAULT NULL COMMENT '下载限速',
    `is_online` int NOT NULL COMMENT '是否在线（1、在线 2、离线）',
    `enable` int NOT NULL COMMENT '是否启用(1、启用 2、禁用)',
    `create_time` datetime(3) NOT NULL COMMENT '创建时间',
    `update_time` datetime(3) NOT NULL COMMENT '更新时间',
    PRIMARY KEY (`id`) USING BTREE,
    KEY `I_license_key` (`key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

user_id 把 License 关联到用户，key 用于客户端认证，enable 表达配置开关，is_online 则是记录下来的在线状态。限速字段属于另一组业务约束。

看到 is_online，别立刻把它当作“这条 License 下每个目标都健康”。认证、映射监听和目标连接发生在不同阶段。相同 License 下可以一条映射能通，另一条目标不可达；本地实验已经出现过这个组合。

### 映射把入口和目标连起来

看这段 [init-structure.sql](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/resources/sql/mysql/init-structure.sql#L101-L120)（原文件 101～120 行，连续原样节选）：

```sql
CREATE TABLE IF NOT EXISTS `port_mapping` (
    `id` int NOT NULL AUTO_INCREMENT COMMENT '主键ID',
    `license_id` int NOT NULL COMMENT 'licenseID',
    `protocal` varchar(10) NOT NULL DEFAULT 'TCP' COMMENT '协议',
    `server_port` int NOT NULL COMMENT '服务端端口',
    `client_ip` varchar(255) NOT NULL COMMENT '客户端IP',
    `client_port` int NOT NULL COMMENT '客户端端口',
    `up_limit_rate` varchar(20) DEFAULT NULL COMMENT '上传限速',
    `down_limit_rate` varchar(20) DEFAULT NULL COMMENT '下载限速',
    `is_online` int NOT NULL COMMENT '是否在线（1、在线 2、离线）',
    `description` varchar(100) DEFAULT NULL COMMENT '描述',
    `proxy_responses` int NOT NULL DEFAULT 0 COMMENT '代理响应数据包数量',
    `proxy_timeout_ms` int NOT NULL DEFAULT 0 COMMENT '代理超时毫秒数',
    `enable` int NOT NULL COMMENT '是否启用(1、启用 2、禁用)',
    `security_group_id` int DEFAULT 0 COMMENT '安全组Id',
    `create_time` datetime(3) NOT NULL COMMENT '创建时间',
    `update_time` datetime(3) NOT NULL COMMENT '更新时间',
    PRIMARY KEY (`id`),
    KEY `I_port_mapping_server_port` (`server_port`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

沿字段读一遍就有画面了：license_id 选客户端身份，server_port 选服务端入口，client_ip 与 client_port 指向客户端需要连接的目标。protocal 是项目当前字段拼写，读代码和构造请求都要按实际名称来。

其余字段再分组看：enable / is_online 是状态，security_group_id 指向访问规则，proxy_responses / proxy_timeout_ms 与 UDP 回包语义有关，限速是流量约束。先把核心映射关系读通，别被一排可选字段分散注意力。

### 画了关系线 还得确认是谁守住它

表里有 user_id、license_id，不表示数据库已经声明了 FOREIGN KEY。这里的建表语句还要结合 Service 的存在性检查、删除限制和实际索引来读。

也留意 KEY 与 UNIQUE KEY 的区别。上面的映射端口索引是普通索引；业务里另有重复检查。若两次请求同时通过检查，最后靠什么阻止冲突，需要继续看数据库约束、事务与并发实验，不能只凭“代码查过重复”就收尾。

这不是要你马上重构模型。先把“数据库已经保证的”“Java 代码在检查的”“还没验证的”分成三栏，后面的 CRUD 阅读会清楚很多。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：画出六个对象之间的关系，并给每条线标出实际字段。

先用 user、license、port_mapping、port_pool / port_group、domain_port_mapping、security_group 画关系。每条线旁边写明字段，再找对应 Service 的检查位置；不要把推断出来的线自动画成数据库外键。

已有[本地集成实验](/labs/project-overview-result.json)确实创建过独立 License、端口池和两条映射，并验证正常目标与不可达目标可以同时存在。这个实验使用临时 H2；本篇 MySQL DDL 的索引和约束分析来自源码核对，没有声称已在真实 MySQL 上完成并发约束验证。

做完以后，试着用一句话解释：删用户、删 License、删映射为什么会牵动不同范围的对象。

<span id="完善清单"></span>

## 合上代码前想一想

- **用户和 License 分别服务谁？** 前者是管理业务身份，后者参与客户端认证。
- **在线状态能替代目标健康检查吗？** 想想同一个客户端下面那条坏目标映射。
- **下一篇去哪儿？** [04.02](/learn/persistence-initialization/)把这些表接到 Java 查询上。
