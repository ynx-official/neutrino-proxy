---
title: "04.03 登录 Token 与资源权限"
date: 2026-10-30
permalink: /learn/login-authorization/
article: false
status: Review
updated: 2026-10-30
lesson: "04.03"
track: java
sourceBaseline: 94cafdd1f36e1f64b316e10466a8f54912c75467
sourceReferences:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/UserService.java"
    symbol: "findByToken"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    symbol: "doIntercept"
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java"
    symbol: "updateEnableStatus"
sourceExcerpts:
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/UserService.java"
    startLine: 114
    endLine: 120
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java"
    startLine: 55
    endLine: 60
  - path: "neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java"
    startLine: 148
    endLine: 155
---

# 04.03 登录 Token 与资源权限

状态：Review · 最后更新：2026-10-30

关联阅读：[学习目录](/learn/)、[源码引用怎么读](/learn/authoring/)

“这个接口要登录”听起来很明确，可真正读到业务代码时，通常还要多问两句：登录的是谁？他能操作哪一条数据？我们把 Token、管理员限制和对象归属分开走一遍。

<span id="本篇要解决的问题"></span>

## 先带着一个问题读下去

用户 A 已经登录，他拿到一个 License 的 id，就一定可以修改那条 License 下的映射吗？先把“已登录”和“有权操作这个对象”分别写下来。

<span id="项目源码入口"></span>

## 这次先打开哪几个文件

不用把下面的文件从头看到尾。先找到右边的入口，正文会带着你把它们连起来。Java 引用固定在本课程的源码基线，点击文件可看完整上下文。

| 文件 | 先找这里 |
| --- | --- |
| [server / UserService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/UserService.java) | `findByToken` |
| [server / BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java) | `doIntercept` |
| [server / PortMappingService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java) | `updateEnableStatus` |

<span id="正文提纲"></span>

## 一起顺着代码走

### 先拿 Token 找到用户

看这段 [UserService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/UserService.java#L114-L120)（原文件 114～120 行，连续原样节选）：

```java
	public UserDO findByToken(String token) {
		Date now = new Date();
		UserTokenDO userTokenDO = userTokenMapper.findByAvailableToken(token, now);
		if (null == userTokenDO) {
			return null;
		}
		return userMapper.findById(userTokenDO.getUserId());
```

服务端先找当前时间仍可用的 Token，再按它关联的 userId 找用户。Token 不是只要在请求头里有个字符串就算有效；可用性要经过 Mapper 查询条件。

拦截器读取的是 Authorize 这个现有头名，随后还会检查用户启用状态。通过之后才把用户和 Token 放进当前请求上下文，并延长 Token 的过期时间。

这个管理 Token 与客户端使用的 License 是两条认证线。别把管理登录返回的值直接填进客户端 License 配置，它们对应的校验入口和生命周期不同。

### 管理员限制是另一道判断

看这段 [BaseAuthInterceptor.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/base/rest/interceptor/BaseAuthInterceptor.java#L55-L60)（原文件 55～60 行，连续原样节选）：

```java
            if (null != authorization && authorization.onlyAdmin() && !userDO.getLoginName().equals("admin")) {
                throw ServiceException.create(ExceptionConstant.NO_PERMISSION_VISIT);
            }

            systemContext.setToken(authorize);
            systemContext.setUser(userDO);
```

当前实现的管理员判断与登录名 admin 相关。它不是一套看见角色表就能自然推导出来的通用 RBAC 系统，要按真实分支描述。

方法上的 Authorization 可以声明是否需要登录、是否只允许管理员。没有特定声明时，也要回到拦截器看默认行为，而不是凭 Controller 上没注解就认定公开。

### 对象归属 还要继续进 Service 看

看这段 [PortMappingService.java](https://github.com/ynx-official/neutrino-proxy/blob/94cafdd1f36e1f64b316e10466a8f54912c75467/neutrino-proxy-server/src/main/java/org/dromara/neutrinoproxy/server/service/PortMappingService.java#L148-L155)（原文件 148～155 行，连续原样节选）：

```java
    public PortMappingCreateRes create(PortMappingCreateReq req) {
        LicenseDO licenseDO = licenseMapper.findById(req.getLicenseId());
        ParamCheckUtil.checkNotNull(licenseDO, ExceptionConstant.LICENSE_NOT_EXIST);
        if (!SystemContextHolder.isAdmin()) {
            // 临时处理，如果当前用户不是管理员，则操作userId不能为1
            ParamCheckUtil.checkExpression(!licenseDO.getUserId().equals(1), ExceptionConstant.NO_PERMISSION_VISIT);
        }
        PortPoolDO portPoolDO = portPoolMapper.findByPort(req.getServerPort());
```

这段很值得慢一点读。对于非管理员，它限制的是 License 的 userId 不能为 1。这个条件本身没有比较“当前登录用户 id 是否等于这个 License 的 owner”。

所以，不要把它讲成“当前用户只能操作自己的 License”。我们能确认的是这条分支实际做了什么；完整的数据权限，还需要逐接口、逐对象继续核对其他检查。讲代码时把这两句话分开，读者才不会学到一个并不存在的保证。

本篇不修改权限逻辑，也不把一次成功的管理员实验当作多用户权限完整性的证据。

### 用一个小矩阵把问题问完整

| 身份与对象 | 需要核对什么 |
| --- | --- |
| 未登录 | 是否被认证入口拦住 |
| 普通用户与自己的对象 | 业务规则是否允许 |
| 普通用户与另一个测试用户的对象 | 哪个分支限定归属，是否真的比较当前身份 |
| 普通用户与管理员专用操作 | 方法级管理员限制是否生效 |
| 被禁用用户或过期 Token | 原有身份是否仍被接受 |

这个矩阵可以跟着 Controller 方法逐行填写。你会比只看前端菜单多发现不少东西：菜单可以帮助交互，真正的操作边界得由后端请求路径守住。

<span id="动手实验与验收"></span>

## 动手试一小步

**动手试试**：只用临时测试用户，把一个操作的身份与对象矩阵列全。

先选端口映射创建或详情接口，记录 Controller 的 Authorization 声明、拦截器默认逻辑，以及 Service 的对象检查。每个“允许 / 拒绝”都先写出依据，不确定就标待验证。

要实际发请求时，使用独立本地 H2 和虚构用户，不操作真实账号或真实对象。[已有实验](/labs/project-overview-result.json)验证过临时管理员创建配置的成功路径，没有覆盖完整多用户权限矩阵。

这次练习的收获应该是一张带代码位置、实际结果和未验证项的表，而不是一句“后端已经做了鉴权”。

<span id="完善清单"></span>

## 合上代码前想一想

- **Token 有效能直接证明对象归属合法吗？** 两条条件要分别核对。
- **这段非管理员检查能直接等价于 owner == 当前用户吗？** 把实际比较的两边写出来看。
- **再往下读？** [04.04](/learn/license-port-pool/)接着看 License 与可使用端口的业务关系。
