# 桌面客户端样图生成记录

状态：Review  
最后更新：2026-10-15  
关联文档：[界面设计](client-app-ui.md)、[文档索引](../README.md)

## 来源与用途

用户选择的 Style ID 为 `airtable`，来源为本地 `awesome-design-md` / `VoltAgent/awesome-design-md`。使用内置 `image_gen` 工具生成，不使用 CLI 或外部 API 调用脚本。以下为本次实际使用的提示词；页面是设计概念图，数据全部虚构。

- [已连接主页](assets/client-app-connected.png)：按提示词 1 生成，再按提示词 2 修订中文标题与窗口图标。
- [首次连接配置](assets/client-app-connection-setup.png)：按提示词 3 生成。

最终 PNG 已复制到本项目 `docs/02-design/assets/`；原生成文件保留，未覆盖既有资源。图中没有真实 License、生产连接地址或实测性能数值。两张图用于评审布局和功能层级，不证明桌面功能已实现。

## 提示词 1：已连接主页初稿

```text
Use case: ui-mockup.
Create a high-fidelity, practical desktop application UI mockup for "Neutrino Proxy", a Windows and macOS local tunnel connection utility. One flat, straight-on application window, landscape approximately 1560 x 1080, very sharp readable Simplified Chinese text. This is a product design review image, not a photograph, poster or marketing landing page. Fill the frame with the full app window and a tiny neutral outer margin. No device mockup or perspective.
Approved visual reference is the local Airtable design system adapted for a small utility: white #ffffff main canvas; very light #f8fafc sidebar; dark ink #181d26 titles; #333840 body; #41454d secondary text; thin #dddddd separators; #1b61c9 text links; success #006400; small cream #f5e9d4 information band. Ordinary system sans-serif Chinese typography, regular/medium weight, modest 6px input, 10px callout and 12px button corners. Crisp grid, open whitespace, restrained outlines and no heavy shadows. No gradients, purple, black dashboard, nested cards, or Airtable wordmark/logo.
Window chrome: thin Windows-style titlebar with exact title "Neutrino Proxy" at left and standard minimize, maximize, close controls only at right. Left sidebar about 17% width. Small product label "Neutrino Proxy" near top; three simple line-icon navigation items "连接", "日志", "设置"; "连接" is selected with a pale neutral rectangular highlight. Sidebar bottom shows a green dot and "已连接"; below it "设计预览".
Main pane has about 40px padding. Top row title "连接" at left and understated outlined button "编辑连接" at right.
Below, a clean open status area with small green outlined check icon, large text "已连接", subtext "服务器认证通过，连接正在运行". At right of this area put a white outline button labeled "断开连接". Under the status use a thin horizontal separator, not a card.
Next heading "连接信息". Under it show a tidy two-column definition grid with small labels above dark values, two rows: "服务器" / "edge.example.com"; "端口" / "9002"; "SSL" / "已启用"; "License" / "•••• •••• •••• 8F2A". Add a small separate line "本次连接  02:18:36". All values are fictitious illustrative data. Do not show bandwidth, latency, memory, charts or maps.
Next heading "最近事件" aligned with a blue text link "查看全部日志". Three rows with fine separators, left aligned time and middle concise exact Chinese message: "10:24:08" and "连接已建立"; "10:24:09" and "License 验证通过"; "10:24:09" and "开始后台运行". Use small green checks, not large colorful icon tiles.
Near the bottom use ONE full-width shallow cream information band with a simple information icon and exact text "关闭窗口后仍会保持连接，可从托盘重新打开". Keep readable ink text.
Very bottom right small annotation "概念样图 · 示例数据". Must not imply this is an actual running app screenshot.
All required text must be accurate, legible, unclipped and spaced cleanly. No extra menus, tabs, accounts, profile collections, port mapping controls, charts, performance claims or decorative illustration. Exactly one app window.
```

## 提示词 2：主页文字与窗口图标修订

以提示词 1 生成的初稿为编辑目标，保持原布局。

```text
Use case: text-localization / precise UI correction.
Edit the provided Neutrino Proxy desktop mockup. Keep the entire composition, window size, sidebar, status, fields, buttons, colors, typography, and all other text unchanged.
Correct the section heading directly below the first horizontal divider and above the server details. It must read EXACTLY "连接信息" in Simplified Chinese. The first character must be 连 (Unicode U+8FDE), not 適, 通, 遮, 遖 or any invented glyph. The four characters are 连 接 信 息. Render clean standard sans-serif glyphs at the existing heading size.
Remove the tiny headphone-shaped icon at the far left of the title bar so that the title bar begins with plain text "Neutrino Proxy", consistent with the other configuration screen. Preserve the existing title bar controls at the right.
Do not change any other text or UI element. Keep "概念样图 · 示例数据" visible in the bottom right. No new elements. This remains a flat high-fidelity UI mockup with opaque background.
```

## 提示词 3：首次连接配置

```text
Use case: ui-mockup.
Create a high-fidelity desktop application UI mockup for "Neutrino Proxy", a Windows and macOS local tunnel connection utility. Show the first connection configuration form with fictitious entered values, ready to save. One flat straight-on full desktop app window, landscape approximately 1560 x 1080, very sharp readable Simplified Chinese text, tiny neutral outer margin. No device, photograph, marketing page or perspective.
Use the approved local Airtable design system adapted for a small utility: white #ffffff main canvas; light #f8fafc sidebar; ink #181d26 heading and primary action; body #333840 and secondary #41454d; hairline #dddddd borders; #1b61c9 links; cream #f5e9d4 supporting note. Ordinary system sans-serif Chinese type, regular/medium weight. Inputs 6px corners, callout 10px, primary button 12px. Dense enough to fit the form but with generous clear spacing. No gradients, purple, heavy shadows, nested cards or Airtable branding.
Shell must be consistent with a companion connected-screen mockup: thin Windows-style titlebar exact "Neutrino Proxy" at left, minimize/maximize/close only at right. Sidebar 17% width with simple product label "Neutrino Proxy" and line-icon items "连接", "日志", "设置". Select "设置" with a pale neutral highlight. Sidebar bottom gray dot "未连接", then "设计预览".
Main pane title "配置连接" and short subtext "填写连接信息，或导入已有 app.yml". Top right outlined action "导入配置".
Below create a compact form, no wrapping all content in a big card:
First row two labeled inputs: "服务器地址" with entered "edge.example.com" taking about 70% of width, and "端口" with "9002" taking 30%.
Second row full width password-style field label "License", field contents "•••• •••• •••• 8F2A", eye icon right.
Next row a toggle ON in dark ink color, label "启用 SSL", helper text "需与服务器的 SSL 隧道端口一致".
Next label "信任证书". One select box with selected text "内置证书", downward chevron, and adjacent outlined button "选择文件". Below a compact explanatory line "使用自定义 JKS 时，将提示输入证书库密码". The password field is conditional and therefore not present in this built-in-certificate state.
Next a thin divider and collapsed disclosure row with right-pointing chevron "高级设置", below a short muted line "客户端 ID、重连间隔、心跳与 UDP 端口". Do not expose advanced implementation fields individually.
Use one shallow cream information band "配置保存在本机，端口映射仍在管理后台设置".
Bottom action row, aligned to the right: white outline button "保存" and ONE dark ink #181d26 filled button with white label "保存并连接". Buttons readable and aligned. No automatic-start checkboxes on this form.
Very bottom right small annotation "概念样图 · 示例数据".
All text exact, legible and unclipped. No actual credentials, no charts, memory or speed claims, no profile switching, no server-side controls, no extra primary actions. Exactly one app window.
```

## 目视检查与边界

- 已连接主页：检查连接状态、服务器、端口、SSL、掩码 License、断开操作和最近事件；修正初稿的“连接信息”字形，移除不一致的标题栏图标。
- 配置页：检查基础字段、SSL 开关、证书入口、高级折叠区及“保存 / 保存并连接”；内置证书状态下不显示证书库密码字段。
- 两张图：中文主要标签可读，无明显重叠或截断；白底、深色主操作、奶油色说明区和简洁导航保持一致；均明确标记“概念样图 · 示例数据”。
- 当前目视检查针对静态 PNG，不涵盖实际窗口缩放、键盘焦点、屏幕阅读器或可运行 UI 的交互验证。

