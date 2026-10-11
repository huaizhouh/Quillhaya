# TOEFL Writing Assistant

一个以写作为中心的 macOS Electron 桌面应用：左侧是 CodeMirror 6 Markdown 编辑器，右侧提供不打断输入的中文反馈。建议只在点击“接受修改”后应用，可通过 ⌘Z 撤销。

![实际运行界面](docs/workspace-light.png)

## 启动

在项目目录执行：

```bash
conda env create -f environment.yml
conda activate toefl-writing-assistant
bash run.sh
```

环境使用 `conda-forge` 提供 Node.js 22 和 Python 3.11；应用本身不运行 Python。需要 **Node.js ≥ 22.12**。`run.sh` 在首次运行或锁文件变化后执行 `npm ci`，然后启动 Electron 开发版。首次启动还会下载官方 Electron 运行时，需联网。推荐 Apple Silicon 原生 arm64 环境，当前 Electron 要求 macOS Ventura 13 或以上。

也可直接使用 Node：

```bash
npm ci
npm run dev
```

只编译源码、然后运行本地构建：

```bash
npm run build
npm start
```

`build` 仅生成 `out/` 中的 JS、HTML、CSS，不生成 `.app`、DMG，不签名、不公证。`node_modules/electron/dist/Electron.app` 是下载的 Electron 开发运行时，不是本项目的应用打包产物。

## 先试一下

默认启用 **Mock 演示**，不需要密钥，不发送网络请求。点击“体验示例反馈”，或输入：

```text
I think online courses are quite efficiency and convenience.
Learning takes practice.
```

第一句出现中文语法解释和英文建议，第二句显示“表达良好”。Mock 只识别三个固定示例（`efficiency and convenience`、`I am agree`、`He go`）；其他完整句子按良好表达展示，**不是实际语言质量判断**。设置中可以选择正常、4 秒慢响应、模拟连接失败。

支持 Academic Discussion、Email Writing、General English 三种模式。题目/教授提问/邮件情境在独立区域输入，不计入作文字数。计时器从本次会话首次输入开始，仅作参考。

## 模型配置

打开右上角设置或按 `⌘,`，点击“添加模型”，选择 Provider，填写实际 Base URL 和模型 ID，选择认证方式，然后测试连接并保存。勾选“设为当前及默认模型”，或在反馈栏下拉框切换已保存配置。

| 预设 | 初始地址 | 初始认证 |
| --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | Bearer |
| OpenRouter | `https://openrouter.ai/api/v1` | Bearer |
| Ollama | `http://127.0.0.1:11434/v1` | 无 |
| LM Studio | `http://127.0.0.1:1234/v1` | 无 |
| vLLM | `http://127.0.0.1:8000/v1` | 无 |
| llama.cpp | `http://127.0.0.1:8080/v1` | 无 |
| Custom | 用户指定 | Bearer / 无 / 自定义认证 Header |

这些都是可编辑示例，模型名与端口应以你实际运行的服务为准。应用向 Base URL 后追加 `/chat/completions`，**不要把这个后缀重复填入 Base URL**。模型 ID 始终允许手动输入，不依赖 `/models`。

请求优先使用 `response_format: {type: "json_object"}`。端点明确报告不支持此格式时，自动退回提示词约束的文本 JSON。所有结果仍经严格 Zod 校验：字段、状态、中文说明、原文与句子 ID、可验证片段、建议数量等。无效响应最多修复一次；429/部分 5xx/连接失败最多重试两次；超时、取消和认证失败有独立中文提示。

Temperature 留空时不发送该参数。附加 Headers 仅用于非密钥信息（例如 OpenRouter 的 `HTTP-Referer`、`X-Title`）；认证凭据请使用 API Key 字段和认证方式。

## 密钥与隐私

- LLM 请求只在 Electron **主进程**发出。renderer 无 Node、文件系统、Keychain 和通用 IPC 权限。
- 新输入的密钥仅经一次写入式 IPC 送往主进程；保存后不会回传。设置页只能看到“是否已配置”，不会读取已保存密钥。输入框关闭后销毁。
- 使用 Electron `safeStorage` 加密凭据；macOS 的加密密钥由 Keychain 保护。JSON 中只有密文。安全存储不可用时拒绝保存，不退回明文。
- 密钥绑定配置 ID、Base URL 和认证方式，修改端点后需重新输入；防止旧密钥无意发送到新地址。环境变量由用户显式选择，会用于该配置指定的端点。
- 开发时可以在启动前 `export OPENAI_API_KEY`、`export OPENROUTER_API_KEY`，或者在配置中填写自定义环境变量名称。`.env.example` 只有空值；应用不自动加载 `.env`。
- 默认发送当前句子、最多前两句和后一句完整上下文，以及选填题目；不发送本地文件路径、文档标识或系统信息。“分析全文”是主动操作，会发送全文并仅返回结构和任务回应等建议，不生成全文替换。
- 远程端点会接收上述文本。本地端点由你运行的服务处理，是否继续转发由该服务决定。API Key 只作为选定端点的认证凭据发送。
- 网络错误、无 Key 或暂停分析都不会禁用编辑器。没有遥测、账号、云同步或官方评分。

## 编辑和文件

| 操作 | 快捷键 |
| --- | --- |
| 新建 / 打开 | `⌘N` / `⌘O` |
| 保存 / 另存为 | `⌘S` / `⌘⇧S` |
| 设置 | `⌘,` |
| 撤销 / 重做 | `⌘Z` / `⌘⇧Z` |
| 窗口文字缩放 | 原生“视图”菜单中的放大、缩小、实际大小 |

正文使用真实 CodeMirror 编辑状态、撤销栈和增量变更。反馈更新只改变装饰与卡片，不重新创建编辑器，不设置选区，不抢焦点。输入法组合期间暂停调度和装饰更新。点击原句只滚动定位；点击接受时重新核验字符范围和完整原文，并将修改隔离为可撤销的一步。

侧栏可以拖动改变宽度，分隔线也支持键盘左右方向键；折叠仍继续分析。暂停按钮会取消待处理请求；用户仍能手动分析选区或全文。忽略的句子在本次会话中保持隐藏，直到该句内容变化。主题支持跟随系统/浅色/深色，字号可调。

文件使用 UTF-8，支持新建、打开、保存、另存为；保留已打开文件的 BOM 和 CRLF 换行风格。写入先使用同目录临时文件，再原子替换。外部程序改动原文件时，保存前会提示是否覆盖。未保存内容在离开文档前有原生保存提示。

编辑停顿 650 ms 后自动保存**独立草稿**，关闭窗口前也会刷新草稿。重新启动自动恢复最后一份会话（正文、模式、题目、文件关联）。草稿不会覆盖原文件。异常终止可能丢失最后 650 ms 尚未落盘的输入；磁盘写入失败会在底部明确显示。

macOS 默认数据目录：`~/Library/Application Support/TOEFL Writing Assistant/`。

| 文件 | 内容 |
| --- | --- |
| `settings.json` | 非密钥设置 |
| `credentials.json` | 系统加密后的密钥密文 |
| `draft.json` | 最新本地草稿、原文件关联和已保存版本 |

草稿包含正文和题目，属于本地未加密数据，请按作文隐私需求保护自己的系统账户与磁盘。不要将整个数据目录提交到 Git。

## 一致性与架构

```text
CodeMirror → AnalysisCoordinator → 白名单 preload IPC
                                  ↓
             主进程校验 → RequestQueue（并发 2，启动间隔 ≥ 300 ms）
                                  ↓
                 LLMProvider → Mock / OpenAI-compatible fetch
                                  ↓
              严格解析 → 原文、文档、请求令牌、上下文签名核验
                                  ↓
                        侧栏反馈（不写入正文）
```

分句使用保守规则，保留原始 UTF-16 字符偏移，识别常见缩写、首字母缩写、小数和换行；排除 Markdown 标题、列表标记、代码块、行内代码和 URL。完整句号/问号/感叹号触发 220 ms 合并窗口，停顿触发默认 1200 ms 去抖。明显未完成的句子自动跳过，选区可主动分析。

编辑时重新计算句子与上下文签名，只提交变化或缺少结果的句子。内存缓存最多 300 条；上下文、模式、题目或模型配置改变时重新核验。句子内容未变但位置移动可安全复用。请求携带 `document_id`、`revision_id`、`sentence_id`、请求 UUID 和本地范围；返回时除文档与签名外，还核对当前原文和请求令牌。因此旧请求即使无法及时取消，也不会污染新文档或变化后的句子。

任务书主体要求 Electron/TypeScript，第 10 节残留 PySide6、第 5/6 节要求 Pydantic，与主体架构及“不增加无必要 Python 服务”冲突。本项目采用 **Electron + React + TypeScript + Zod** 实现等价严格数据校验，没有引入 PySide6 或 Python 后端。Provider 接口预留原生 Anthropic/Gemini 适配位置，首版不实现这两种协议。

## 文件清单

```text
electron/
  main.ts                    窗口、安全设置、原生菜单、参数校验与 IPC
  preload.ts                 固定 IPC 白名单，不暴露任意 invoke
  llm/errors.ts              脱敏错误、可取消等待
  llm/provider.ts            Provider 接口、提示词、JSON 校验、兼容请求、Mock
  llm/queue.ts               主进程并发/节流/取消
  storage/store.ts           原子设置与草稿、safeStorage 凭据
  storage/documents.ts       原生文件对话框、UTF-8 与冲突检测
src/
  App.tsx                    写作空间与会话编排
  main.tsx                   入口与错误边界
  models/schema.ts           共享类型、Zod、Provider 预设、IPC 类型
  core/sentences.ts          分句、原文范围、字数与替换核验
  core/coordinator.ts        去抖、缓存、上下文、过期响应防护
  editor/WritingEditor.tsx   CodeMirror 生命周期、装饰、显式接受
  components/FeedbackCard.tsx
  components/SettingsDialog.tsx
  styles/app.css
  styles/settings.css
tests/
  unit/                      逻辑、Provider、队列、存储、撤销测试
  e2e/app.spec.ts             实际 Electron 流程与真实本地 HTTP 测试
scripts/dev-smoke.mjs         run.sh → Vite → Electron 开发启动验证
docs/                        实际截图与验收记录
environment.yml              Conda Node.js 22 / Python 3.11
run.sh                       源码启动入口
package.json / package-lock.json
electron.vite.config.ts / tsconfig.json
vitest.config.ts / playwright.config.ts
index.html / .env.example / .gitignore
```

## 测试

```bash
npm run typecheck
npm test
npm run test:e2e
npm run test:dev
npm audit
```

E2E 使用下载的 Electron 自身，不需要另外下载 Playwright Chromium。测试使用临时 `TWA_TEST_USER_DATA`，不触碰你的真实文档；原生文件对话框在文件测试中替换为临时路径，实际文件读写、IPC、Electron、CodeMirror 与菜单仍是真实实现。HTTP 集成测试运行临时本地兼容服务，不消费外部 API 配额。开发冒烟测试会运行 `bash run.sh`，随后自动关闭其启动的进程。

实际执行结果和测试环境见 [验收记录](docs/VALIDATION.md)。

## 故障排查

- **Node 版本错误 / Rosetta 混用**：激活 Conda 后运行 `node -p 'process.version + " " + process.arch'`，应为 Node 22.12+、`arm64`。在原生 arm64 终端安装环境。
- **Electron 下载断开**：先重试 `npx --no install-electron`。若官方 GitHub 下载在当前网络不可用，可用 Electron 文档列出的镜像：`ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/ npx --no install-electron`。安装器会校验校验和。也可给 `bash run.sh` 添加同一环境变量。
- **Conda TLS/元数据错误**：检查系统时间、代理与可信证书后重试。可尝试 `CONDA_REPODATA_USE_ZST=false conda env create -f environment.yml`；不要关闭 TLS 校验。
- **401/403**：检查 API Key、认证方式和该服务的权限。密钥绑定端点，修改地址后需重新输入。
- **404 / 模型不存在**：检查 Base URL 是否包含服务要求的 `/v1`，以及 Model 是否与服务端加载的 ID 一致。
- **429**：应用已有限重试，可暂停自动分析、增加停顿延迟或等待服务额度恢复。
- **本地连接失败**：先启动 Ollama/LM Studio 等服务，确认地址和端口；编辑和文件功能仍然可用。
- **JSON 校验失败**：服务必须支持 Chat Completions，并能遵循 JSON 输出指令。有限修复失败后会明确显示错误，不应用不可信建议。
- **Keychain 不可用**：解锁系统 Keychain，或使用设置中指定的环境变量；应用不会明文存储密钥。
- **修改源码后未热更新**：开发模式有意关闭 React Refresh，以维持严格的禁止内联脚本 CSP，并避免开发热刷新打断写作。重新启动 `npm run dev` 即可。
- **E2E 无法启动 / SIGABRT / EPERM**：Electron GUI 需要正常桌面登录会话及进程启动权限。受限容器、CI 或外层文件沙箱可能无法启动窗口；不要通过关闭应用 sandbox 解决。

## 首版边界

- 未用真实 OpenAI/OpenRouter 账户或实际 Ollama/LM Studio/vLLM/llama.cpp 模型逐一联调；统一兼容协议已通过 Mock fetch 和真实本地 HTTP 测试。实际模型能力、参数支持与反馈质量由服务决定。
- 不提供官方 TOEFL 分数，不自动代写全文。
- 未实现 Markdown 渲染预览、模型列表自动发现和 Anthropic/Gemini 原生协议；编辑器本身有 Markdown 语法高亮。
- 保守分句不覆盖所有英语语言现象；包含行内代码或 URL 的整句会被跳过。跨行未结束的句子暂按不完整片段处理。自动分句缓存、忽略状态及计时器只在本次会话中有效。
- 本地文件上限 500,000 字符，单次全文分析上限 50,000 字符。为 TOEFL 篇幅设计，超长文档未做性能承诺。
- 单窗口、单份最近草稿；不实现多文档标签、历史版本库、账号、同步、支付、多人协作或应用打包。
- 自动化已覆盖组合态调度；真实系统输入法的所有候选窗行为仍需人工使用验证。

## 参考文档

- [OpenAI 官方 Structured Outputs / JSON mode](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)：JSON mode 不保证字段符合 schema，因此客户端始终自行严格校验。
- [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage)：macOS 加密密钥由 Keychain 保护。
- [Electron 安全指南](https://www.electronjs.org/docs/latest/tutorial/security)：隔离、沙箱、导航和 IPC 边界。
- [Playwright Electron](https://playwright.dev/docs/api/class-electron)：实际桌面应用的端到端测试。
