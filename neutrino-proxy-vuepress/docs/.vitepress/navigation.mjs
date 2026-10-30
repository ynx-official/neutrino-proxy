// Native VitePress navigation: edit text, link and items directly when adding an article.

const docs = [
  { text: "安装部署", collapsed: false, items: [
    {"text":"快速上手","link":"/pages/793dcb/"},
    {"text":"通过宝塔面板部署","link":"/pages/9e0fde/"},
    {"text":"使用jar部署","link":"/pages/eebea1/"},
    {"text":"使用docker容器化部署","link":"/pages/5b9bef/"},
    {"text":"原生部署","link":"/pages/69699a/"},
    {"text":"使用docker-compose部署","link":"/pages/2d4123/"}
  ] },
  { text: "使用须知", collapsed: false, items: [
    {"text":"后台操作指南","link":"/pages/793dcc/"},
    {"text":"关于端口","link":"/pages/68badb/"},
    {"text":"域名映射","link":"/pages/269a2e/"},
    {"text":"HTTPS配置","link":"/pages/99a300/"},
    {"text":"服务端配置","link":"/pages/f2d0f1/"},
    {"text":"客户端配置","link":"/pages/50ce10/"}
  ] },
  { text: "常见问题", collapsed: false, items: [
    {"text":"客户端连接服务端失败","link":"/pages/31d253/"},
    {"text":"易混淆的2类证书","link":"/pages/e4c3d7/"},
    {"text":"udp代理无效","link":"/pages/7b990f/"},
    {"text":"Vue项目出现Invalid Host header 的解决方案","link":"/pages/441163/"},
    {"text":"服务端原声包启动，db初始化异常","link":"/pages/7dcba8/"}
  ] }
]

const history = [
  { text: "历史站点资料", collapsed: false, items: [
    {"text":"主题配置","link":"/pages/a20ce8/"},
    {"text":"首页配置","link":"/pages/f14bdb/"},
    {"text":"front matter配置","link":"/pages/3216b0/"},
    {"text":"目录页配置","link":"/pages/54651a/"},
    {"text":"添加摘要","link":"/pages/1cc523/"},
    {"text":"修改主题颜色和样式","link":"/pages/f51918/"},
    {"text":"评论栏","link":"/pages/ce175c/"}
  ] }
]

const support = [
  { text: "个人赞赏", collapsed: false, items: [
    {"text":"个人赞赏","link":"/pages/1ab20b/"}
  ] },
  { text: "贡献指南", collapsed: false, items: [
    {"text":"如何贡献","link":"/pages/a3f096/"},
    {"text":"项目结构","link":"/pages/2f674a/"},
    {"text":"实现原理","link":"/pages/dd027d/"}
  ] },
  { text: "赞赏公示", collapsed: false, items: [
    {"text":"2024年","link":"/pages/acdf0a/"},
    {"text":"2023年","link":"/pages/cded59/"}
  ] },
  {"text":"支持这个项目","link":"/pages/1b12ed/"}
]

const examples = [
  { text: "用户使用案例", collapsed: false, items: [
    {"text":"企业登记案例","link":"/pages/5d571c/"}
  ] }
]

const releases = [
  { text: "版本记录", collapsed: false, items: [
    {"text":"2.x","link":"/pages/ff3519/"},
    {"text":"1.x","link":"/pages/dda8e5/"}
  ] },
  {"text":"里程碑","link":"/pages/e406dd/"}
]

const learning = [
  { text: "源码学习", collapsed: false, items: [
    {"text":"源码学习目录与学习路线","link":"/learn/"},
    {"text":"文章写作与源码引用规范","link":"/learn/authoring/"}
  ] },
  { text: "项目导读", collapsed: false, items: [
    {"text":"01.01 项目全景与内网穿透边界","link":"/learn/project-overview/"},
    {"text":"01.02 技术栈与依赖地图","link":"/learn/technology-stack/"},
    {"text":"01.03 本地调试与第一条 TCP 映射","link":"/learn/local-debugging/"},
    {"text":"01.04 调用链阅读与断点记录方法","link":"/learn/source-reading-method/"}
  ] },
  { text: "Java与Maven", collapsed: false, items: [
    {"text":"02.01 接口 泛型 注解与消息分发","link":"/learn/java-abstractions/"},
    {"text":"02.02 并发容器 可见性与复合操作","link":"/learn/java-concurrency/"},
    {"text":"02.03 字节 编码 异常与资源所有权","link":"/learn/java-bytes-resources/"},
    {"text":"02.04 Maven 多模块 依赖与构建阶段","link":"/learn/maven-modules/"}
  ] },
  { text: "Solon启动与API", collapsed: false, items: [
    {"text":"03.01 从 main 到应用加载完成","link":"/learn/solon-startup/"},
    {"text":"03.02 配置绑定 依赖注入与 Bean 组装","link":"/learn/solon-injection/"},
    {"text":"03.03 HTTP 路由 参数与响应包装","link":"/learn/solon-http-api/"},
    {"text":"03.04 登录上下文 拦截器与清理边界","link":"/learn/solon-request-context/"}
  ] },
  { text: "管理业务与数据", collapsed: false, items: [
    {"text":"04.01 用户 License 与映射数据模型","link":"/learn/database-model/"},
    {"text":"04.02 数据源 Mapper 与数据库初始化","link":"/learn/persistence-initialization/"},
    {"text":"04.03 登录 Token 与资源权限","link":"/learn/login-authorization/"},
    {"text":"04.04 License 与端口池业务规则","link":"/learn/license-port-pool/"},
    {"text":"04.05 端口映射 CRUD 完整纵向切片","link":"/learn/port-mapping-crud/"},
    {"text":"04.06 配置动态生效与运行状态一致性","link":"/learn/runtime-consistency/"}
  ] },
  { text: "Netty基础", collapsed: false, items: [
    {"text":"05.01 NIO Reactor 与 EventLoop 线程模型","link":"/learn/netty-reactor/"},
    {"text":"05.02 Bootstrap Channel 与异步 Future","link":"/learn/netty-bootstrap/"},
    {"text":"05.03 Pipeline 入站 出站与 Handler 生命周期","link":"/learn/netty-pipeline/"},
    {"text":"05.04 ByteBuf 引用计数与释放责任","link":"/learn/netty-bytebuf/"},
    {"text":"05.05 写缓冲水位与 AUTO_READ 背压","link":"/learn/netty-backpressure/"}
  ] },
  { text: "协议与分发", collapsed: false, items: [
    {"text":"06.01 ProxyMessage 帧结构与消息类型","link":"/learn/protocol-frame/"},
    {"text":"06.02 编码器如何计算长度并写入字段","link":"/learn/protocol-encoder/"},
    {"text":"06.03 长度字段拆包与增量解码","link":"/learn/protocol-decoder/"},
    {"text":"06.04 从消息类型到 Handler 的分发","link":"/learn/protocol-dispatcher/"},
    {"text":"06.05 协议边界与跨语言测试向量","link":"/learn/protocol-boundary-tests/"}
  ] },
  { text: "服务端TCP链路", collapsed: false, items: [
    {"text":"07.01 隧道监听与控制数据连接入口","link":"/learn/server-tunnel/"},
    {"text":"07.02 License 认证与客户端绑定","link":"/learn/server-authentication/"},
    {"text":"07.03 映射监听与访问者连接管理","link":"/learn/server-listeners/"},
    {"text":"07.04 VisitorId 与数据通道绑定","link":"/learn/server-connect-binding/"},
    {"text":"07.05 请求响应的双向数据转发","link":"/learn/server-transfer/"},
    {"text":"07.06 断开 异常与连接关系清理","link":"/learn/server-disconnection/"}
  ] },
  { text: "Java客户端设计", collapsed: false, items: [
    {"text":"08.01 启动参数 配置优先级与 ClientId","link":"/learn/client-configuration/"},
    {"text":"08.02 控制会话与认证结果处理","link":"/learn/client-session/"},
    {"text":"08.03 内网目标连接与异步绑定","link":"/learn/client-target-connection/"},
    {"text":"08.04 TCP 转发与多访问者隔离","link":"/learn/client-forwarding/"},
    {"text":"08.05 读写空闲 心跳与超时语义","link":"/learn/client-heartbeat/"},
    {"text":"08.06 定时重连 可见性与并发边界","link":"/learn/client-reconnection/"},
    {"text":"08.07 通道池 连接关闭与资源所有权","link":"/learn/client-pool-cleanup/"},
    {"text":"08.08 从现有回调整理客户端状态机","link":"/learn/client-state-machine/"}
  ] },
  { text: "UDP与HTTP安全", collapsed: false, items: [
    {"text":"09.01 UDP 封装 会话隔离与回包路径","link":"/learn/udp-forwarding/"},
    {"text":"09.02 UDP 端口分配 响应次数与超时","link":"/learn/udp-lifecycle/"},
    {"text":"09.03 HTTP 域名选择与首包转发","link":"/learn/http-domain-routing/"},
    {"text":"09.04 HTTPS 与隧道 TLS 的不同边界","link":"/learn/tls-boundaries/"},
    {"text":"09.05 安全组 访问规则与流量限制","link":"/learn/security-rate-limiting/"}
  ] },
  { text: "测试与稳定性", collapsed: false, items: [
    {"text":"10.01 单元 集成与真实网络测试分层","link":"/learn/testing-strategy/"},
    {"text":"10.02 连接故障矩阵与恢复验证","link":"/learn/fault-matrix/"},
    {"text":"10.03 慢消费者 大文件与并发压力","link":"/learn/slow-consumer-load/"},
    {"text":"10.04 线程 Channel 与内存排障","link":"/learn/resource-diagnostics/"},
    {"text":"10.05 流量计数 定时汇总与数据清理","link":"/learn/flow-jobs/"}
  ] },
  { text: "构建与交付", collapsed: false, items: [
    {"text":"11.01 多模块构建 胖 JAR 与启动验证","link":"/learn/jar-build/"},
    {"text":"11.02 Solon AOT 与 Native Image 元数据","link":"/learn/native-aot/"},
    {"text":"11.03 glibc musl 与跨平台兼容边界","link":"/learn/native-platforms/"},
    {"text":"11.04 CI 产物完整性 哈希与发布规则","link":"/learn/release-integrity/"}
  ] },
  { text: "桌面客户端进阶", collapsed: false, items: [
    {"text":"12.01 Java 与 Rust 的协议兼容","link":"/learn/desktop-protocol/"},
    {"text":"12.02 Netty 到 Tokio 的异步内核映射","link":"/learn/desktop-async-core/"},
    {"text":"12.03 通信内核 Tauri 与 Vue 的职责边界","link":"/learn/desktop-host-ui/"},
    {"text":"12.04 配置导入 凭证存储与诊断日志","link":"/learn/desktop-storage/"}
  ] }
]

export const nav = [
  {
    "text": "首页",
    "link": "/"
  },
  {
    "text": "文档",
    "activeMatch": "^/?(?:pages/793dcb/|pages/9e0fde/|pages/eebea1/|pages/5b9bef/|pages/69699a/|pages/2d4123/|pages/793dcc/|pages/68badb/|pages/269a2e/|pages/99a300/|pages/f2d0f1/|pages/50ce10/|pages/31d253/|pages/e4c3d7/|pages/7b990f/|pages/441163/|pages/7dcba8/|pages/a20ce8/|pages/f14bdb/|pages/3216b0/|pages/54651a/|pages/1cc523/|pages/f51918/|pages/ce175c/)",
    "items": [
      {
        "text": "安装部署",
        "link": "/pages/793dcb/"
      },
      {
        "text": "使用须知",
        "link": "/pages/793dcc/"
      },
      {
        "text": "常见问题",
        "link": "/pages/31d253/"
      }
    ]
  },
  {
    "text": "源码学习",
    "link": "/learn/",
    "activeMatch": "^/?learn/"
  },
  {
    "text": "案例",
    "link": "/pages/5d571c/",
    "activeMatch": "^/?(?:pages/5d571c/)"
  },
  {
    "text": "支持",
    "activeMatch": "^/?(?:pages/1ab20b/|pages/a3f096/|pages/2f674a/|pages/dd027d/|pages/acdf0a/|pages/cded59/|pages/1b12ed/)",
    "items": [
      {
        "text": "贡献指南",
        "link": "/pages/a3f096/"
      },
      {
        "text": "个人赞赏",
        "link": "/pages/1ab20b/"
      },
      {
        "text": "赞赏公示",
        "link": "/pages/acdf0a/"
      }
    ]
  },
  {
    "text": "更新记录",
    "activeMatch": "^/?(?:pages/ff3519/|pages/dda8e5/|pages/e406dd/)",
    "items": [
      {
        "text": "2.x 版本",
        "link": "/pages/ff3519/"
      },
      {
        "text": "1.x 版本",
        "link": "/pages/dda8e5/"
      },
      {
        "text": "里程碑",
        "link": "/pages/e406dd/"
      }
    ]
  }
]

export const sidebar = {
  "/pages/793dcb/": docs,
  "/pages/9e0fde/": docs,
  "/pages/eebea1/": docs,
  "/pages/5b9bef/": docs,
  "/pages/69699a/": docs,
  "/pages/2d4123/": docs,
  "/pages/793dcc/": docs,
  "/pages/68badb/": docs,
  "/pages/269a2e/": docs,
  "/pages/99a300/": docs,
  "/pages/f2d0f1/": docs,
  "/pages/50ce10/": docs,
  "/pages/31d253/": docs,
  "/pages/e4c3d7/": docs,
  "/pages/7b990f/": docs,
  "/pages/441163/": docs,
  "/pages/7dcba8/": docs,
  "/learn/": learning,
  "/pages/a20ce8/": history,
  "/pages/f14bdb/": history,
  "/pages/3216b0/": history,
  "/pages/54651a/": history,
  "/pages/1cc523/": history,
  "/pages/f51918/": history,
  "/pages/ce175c/": history,
  "/pages/1ab20b/": support,
  "/pages/a3f096/": support,
  "/pages/2f674a/": support,
  "/pages/dd027d/": support,
  "/pages/acdf0a/": support,
  "/pages/cded59/": support,
  "/pages/1b12ed/": support,
  "/pages/5d571c/": examples,
  "/pages/ff3519/": releases,
  "/pages/dda8e5/": releases,
  "/pages/e406dd/": releases,
}
