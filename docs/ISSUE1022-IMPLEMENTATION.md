# issue1022：原生右键菜单与每模型系统提示词

日期：2026-10-23。对应 [issue1022.md](../issues/issue1022.md)。沿用 Electron、React、TypeScript、CodeMirror 6、Zod、Vitest 和 Playwright，没有新增依赖。

## 1. 用户可以怎样使用

- 在正文、设置输入框或可选择的反馈文字上右键，可使用系统查询（Look Up）、剪切、复制、粘贴、粘贴并匹配样式、全选。菜单按当前位置和编辑权限显示或禁用操作；只读文字不会出现剪切、粘贴，密码框不提供查询。
- 在正文中右键一句话内的位置，或选中同一句中的内容后右键，可点击“定位到写作反馈”。右侧对应卡片滚动到可见区域，并短暂描边；侧栏折叠时自动展开。选区跨句时不显示此项。Markdown 标题、代码等没有反馈单元的内容也不提供入口。
- 定位也支持待分析、未完成及已忽略的句子，只做导航，不发起分析、不恢复已忽略的评价、不替换正文或主动修改选区。
- 在“写作设置”选定真实模型配置后，在 Model 下方填写“额外系统提示词”。每个配置独立保存，最多 6000 字符，可使用多行。例：“优先采用英式英语；解释简洁，侧重正式邮件中的语气。”
- 清空并保存即可恢复默认要求。切换配置或重启后仍保留各自内容；切换同一配置的 Provider 预设保留额外提示词。Mock 是固定规则演示，不执行系统提示词，因此不显示此输入框。

## 2. 原生菜单与定位流程

### 进程分工

新增 [electron/context-menu.ts](../electron/context-menu.ts)。主窗口及连接测试详情窗口都监听 Electron 的 `webContents` 原生 `context-menu` 事件，使用 `Menu.buildFromTemplate().popup()` 弹出系统菜单。

复制、剪切、粘贴、匹配样式粘贴和全选调用该窗口的 `webContents` 编辑方法；查询调用 macOS 的 `showDefinitionForSelection()`。这是系统字典入口，不是模型查询。操作权限来自 Chromium 的 `editFlags`，菜单构造不自行读写剪贴板。采用显式编辑方法，使 macOS 下的禁用状态也服从当前上下文。

接口依据：[Electron context-menu 教程](https://www.electronjs.org/docs/latest/tutorial/context-menu)、[webContents API](https://www.electronjs.org/docs/latest/api/web-contents)、[MenuItem API](https://www.electronjs.org/docs/latest/api/menu-item)。

### 正文位置到反馈卡片

1. 主进程保留本次菜单的原生参数，为它分配一次性 UUID，将点击位置发给受信任的主窗口。Electron 的位置按当前窗口缩放比例换算为 DOM 使用的 CSS 像素。
2. [WritingEditor.tsx](../src/editor/WritingEditor.tsx) 用 `elementFromPoint` 确认命中正文，再通过 CodeMirror `posAtCoords` 取得原始 UTF-16 偏移。右键位于现有选区内时使用整个选区；否则使用右键位置，不使用另一处残留选区。选择范围首尾空白不会影响单句判断。
3. [sentences.ts](../src/core/sentences.ts) 的 `singleSentenceAtRange()` 仅接受完全落入一个现有反馈单元的范围。沿用现有分句结果，因此缩写、邮件开头、Markdown 排除区间与审议逻辑保持一致，没有另建一套分句器。
4. [App.tsx](../src/App.tsx) 返回对应句子 ID。主进程只接收当前菜单 UUID 的响应，再按需追加“定位到写作反馈”。IPC 延用发送窗口、主 frame、受信 URL 和 Zod 参数校验，不开放任意菜单执行接口。
5. 点击定位项后，App 再检查句子是否存在，展开侧栏；通过卡片的 `data-sentence-id` 找到目标并滚动到中央，描边保留约 2.2 秒。不让卡片抢走编辑焦点，也不调用分析或修改正文接口。

详情窗口没有 preload，直接显示通用原生菜单。主窗口若在 500 毫秒内未返回定位目标，仍显示通用编辑菜单；过期响应不会再次弹出菜单，窗口关闭会清理待执行回调。

主要入口：[main.ts](../electron/main.ts)、[preload.ts](../electron/preload.ts)、[schema.ts](../src/models/schema.ts)、[FeedbackCard.tsx](../src/components/FeedbackCard.tsx)。

## 3. 每模型额外系统提示词

### 配置与兼容

[ProfileSchema](../src/models/schema.ts) 新增 `extraSystemPrompt: string`，长度上限 6000，默认空字符串。旧 `settings.json` 缺少该字段时，Zod 自动补默认值，不将旧配置判为损坏，也不重置端点、密钥或模型选择。

[SettingsDialog.tsx](../src/components/SettingsDialog.tsx) 将文本绑定到当前配置的 draft。切换左侧配置、添加配置、保存与重启均使用原有配置存储链路；测试连接使用当前页面尚未保存的输入。

提示词作为普通设置写入现有 `settings.json`，不是密钥字段。未新增提示词日志、外部存储或网络端点。

### 模型请求

[provider.ts](../electron/llm/provider.ts) 的 `systemPrompt(request, extraSystemPrompt)` 保留原有内置要求，再追加非空的用户提示词，统一放入同一条 `role: system` 消息。空白内容不追加任何段落，不改变原有请求。

下列路径均使用该配置的提示词：

| 路径 | 处理方式 |
| --- | --- |
| 连接测试 | 固定测试句走同一 `analyze` 方法，采用当前页面配置 |
| 单句、选中内容分析 | 每个请求按所选 profile 构造系统消息 |
| 手动全文分析 | 追加提示词，同时保留篇章分析的范围限制 |
| 格式降级、瞬态重试、格式修复 | 复用包含额外提示词的消息 |
| 独立复核 | 重建消息时仍传入同一配置的额外提示词 |

额外要求可调整英语习惯、语气或解释偏好；结构化反馈协议、中文说明和单句/篇章范围仍保留，输出继续经过原有校验。没有增加针对具体单词或句子的拦截规则。

现有 Provider 缓存键包含完整 profile，现有 `analysisChanged` 比较也包含这个新字段。因此修改当前模型提示词后，旧请求与旧分析配置失效，后续评估采用新提示词；修改非当前模型的提示词不干扰当前分析。自动分析处于暂停状态时，保存设置不会将它开启。邻句文本变化的手动重评策略未改动。

## 4. 验证与审阅

- 单元测试覆盖旧配置迁移、多配置独立存储、类型和长度校验；默认、追加及清空提示词；连接测试、篇章分析、格式降级/修复和独立复核的消息内容。
- 定位逻辑覆盖句尾光标、未完成句、跨句选区、Markdown 排除及原始偏移。原生菜单生命周期覆盖缩放、500 毫秒降级、迟到/过期响应、关闭窗口和密码框权限。
- Electron 界面测试覆盖正文、只读反馈、设置字段和密码框右键；真实系统菜单弹出/关闭；全选后编辑；选区保留、折叠展开、忽略句定位、跨句隐藏、放大后定位；每模型提示词切换、持久化、重启和实际 HTTP 请求内容。
- 自动化中复制、剪切、粘贴和系统字典动作在方法入口记录调用，避免覆盖用户剪贴板或打开系统字典；另有测试实际弹出和关闭 macOS 原生菜单。没有声称自动化完成了系统字典内容或所有剪贴板格式的人工验收。
- 所有界面和网络测试使用隔离用户目录、Mock 或本地临时 HTTP 服务，不修改用户现有 Ollama 配置和作文。

最终命令、通过数量及打包记录见 [VALIDATION.md](VALIDATION.md)。
