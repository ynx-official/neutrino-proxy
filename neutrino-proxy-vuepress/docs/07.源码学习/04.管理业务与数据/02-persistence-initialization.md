---
title: "04.02 数据源 Mapper 与数据库初始化"
date: 2026-10-30
permalink: /learn/persistence-initialization/
article: false
status: Review
updated: 2026-10-30
lesson: "04.02"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java"
    symbol: "dataSource"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java"
    symbol: "initDBStructure"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/dal/PortMappingMapper.java"
    symbol: "findByPort"
  - path: "neutrino-proxy-server/src/main/resources/mapper/PortMappingMapper.xml"
    symbol: "<mapper"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java"
    startLine: 46
    endLine: 52
  - path: "neutrino-proxy-server/src/main/resources/mapper/PortMappingMapper.xml"
    startLine: 5
    endLine: 11
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java"
    startLine: 85
    endLine: 96
---

# 04.02 数据源 Mapper 与数据库初始化

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

表关系理顺了，接下来找“Java 到底怎么摸到它们”。这条线里同时出现 MyBatis-Plus、XML Mapper、HikariCP 和 Wood。先别担心组件太多，我们让它们各回答一个具体问题：连接谁来给，查询谁来发，第一次建表又是谁做？

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

应用第二次启动时，初始化代码会重新插入全部演示数据吗？表已经存在，就能证明数据库升级也处理好了吗？

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / DbConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java) | `dataSource` |
| [server / DBInitialize.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java) | `initDBStructure` |
| [server / PortMappingMapper.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/dal/PortMappingMapper.java) | `findByPort` |
| [server / PortMappingMapper.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/resources/mapper/PortMappingMapper.xml) | `<mapper` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先拿到数据库连接这件工具

看这段 [DbConfiguration.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DbConfiguration.java#L46-L52)（原文件 46～52 行，连续原样节选）：

```java
    private HikariDataSource newHikariDataSource(DbConfig dbConfig, String driverClass) {
        HikariDataSource dataSource = new HikariDataSource();
        dataSource.setDriverClassName(driverClass);
        dataSource.setJdbcUrl(dbConfig.getUrl());
        dataSource.setMinimumIdle(5);
        dataSource.setMaximumPoolSize(20);
        dataSource.setMaxLifetime(60000);
```

数据源把连接 URL、驱动和池配置组合起来。最小空闲数 5、最大池大小 20、最大生命周期 60000，是当前这一段代码的配置值，跟 Netty 的工作线程数量不是同一类资源。

池里的连接用来与数据库交互，不是一个访问者对应一条永久占用的 JDBC 连接。你可以把网络并发数、业务请求并发数、数据库池容量分开记录，再讨论它们互相等待时的表现。

### Mapper 接口与 XML 要对着看

看这段 [PortMappingMapper.xml](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/resources/mapper/PortMappingMapper.xml#L5-L11)（原文件 5～11 行，连续原样节选）：

```xml
    <select id="selectPortMappingByCondition" resultType="org.dromara.neutrinoproxy.server.dal.entity.PortMappingDO">
        SELECT pm.* from port_mapping  pm left join license on pm.license_id = license.`id`
        <where>
            <if test="req.userId != null">
                AND license.user_id = #{req.userId}
            </if>
            <if test="req.licenseId != null">
```

XML 用 namespace 对应 Mapper，select id 对应具体查询。这里能看到 port_mapping 与 license 的关联，再根据请求条件拼接 where。

MyBatis-Plus 给了不少常用 CRUD 与条件构造能力，XML 仍然可以承载项目需要的自定义 SQL。阅读时不用先决定“到底该用哪一派”；先沿当前方法追到真正执行的 SQL，弄清查询范围、连接条件和分页在哪里做。

占位参数也要和输入来源一起看。你想确认的是“谁控制这个条件”“是否限定当前用户”，而不仅是 SQL 能不能执行成功。权限问题我们接着在下一篇聊。

### 首次初始化有自己的规则

看这段 [DBInitialize.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/db/DBInitialize.java#L85-L96)（原文件 85～96 行，连续原样节选）：

```java
	private void initDBData() throws Exception {
		if (CollectionUtil.isEmpty(initDataTableNameList)) {
			return;
		}
		for (String tableName : initDataTableNameList) {
			// 表里没有数据的时候，才进行初始化操作

			Object result = dbContext.exe(String.format("select count(1) from `%s`", tableName));
			if (result != null && ((Number) result).intValue() > 0) {
				continue;
			}
			List<String> lines = FileUtil.readContentAsStringList(String.format("classpath:/sql/%s/%s.data.sql", dbConfig.getType(), tableName));
```

这里先查表的记录数；已有数据就跳过该表的初始数据脚本。它不是每次启动都无条件重灌演示数据。

但这个规则也有边界：只要表里已有数据，就会跳过整张表的初始插入。它不等于“每条种子数据都被逐项补齐”，更不等于版本升级时自动迁移任意字段。遇到缺数据或旧结构问题，先区分自己处在哪个场景。

建表部分会读取当前数据库类型对应的结构文件；执行 SQL 用到 Wood 的 DbContext。正常业务 Mapper 与初始化工具各司其职，看到两套 Db 注解时记得看 import。

### 初始化 升级 与查询测试分开记

初始化回答“空环境怎样开始”，升级回答“已有环境怎样演进”，查询测试回答“这条业务行为在真实数据上怎样表现”。

同一份 SQL 文件存在于仓库里，不能替这三个问题同时作答。还有一个很实际的细节：初始化器按行拼接 SQL，再以行尾分号决定执行。读到这里，就应该知道它不是随便什么复杂脚本都能完整理解的通用解析器。

做实验时先用临时 H2，最容易保护已有数据。到了 MySQL 方言、约束和并发，再在明确的测试 MySQL 环境验证，别让一个方便的起点替代全部结论。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：把一次列表查询和一次空库初始化各画成一条短链。

查询线写成 Controller → Service → Mapper 方法 → XML / 条件构造 → 数据源。初始化线则从 DBInitialize.init 分别追到结构文件与初始数据文件。

已有[本地实验](/labs/project-overview-result.json)从新建临时 H2 启动过真实服务端。若自己验证重复启动，请只使用可丢弃目录：先记录初始数据数量，插入一条独立测试记录，再在同一测试目录启动一次，对照源码中的 count 分支。

后一个“同目录第二次启动”是这里提供的练习步骤，当前报告每轮使用新目录，没有把它作为已执行场景。记录时要把这两者分开。

<span id="完善清单"></span>

## 合上代码前想一想

- **Hikari 的 20 跟 Netty 的线程数是同一个并发上限吗？** 它们管理不同资源。
- **有数据就跳过整表，能保证种子数据逐项完整吗？** 按实际分支想一想。
- **接下来追什么？** [04.03](/learn/login-authorization/)看看数据访问背后的身份与权限。
