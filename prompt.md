# TOEFL Writing Assistant — AI 编程开发任务书

## 0. 你的角色与交付要求

你是一名资深 Electron/macOS 桌面应用工程师、交互设计师和 LLM 应用工程师。请**直接实现一个可运行的完整项目**，而不只是给出架构建议或代码片段。项目名称为 **TOEFL Writing Assistant**，用于用户自主完成 TOEFL 英语写作，并在不打断输入的情况下收到实时、可解释的中文反馈。

**最重要的产品原则：**
1. **写作优先、反馈次之**：用户可以持续输入；任何分析、网络请求、结果刷新都不能抢夺编辑器焦点、移动光标、阻塞输入或自动替换正文。
2. **只在有必要时建议修改**：正确、自然且符合上下文的句子明确标记为“表达良好 / 无需修改”，不得为了显示 AI 能力而强行润色。
3. **所有面向用户的修改解释必须使用中文**；原句和推荐英文表达保持英文。
4. **Electron 为桌面应用框架，HTML/CSS/TypeScript（或 JavaScript）为主要 UI 技术**。采用 Electron 主进程 + preload + renderer 的分层结构；编辑器、交互、状态管理和 LLM 请求编排可由 TypeScript 实现。首版不使用 Python 后端；全部应用逻辑由 Electron/Node.js/TypeScript 实现，避免不必要的跨语言进程通信。
5. **首先交付 Electron 源码运行版本**，不进行 `.app`、DMG、PyInstaller 等打包；提供可在 Apple Silicon Mac 上安装的 Conda `environment.yml` 和启动脚本。
6. 不能把 API Key 硬编码到代码、日志、示例配置或提交记录中。

## 1. 技术栈与架构

- **Electron + Node.js 22 + TypeScript + HTML/CSS + Vite + React** 构建 renderer；界面应符合 macOS 审美。允许使用 JavaScript，但推荐 TypeScript 以提高可维护性。
- Markdown 主编辑器：优先 **CodeMirror 6**（支持 Markdown 语法高亮、撤销栈、光标与选区管理、增量文档变更）；可选 Markdown 预览。不要用普通 `contenteditable` 或 textarea 充当最终方案。建议采用编辑器插件/装饰实现问题标记，不能破坏输入体验。
- Electron 进程安全：`contextIsolation: true`、`nodeIntegration: false`、启用 sandbox（可行时），通过严格白名单的 `contextBridge` 暴露 IPC；禁止 renderer 直接访问 Node.js 文件系统、Keychain 或密钥。校验 IPC 参数，禁止任意 URL 导航和不可信页面执行。
- LLM 网络请求在 **Electron 主进程或独立受控服务**执行；使用 Node.js 原生 `fetch`，配合 AbortController 实现超时、取消、错误分类及必要的指数退避。绝不能在渲染线程同步阻塞；API Key 不能暴露给 renderer。
- 模型适配层采用统一 Provider 接口；首版支持 OpenAI-compatible Chat Completions：OpenAI、OpenRouter、Ollama、LM Studio、vLLM、llama.cpp server 以及自定义端点。支持 base URL、模型名、认证方式、可选 headers；不能假定全部模型支持 JSON Schema 模式。预留 Anthropic 和 Gemini 原生协议适配器。
- 配置存储：普通配置用 electron-store 或 JSON 文件；API Key 优先使用 macOS Keychain（例如 `@napi-rs/keyring` 或其他当前兼容方案），不得明文保存；支持环境变量供开发使用。对 macOS arm64 原生依赖安装和 Electron ABI 兼容进行验证。
- 本地文档保存为 `.md`；实现新建、打开、保存、另存为、自动草稿恢复，防止丢失内容。测试采用 Vitest（逻辑/组件）和 Playwright Electron（至少关键端到端流程，环境允许时）。
- **Conda 仍须提供**：`environment.yml` 在 macOS arm64 上创建开发环境（只需 Node.js 22 和必要的开发工具，无须 Python 依赖）；Node 包由 `npm ci` 根据 `package-lock.json` 安装。不要把 Electron/npm 依赖错误写为 pip 包。

建议目录结构（可合理调整）：

```text
toefl-writing-assistant/
├── package.json
├── package-lock.json
├── environment.yml
├── run.sh                         # conda 激活后启动 Electron 开发版
├── README.md
├── .gitignore
├── .env.example
├── electron/
│   ├── main.ts                    # 窗口、菜单、文件系统、LLM 请求
│   ├── preload.ts                 # 安全 IPC 白名单
│   ├── ipc/                       # 参数校验与处理器
│   ├── llm/                       # Provider、结构化响应与请求调度
│   └── storage/                   # 文件、设置、Keychain
├── src/
│   ├── App.tsx
│   ├── components/                # 编辑器、建议卡片、设置界面
│   ├── editor/                    # CodeMirror 配置与装饰
│   ├── core/                      # 句子识别、去抖、版本控制、上下文
│   ├── models/                    # TypeScript 类型与 Zod 校验
│   └── styles/                    # macOS 风格主题
└── tests/
```

## 2. 核心界面与 macOS 设计

主窗口采用左右双栏布局：
- **左侧（约 65%）**：Markdown 写作编辑器。顶部有文档名称、保存状态、写作模式、字数、计时器（可选）；正文为主要视觉焦点，提供合适行距、段间距、内边距、宽度和可读性优先的字体。
- **右侧（约 35%）**：AI Writing Feedback，按文本顺序展示建议卡片，显示状态：待分析、分析中、表达良好、建议修改、分析失败。每张卡片至少展示原句、问题类型、推荐表达、**中文原因**、建议强度、接受/忽略/查看详情按钮。
- 支持拖动分隔线调整宽度；右侧可折叠；折叠后仍正常分析，用户可自行选择暂停分析。
- 顶部工具栏尽量精简；设置窗口包含模型 Provider、Base URL、Model、API Key、Temperature（可选）、超时、触发延迟、自动分析开关、隐私提示、连接测试按钮。
- 采用 macOS 风格：浅色/深色模式跟随系统、柔和层次、克制圆角、精细边框、系统字体、恰当留白、清晰的 hover/focus/disabled 状态；不堆砌渐变、霓虹色和动画。动画轻量，不牺牲键盘输入响应。
- 常用快捷键：`⌘N` 新建、`⌘O` 打开、`⌘S` 保存、`⌘⇧S` 另存为、`⌘,` 设置、`⌘Z/⌘⇧Z` 撤销/重做。确保 macOS 原生菜单与快捷键正常。
- 可访问性：文本缩放、键盘导航、状态提示不依赖颜色、足够对比度。

## 3. 实时检测与无干扰分析机制（重点）

### 3.1 触发条件

满足以下任一条件后，自动对**新增或变化的句子**分析：
1. 用户输入英文句末标点 `.`, `?`, `!`，并形成完整句子；
2. 用户停止输入超过可配置的去抖时间（默认 **1200 ms**）；
3. 用户手动点击“分析选中内容”或“分析全文”。

细节要求：
- 区分句末句点与小数、缩写（如 `e.g.`, `Dr.`）、网址；不要把它们错误识别为完整句子。优先实现可测试的保守规则，后续可扩展成熟英文分句库。
- 用户短暂停顿但文本明显未完成时，允许跳过分析或返回 `incomplete`，不要误判为语法错误。
- Markdown 标题、列表符号、代码块、行内代码、URL 不应作为普通作文句子分析；保留原文的字符偏移。
- 每次编辑**只分析变化部分**，避免重复请求；句子完全未变且上下文未发生重要变化时使用缓存。
- 可以带上当前句子的前后文（如前 2 句、后 1 句、当前段落、写作任务描述），但不要把整篇作文无条件重复发送。

### 3.2 异步与结果一致性

- 输入线程不能被模型响应阻塞；显示轻量“分析中”状态即可。
- 为每次分析关联 `document_id`、`revision_id`、`sentence_id` / 内容哈希及原始文本范围。
- 用户在等待期间继续输入或修改旧句时：过期结果**不得**错误地贴到新句子上；可取消旧任务，或在返回后通过版本/文本核验丢弃。
- 控制并发（默认同时最多 2 个请求），避免每次按键都请求；加入短时请求合并、频率限制、指数退避（只对适合重试的错误）和缓存。
- 若模型不可用、限流、超时或断网，写作必须完全可用；侧边显示非阻断的中文错误及重试入口。
- 光标位置、滚动位置、选区、输入法组合态和撤销栈在反馈刷新时不得被破坏。
- 不自动弹出对话框，不自动把建议写入正文，不因为反馈到达而切换编辑焦点。

## 4. TOEFL 写作模式与反馈原则

至少提供以下模式：
1. **TOEFL Academic Discussion**：侧重立场清晰、回应题目、观点展开、逻辑连贯、用词自然、语法准确。
2. **TOEFL Email Writing**：侧重语气得体、信息完整、礼貌程度、表达清晰与准确。
3. **General English Writing**：通用英语写作，不强行套用考试评分标准。

允许用户在独立输入区提供题目/教授提问/其他学生观点或邮件情境；这些属于上下文，不混入正式作文字数。不同模式使用不同的系统提示词与检查维度。

反馈遵循：
- **准确性优先于华丽表达**：不要无依据地升级词汇，不要改变原意、事实、论证立场或语气。
- 语法正确且表达自然时，返回 `good`，并可给出一句简短中文肯定说明；不制造伪问题。
- 区分 `grammar`、`spelling`、`word_choice`、`collocation`、`clarity`、`conciseness`、`tone`、`coherence`、`task_relevance` 等问题类型。
- 明确区分**客观错误**与**可选风格优化**，不得把风格偏好表述为语法错误。
- 对每条建议给出中文原因；最好指出为什么原句不够好、推荐表达改善了什么。
- 句子级建议可利用上下文，但不应脱离段落语义机械改写；篇章级建议可由用户手动触发“分析全文”。
- 默认每句最多展示 1～3 条最高价值建议，避免侧栏信息过载。
- 可以展示“推荐表达”，但不应无条件提供过度复杂的高级版本。

## 5. LLM API 适配与配置

必须实现统一接口，例如：

```typescript
interface LLMProvider {
  analyze(request: AnalysisRequest, signal?: AbortSignal): Promise<AnalysisResult>;
  testConnection(): Promise<ConnectionTestResult>;
}
```

Provider 预设：

| Provider | Base URL 示例 | 认证 | 说明 |
|---|---|---|---|
| OpenAI | `https://api.openai.com/v1` | API Key | OpenAI-compatible 接口 |
| OpenRouter | `https://openrouter.ai/api/v1` | API Key | 支持用户指定模型 ID；可配置可选请求头 |
| Ollama | `http://127.0.0.1:11434/v1` | 通常无需密钥 | 本地 OpenAI-compatible 接口，兼容性需实测 |
| LM Studio | `http://127.0.0.1:1234/v1` | 通常无需密钥 | 本地服务器 |
| vLLM | 用户配置 | 视服务而定 | 自定义兼容端点 |
| llama.cpp server | 用户配置 | 视服务而定 | 自定义兼容端点 |
| Custom OpenAI-compatible | 用户配置 | 用户配置 | 通用兜底 |

- 上表是**默认示例**，实际端口、路径和模型可变，必须允许用户修改；不可将示例视为永久固定规范。
- 用户可新增、编辑、删除、切换多个模型配置，并选择默认模型。
- 模型列表可手动输入，不能强依赖自动拉取 `/models`；若实现自动获取，失败时仍可手动配置。
- 使用兼容性回退：优先请求结构化 JSON；如果端点不支持特定 `response_format`，回退为明确要求“仅输出 JSON”的文本模式，然后进行严格解析与验证。
- 对响应使用 Zod 校验；允许有限次数的修复/重试，但不能无限循环。
- 在设置页提供“测试连接”及明确中文错误信息（401、404、429、连接失败、模型不存在、JSON 不合法等）。
- 不上传 API Key；默认仅向用户选定的服务端发送必要的写作文本与上下文，设置页明确说明云端/本地端点的数据传输差异。
- 允许配置分析语言始终为中文（首版固定中文即可）。

## 6. 结构化请求与响应格式

使用 TypeScript 类型和 Zod Schema 定义数据模型。以下 JSON 仅为参考，可根据实际实现调整字段，但必须包含核心语义：

```json
{
  "sentence_id": "s-00012",
  "original_text": "I think online courses are quite efficiency and convenience.",
  "status": "needs_revision",
  "overall_explanation_zh": "句子观点清楚，但存在词性错误，且表达可以更自然。",
  "suggested_revision": "I think online courses are efficient and convenient.",
  "issues": [
    {
      "type": "grammar",
      "severity": "error",
      "original_span": "efficiency and convenience",
      "suggested_text": "efficient and convenient",
      "explanation_zh": "be 动词后描述课程特点应使用形容词，而不是名词。"
    }
  ],
  "confidence": 0.94
}
```

- `status` 至少支持 `good`、`needs_revision`、`incomplete`、`error`。
- `severity` 至少支持 `error`、`improvement`。
- `suggested_revision` 在 `good` 时应为 `null`，不可强行改写。
- `explanation_zh` 和 `overall_explanation_zh` 必须为中文；英文例句可以嵌入解释。
- 所有字符区间由**本地编辑器计算并维护**，不信任模型返回的偏移值；模型仅返回可核对的文本片段。
- 如果模型返回的 `original_text` 与实际请求不匹配，视为不可信结果并拒绝自动定位。
- 模型输出的 `confidence` 只是模型自报值，不作为准确率保证；UI 不应夸大其意义。

## 7. 建议卡片交互

- 卡片包含：状态、原句摘要、问题标签、推荐英文句、中文解释、可展开的细节。
- 默认仅展示最重要的建议；允许展开其余内容。
- **忽略**：隐藏该建议，且在句子未改变时不反复弹出。
- **接受修改**：必须由用户主动点击；执行前重新核对原句内容与位置；匹配失败时不修改并提示“原句已发生变化，请重新分析”。接受后尽量保留编辑器焦点与合理光标位置，并让该操作可以通过 `⌘Z` 撤销。
- 允许只复制推荐句，而不改动正文。
- 可选：在编辑器内以非侵入式下划线/边缘标记关联存在问题的句子；点击建议时轻量定位，但不自动抢焦点。
- 避免每个输入字符都重新创建整套 UI 控件；尽可能增量更新。

## 8. 文件、设置与运行

- 文件：新建、打开 `.md`、保存、另存为；正确处理 UTF-8、换行与未保存修改提示。
- 支持自动保存草稿或恢复未保存会话；明确区分草稿恢复和覆盖用户原始文件。
- 统计英文单词数；排除 Markdown 标记的影响（至少处理常见标记）。
- 设置：主题、字体大小、去抖时长、自动分析开关、默认 Provider/Model、API 参数；跨重启持久化。
- 提供可安装在 **macOS Apple Silicon** 的 `environment.yml`，使用 conda-forge 提供 Node.js 22；前端和 Electron 依赖全部由 npm 管理，不使用 pip。
- `run.sh` 能在已激活环境中运行；README 给出以下命令及故障排查：

```bash
conda env create -f environment.yml
conda activate toefl-writing-assistant
bash run.sh
```

- 提供 `npm run dev` 作为备用启动方式；`run.sh` 应在激活 Conda 环境后执行 `npm ci`（如依赖未安装）和 `npm run dev`。
- 不要进行打包、签名、公证或分发；保留 Electron/Node.js 源码、npm 脚本和 Bash 启动入口。

## 9. 质量与测试要求

至少实现以下自动化测试：
1. 句子边界识别：句号、问号、感叹号、缩写、小数、换行、Markdown 列表、代码块。
2. 去抖与重复请求：快速连续输入只触发合理数量的请求；句子不变不重复分析。
3. 版本一致性：编辑后过期的 AI 响应不得覆盖新句反馈；文档切换后旧结果不得污染新文档。
4. JSON 解析：合法、缺字段、类型错误、非 JSON、模型夹带 Markdown 代码块等情况。
5. Provider：使用 Mock fetch/HTTP 响应测试成功、超时、401、429、连接失败、结构化输出不兼容回退。
6. 修改建议：仅用户点击后修改；若原文已变化则拒绝修改；修改可撤销。
7. 无 Key/离线状态：编辑器正常使用，UI 不崩溃。

提供至少一个 **Mock LLM 模式**，无需任何 API Key 即可演示建议卡片、状态流转与错误处理；Mock 必须明确标识为演示，不可伪装成真实模型结果。

## 10. 开发顺序与验收标准

请按以下顺序执行，**不要停留在计划阶段**：

1. 建立项目目录、依赖、数据模型与 Provider 抽象。
2. 实现 Electron + React 双栏界面、CodeMirror 6 Markdown 编辑器、macOS 应用菜单、设置窗口和建议卡片。
3. 实现句子检测、去抖、异步请求、上下文提取、缓存、版本校验。
4. 实现各 API 预设、统一兼容接口、中文分析提示词、JSON 解析与回退。
5. 实现保存/打开、建议接受/忽略、草稿恢复与设置持久化。
6. 编写测试并实际运行，修复失败项。
7. 编写 `package.json`、锁文件、`environment.yml`、`run.sh`、`.env.example`、`.gitignore` 和中文 `README.md`。
8. 最终列出实际生成的文件、运行步骤、测试结果，以及任何尚未实现的功能或已知限制。**不得将未运行的测试描述为通过**。

**验收场景 A：** 用户在左侧连续输入两句英语；第一句输入句号后，后台开始分析；用户可以立即输入第二句，光标与键盘响应不受影响；右侧稍后出现中文解释和英文推荐。

**验收场景 B：** 输入语法正确且自然的句子，右侧显示“表达良好，无需修改”，而不是无意义地换同义词。

**验收场景 C：** 句子发出请求后被用户修改；旧请求返回时不会污染当前内容，也不会错误应用旧建议。

**验收场景 D：** 切换 OpenRouter 与本地 Ollama/LM Studio 时只需调整设置，不改业务代码；连接失败时写作功能保持可用。

**验收场景 E：** 用户点击“接受修改”才修改正文，且可以撤销；用户不点击时正文始终保持原样。

**验收场景 F：** 在 Apple Silicon Mac 上可通过 Conda（提供 Node.js）和 `bash run.sh` 启动 Electron 开发模式，且无须打包成应用。

## 11. 明确不做的内容（首版范围）

- 不开发账号系统、云端同步、支付功能、多人协作。
- 不默认上传全文，不上传用户本地文件路径、系统信息或 API Key。
- 不自动代写完整 TOEFL 答案；用户始终控制自己的写作。
- 不宣称能给出官方 TOEFL 分数；若未来增加模拟评分，应明确标识为非官方估计。
- 不在首版进行 macOS `.app`/DMG 打包。

## 12. 最终执行指令

现在开始创建项目并编写实际代码。遇到未指定的细节，优先选择简单、稳健、可测试、符合 macOS 习惯的实现，不要反复询问。优先确保“流畅的 Electron/CodeMirror 编辑 + 后台分析 + 中文反馈 + 多 Provider + Conda/npm 启动”端到端真实可用，再逐步完善装饰性功能。完成后请给出实际测试命令与结果，不要只提供伪代码。
