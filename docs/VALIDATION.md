# 实际验收记录

最新验证日期：2026-10-21。以下区分本次修复复验与初版历史记录，只记录实际执行的检查。

## 2026-10-21 issue1020 连接失败详情与文件移动（最新）

| 检查 | 实际结果 |
| --- | --- |
| Node 22.23.2：`npm run check` | 类型检查、**9 个文件 / 108 项单元测试**及生产构建通过 |
| `playwright test tests/e2e/issue1020.spec.ts` | **新增 2 项通过，最终定向复验 5.1 秒**：两轮空 content 响应、HTTP 401 长正文、凭据脱敏、独立窗口、关闭后保留设置、成功后移除入口；移动文件后取消已保存、草稿与重启保留、取消保存及重新选址不重建原文件 |
| `playwright test --grep-invert issue1020` | **其余 39 项全部通过，约 1.6 分钟**；与新增用例合计覆盖当前全部 41 项 Electron E2E |
| 已构建产物：`electron-builder --mac --arm64 --publish never` | 更新 `dist/mac-arm64/Writing Assistant.app` 和 `dist/Writing Assistant-1.0.0-arm64.dmg` 成功，未发布 |
| `npm run test:package` | 更新后的真实 `.app` 冒烟通过：arm64、打包状态、本地资源、IPC、沙箱、Mock 反馈及接受/忽略/重评 |
| `codesign --verify --deep --strict` | 更新后的本机 ad-hoc 签名校验通过；未配置 Developer ID 或公证 |

所有文件移动及对话框测试均在临时隔离目录完成；模型返回由本地 HTTP 服务模拟，不调用真实 OpenRouter 或 Ollama、不移动用户实际作文。既有 E2E 重新生成的截图已恢复，未作为本次变更提交。连接详情的新正文和文件状态检查均不改动分析提示词及用户配置。

最终核对补充 JSON Unicode 转义密钥回显的脱敏：解码和格式化后再次过滤已知凭据。调整后重新通过全部 108 项单元测试、类型检查、构建及上述 2 项定向界面测试，并重新生成安装包；其余 39 项的完整回归在该单点脱敏调整前执行。

技术栈、文件移动处理方式、响应显示范围及代码入口：[ISSUE1020-IMPLEMENTATION.md](ISSUE1020-IMPLEMENTATION.md)。

## 2026-10-18 issue1018 忽略行为与应用打包（历史记录）

| 检查 | 实际结果 |
| --- | --- |
| Node 22.23.2：`npm run check` | 类型检查、**8 个文件 / 101 项单元测试**和生产构建通过 |
| 已构建产物：`playwright test` | **39 项真实 Electron E2E 全部通过，约 1.6 分钟**；含忽略保留原句、隐藏评价、移除下划线和统计、续写保持忽略、重评及改句恢复 |
| `npm run dist:mac` | electron-builder 26.15.3 成功生成 `dist/mac-arm64/Writing Assistant.app` 和 `dist/Writing Assistant-1.0.0-arm64.dmg`（约 126 MiB），另生成 DMG blockmap |
| `npm run test:package` | 实际 `.app` 启动通过：本地资源、arm64、打包状态、IPC、沙箱、Mock 反馈、忽略、重新评估、接受修改；临时数据目录成功清理 |
| `codesign --verify --deep --strict` | 通过，本机 ad-hoc 签名有效；没有 Developer ID 签名或公证 |
| `file`、Info.plist 和 ASAR 清单 | 主可执行文件为 arm64；Bundle ID、名称、效率工具分类均匹配配置；归档根目录仅有 `out`、`node_modules` 和 `package.json`，主进程、preload、页面及 Zod 均存在 |
| 锁文件检查 | 新增打包开发依赖；既有依赖版本未变、未删除既有依赖路径 |

首次打包冒烟的功能断言已通过，但退出后立即删除临时目录发生 `ENOTEMPTY`，该次进程退出码为 1，不计为整体通过。脚本改为先等待应用关闭事件、再执行有界重试清理，重跑退出码为 0。没有为此修改应用生产退出逻辑。

构建提示未配置作者和自定义图标；图标按要求保持空，作者未猜测填写。此次没有运行真实 Ollama 或修改模型提示词；所有交互测试均使用隔离临时目录和 Mock/本地测试 HTTP 服务。完整回归生成的既有截图未纳入代码变更。

实现、配置含义和复验命令：[ISSUE1018-IMPLEMENTATION.md](ISSUE1018-IMPLEMENTATION.md)。

## 2026-10-16 issue1014 后续简化（历史记录）

按反馈删除新增的逐条片段相等拦截、示例词句特殊规定及相应测试断言，压缩复核提示为通用的错误与优化分类原则。

| 检查 | 实际结果 |
| --- | --- |
| `npm run check` | 类型检查、**8 个文件 / 100 项单元测试**和生产构建通过 |
| `playwright test tests/e2e/issue1014.spec.ts`（已构建产物） | **3 项通过，8.4 秒**：续写上下文提示、退出保存恢复、可选优化在一次复核后仍显示且可接受 |
| 真实模型与完整 E2E | 本次未重跑；下方记录属于提示词简化前的版本，不作为当前提示词的模型质量结论 |

## 2026-10-16 issue1014 三项修复复验（简化前记录）

下述版本曾含后来撤回的片段相等拦截；相应的一个单元测试已删除，界面测试已改为验证正常可选优化展示。

| 检查 | 实际结果 |
| --- | --- |
| Conda Node 22.23.2：`npm run check` | 类型检查、**8 个文件 / 101 项单元测试**、构建通过；最终优化保留保护及空白规范调整后再次运行单元测试和构建通过 |
| `npm run test:e2e` | 最终完整 **38 项真实 Electron E2E 全部通过**，约 1.7 分钟 |
| 新增 3 项界面回归 | 续写不提示前句过期；原生退出选择保存后重启恢复文件、继续保存沿用原路径、干净退出不再询问；无变化 said 条目修复后保留可选优化 |
| 修改前反证 | 新增/加强的回归断言有 **6 项失败**，明确复现上下文误提示、草稿保存元数据覆盖及无效 issue 未被拒绝；实现修复后全部通过 |
| 开发启动冒烟 | `npm run test:dev` 通过，实际 `run.sh → Vite → sandboxed Electron → Mock 反馈 → 接受修改` |
| 默认 gemma4:e2b-mlx，原 45 秒超时 | 最终实现下，正确 said、纯表达优化、礼貌句及混合错误/优化四例通过；混合例定向复验 2 次 HTTP、17.626 秒。长句 trouble 示例在最终一轮及定向重跑均超时，**不计为通过** |
| gemma3:12b 长句对照，原 60 秒超时 | 2 次 HTTP、51.191 秒返回结构合法结果，但把 trouble 改成 troubled，且中文解释不正确，**不计为语法判断通过**。旧断言只检查 grammar/error 标签，曾输出 PASS；人工核查后已加强为检查实际 trouble → troubles 词形，不能以标签正确冒充纠错正确 |

完整 E2E 先后出现 36/38、38/38、37/38。失败均表现为测试替换正文后出现额外字符、句号缺失或与旧内容拼接；trace 中 fill 参数正确。针对 CodeMirror 选区同步与 DOM fill 的潜在竞态，测试辅助函数调整为“聚焦 → 编辑器全选快捷键 → 插入文本 → 核验正文”，保留原功能断言；最终完整重跑 38 项全部通过。未把失败轮次记为通过。

早期真实模型回归曾漏掉最终改写已采用的优化条目，因此增加了严格字面重建的保留保护。另一次额外探测 `They said they would come yesterday.` 时，小模型把相对时间搭配误判为语法错误并删掉时间信息；此句不作为正确 said 的单一验证，改用无相对时间歧义的 `The teachers said the lesson was useful.`，原误判如实保留为模型能力边界。固定例句通过不能证明所有语义判断都准确，也不能将超时算作模型判断通过。

本轮使用临时隔离用户目录，不修改实际作文、凭据或模型配置。真实文件对话框返回值在测试中替换为临时路径，实际退出、重启、IPC 和文件读写均运行。修复包含按真实文件关联兼容恢复旧草稿元数据；不会写回覆盖用户原文件。

技术栈、根因、代码入口、行为边界和复验命令：[ISSUE1014-IMPLEMENTATION.md](ISSUE1014-IMPLEMENTATION.md)。

## 2026-10-13 issue1013 五项修复复验（历史记录）

后续界面调整：移除反馈详情中的上下文数量及原文展示，保留实际请求上下文。已重新通过类型检查、生产构建及 1 项对应 Electron HTTP/界面回归；确认自动/手动请求仍携带上下文，展开详情也不显示这些明细。

| 检查 | 实际结果 |
| --- | --- |
| Conda Node 22.23.2：`npm run check` | 类型检查、**8 个文件 / 94 项单元测试**、生产构建通过；最终提示词调整后再次 `npm test`，94 项通过 |
| `npm run test:e2e` | 最终源码重新构建，**35 项真实 Electron E2E 全部通过**，约 1.5 分钟 |
| `scripts/dev-smoke.mjs` | **通过**：`bash run.sh → Vite → sandboxed Electron → Mock 反馈 → 接受修改` |
| `npm run test:ollama:review` | 现有默认 **gemma3:12b**，沿用 **60 秒**单次超时；**四个固定示例全部通过，44.354 秒**；最终完整一轮每例各 1 次 HTTP，实际 payload 上下文全部一致 |
| 独立语法复核定向检查 | trouble 示例经 2 次 HTTP 后正确返回 grammar/error，40.442 秒；最终完整一轮的第一次回答已直接识别，不需要复核 |
| 截图检查 | 已查看原句编辑后旧意见保留且接受禁用、独立修改等待设置、全文结果显示 |

新增 15 项单元测试及 6 项 E2E。覆盖未保存新文档/恢复草稿、取消保存、真实文件名为“未命名.md”；邮件称呼合并及原始偏移；旧意见保留、修改等待 3 秒、失败/撤销/拆合句；全文结果在编辑和中断手动刷新后保留；自动/手动 HTTP 上下文、卡片详情不显示请求明细；设置独立持久化及旧配置默认值；语法优先分类、混合结果复核、真正可选优化和复核次数上限。

真实 Ollama 四例验证：有前文时保留 however；明确指出 trouble → troubles 的主谓一致错误（同时识别 freeze）；有前后文的重评情境保留 however；`Dear Alex,\nHello.` 作为完整单元。早期提示词/附带首轮结论的复核未通过 trouble 断言，未计作通过；独立重新读原文与上下文后，定向和最终完整测试通过。模型输出仍可能波动，固定示例通过不代表所有语义判断必然准确。

E2E 使用隔离临时目录及临时 HTTP 服务；真实模型脚本只读现有模型设置、发送固定例句，结束时释放测试模型，没有修改真实模型配置、凭据或作文。测试中没有消费云端 API。当前默认修改等待为 3000 ms，截图中的 4500 ms 是设置持久化测试值。

逐项实现、设置位置、技术栈和复验方法：[ISSUE1013-IMPLEMENTATION.md](ISSUE1013-IMPLEMENTATION.md)。截图：[旧反馈保留](issue1013-preserved-feedback.png)、[设置](issue1013-settings.png)、[全文反馈](issue1013-full-review.png)。

## 2026-10-12 issue1012_2 四项修复复验（历史记录）

| 检查 | 实际结果 |
| --- | --- |
| Conda Node 22.23.2：`npm run check` | 类型检查、**8 个文件 / 79 项单元测试**、生产构建全部通过 |
| Conda Node 22.23.2：完整 Playwright Electron 测试 | **29 项通过**，约 1.1 分钟 |
| Conda Node 22.23.2：`scripts/dev-smoke.mjs` | **通过**：`bash run.sh → Vite → sandboxed Electron → Mock 反馈 → 接受修改` |
| `TWA_OLLAMA_PROFILE=a7fbbff2-eb4c-4d5e-adee-3a910e1fb44d TWA_OLLAMA_OLD_MODEL=gemma4:12b node scripts/ollama-close-smoke.mjs` | **真实 gemma4:12b-mlx 固定句子分析及原生退出卸载通过**；退出前后分别用 `/api/ps` 确认驻留/不驻留，总计 28.326 秒；沿用其当前 120 秒超时 |
| 真实旧模型 ID 核验 | gemma4:12b 已不在本机模型列表；主进程收到卸载 404 后通过 `/api/ps` 确认不驻留，返回 `alreadyReleased`，没有误报 |
| 浅色/深色截图 | 已查看红色波浪线与黄色虚线，具备不同线型和悬停说明 |

新增 11 项单元测试和 7 项 E2E。回归覆盖连续句中修改等待完整去抖、不同句子的短触发隔离、两类正文装饰、普通关窗/⌘Q/恢复退出等待卸载、退出取消、清理失败返回写作再重试、模型 ID 改动后的历史记录核验。模拟延迟卸载时，确认收到卸载成功前窗口仍存在、后续排队分析不再发送、草稿保留最新内容。

首次新增 E2E 为 6/7：状态文案前含“·”图标，测试的精确文本断言不匹配；连续键入期间没有多余请求的断言已通过。修正断言后，完整重跑 29 项通过。真实模型测试使用隔离的 Electron 用户目录，只读取现有模型设置并发送固定句子，不读取用户作文或凭据、不修改真实配置。

逐项根因、技术栈及代码入口：[ISSUE1012-2-IMPLEMENTATION.md](ISSUE1012-2-IMPLEMENTATION.md)。截图：[浅色标记](issue1012-2-marks-light.png)、[深色标记](issue1012-2-marks-dark.png)。

## 2026-10-12 issue1012 六项修复复验（历史记录）

| 检查 | 实际结果 |
| --- | --- |
| Conda Node 22.23.2 执行 `npm run check` | 类型检查通过；**8 个测试文件、68 项单元测试通过**；main、sandboxed preload、renderer 构建通过 |
| Conda Node 22.23.2 运行 Playwright CLI | **22 项真实 Electron E2E 通过**，完整执行 48.4 秒 |
| Conda Node 22.23.2 运行 `scripts/dev-smoke.mjs` | **通过**：`bash run.sh → Vite → sandboxed Electron → Mock 反馈 → 接受修改` |
| `TWA_OLLAMA_PROFILE=mock node scripts/ollama-lifecycle-smoke.mjs` | 已有配置的实际 Provider 是 Ollama、模型为 **gemma3:12b**；测试后卸载和主动停止均通过，两次 `/api/ps` 确认不驻留，总计 23.335 秒 |
| 默认 gemma4:12b 生命周期检查 | 保留原 30 秒超时，连接测试超时；清理收到卸载确认，**不算推理通过** |
| 截图检查 | 已查看横向设置标题、题目拖动手柄、计时按钮、上下文变化提示及深色界面 |

新增 6 项 E2E 验证设置标题布局与手柄、计时控制、接受建议后邻句反馈保留及重评、只测试当前配置、取消测试后卸载、停止后不自动重载。新增逻辑测试覆盖上下文版本、计时状态及模型生命周期的失败/取消/超时边界。

首次完整 E2E 为 21/22，通过失败项定位到首次保存外观时对象字段顺序引发的配置误判；修正实际比较逻辑后，完整重跑 22 项通过。E2E 与开发冒烟均使用隔离的临时数据目录，真实 Ollama 检查只读取模型设置及发送固定句子，没有读取作文或凭据，也没有修改实际配置。

技术栈、逐项根因、代码入口、复验命令与边界见 [ISSUE1012-IMPLEMENTATION.md](ISSUE1012-IMPLEMENTATION.md)。截图：[设置页](issue1012-settings.png)、[反馈保留](issue1012-workspace.png)。

## 2026-10-12 四项问题修复复验（历史记录）

| 检查 | 实际结果 |
| --- | --- |
| `npm test`；另用 Conda Node 22.23.2 直接运行 Vitest | **6 个测试文件，56 项通过** |
| `npm run typecheck`；另用 Conda Node 22.23.2 运行 `tsc --noEmit` | 通过 |
| `npm run build` | 主进程、sandboxed preload、renderer 构建通过 |
| Conda Node 22.23.2 运行 Playwright CLI | **16 项真实 Electron E2E 通过**，最终完整执行 40.4 秒 |
| Conda Node 22.23.2 运行 `scripts/dev-smoke.mjs` | **通过**：`bash run.sh → Vite → sandboxed Electron → Mock 反馈 → 接受修改` |
| `node scripts/ollama-smoke.mjs`（也可 `npm run test:ollama`） | **4/4 真实 Ollama gemma3:12b 检查通过**；每句一次 HTTP，无修复/降级；保留原 30 秒超时 |
| 排队与超时实测 | 第 4 句排队 39.455 秒后，实际调用 4.989 秒完成；没有因排队超时 |

新增 E2E 覆盖添加/切换/删除/保存模型、Headers 保留、保存后重新打开设置、⌘Q 对应原生退出流程、异常快照恢复、追加完整句子和修改外观不重复分析、Ollama 排队状态及真正发送请求的顺序。

第一次 E2E 执行有一项新测试因 `getByLabel('主题', { exact: true })` 无法定位控件而超时。读取 Playwright trace 确认停在控件定位后，修正选择器并重跑全部 16 项，通过。未将失败的一轮记为通过。

真实 Ollama 测试只读取模型设置，发送固定测试句，不读取用户作文或凭据。完整输入、耗时与根因/代码对应见 [本次修复说明](FIXES-2026-10-12.md)。E2E 使用临时数据目录，不修改真实配置或草稿。

## 2026-10-11 初版基线（历史记录）

以下安装环境、数量与截图记录为初版验收结果；当前测试数量以上面的复验记录为准。

## 运行环境

| 项目 | 实测值 |
| --- | --- |
| 系统 | macOS 27.0.1 |
| 架构 | Apple Silicon / arm64 |
| 开发 Node | Conda Node.js 22.23.2 |
| Electron | 44.7.0，官方 darwin-arm64 运行时 |
| TypeScript | 5.9.3 |
| Vite / electron-vite | 6.4.4 / 4.0.1 |
| React / CodeMirror view | 19.3.0 / 6.43.14 |
| Vitest / Playwright | 5.0.3 / 1.64.0 |

Electron 测试在正常 macOS 桌面权限下运行；外层文件沙箱会使 GUI 进程出现 SIGABRT/EPERM。应用自身的 `sandbox:true` 始终保持开启，并由 E2E 断言验证，没有通过关闭沙箱使测试通过。

## 执行命令与结果

| 命令 / 检查 | 实际结果 |
| --- | --- |
| `npm run typecheck` / 同等的 Node 22 `tsc --noEmit` | 通过，0 TypeScript 错误 |
| `npm test` / Node 22 运行 Vitest | **6 个测试文件，46 项测试通过** |
| `npm run build` | main、sandboxed preload、renderer 全部构建成功 |
| `npm run test:e2e`，Conda Node 22 环境 | **12 项测试通过**，最后一次完整执行约 33.8 秒 |
| `npm run test:dev`，Conda Node 22 环境 | **通过**：真实执行 `bash run.sh → Vite → Electron → Mock 反馈 → 接受修改`，退出码 0 |
| `npm ci` | 在 `run.sh` 首次安装流程中实际执行成功；Electron 安装钩子已验证 |
| 最终 `environment.yml` | 已用本次下载的 Conda 缓存，以 `conda env create --offline --prefix /private/tmp/twa-node22-final -f environment.yml` 实际创建仅含 Node 的 arm64 环境；未关闭 TLS 校验 |
| `bash -n run.sh` | 通过 |
| `npm install --package-lock-only --ignore-scripts` 的完整审计，以及 `npm audit --omit=optional` | 最终锁文件报告 0 个漏洞 |
| 浅色 / 深色窗口截图 | 已生成并人工查看，正文内边距、字体、侧栏、建议卡片和主题正常 |

`npm run test:dev` 使用临时测试数据目录，并在完成后终止其独立测试进程组。它不会启动或修改用户的真实草稿会话。源码构建与运行测试没有创建本项目的 `.app` 或 DMG。

## 46 项逻辑测试覆盖

- 句末标点、引号、缩写、首字母、小数、换行和未完成句子。
- Markdown 标题、列表、围栏、行内代码、URL、缩进代码、UTF-16 偏移及英文单词数。
- 快速连续输入请求合并；相同句子缓存；上下文变化失效。
- 编辑后旧响应丢弃；文档切换隔离；位置移动和忽略状态。
- 暂停分析、主动选区、IME 组合态调度和错误后继续编辑。
- 合法 JSON、单个 Markdown 围栏、缺字段、类型错误、非中文说明、原文/片段不匹配。
- 真实 Provider 接口的 Mock fetch：成功、401、404、400、429、网络、超时、取消、缺 Key、JSON 回退和有限修复。
- Mock 正常、错误与词边界回归，不将 `He goes` 错改为 `He goeses`。
- 主进程队列并发 2、请求启动间隔、排队及执行中取消。
- 建议接受前不改文档、位置精确匹配、光标映射、CodeMirror 撤销。
- 凭据加密边界与目标绑定；安全存储不可用时拒绝明文回退。
- 原子草稿顺序、损坏草稿备份、外部文件变更取消、UTF-8/BOM/CRLF 保存与非法编码拒绝。

## 12 项真实 Electron 测试

1. 窗口实际启用隔离与沙箱，renderer 无 require/任意文件接口；原生菜单快捷键和 IPC 参数校验有效。
2. 模型 4 秒延迟时继续输入第二句，反馈到达后焦点及文档中的逻辑光标位置保持不变。
3. 未点击接受前正文不变；复制走受控剪贴板接口；主动接受后可用 ⌘Z 撤销；良好句子无改写按钮。
4. 在途请求的原句被修改后，旧结果不出现在新句子上。
5. 忽略后同句保持隐藏；折叠后继续分析；全文分析仅主动触发。
6. 模拟离线错误不阻塞输入；设置中的连接测试使用所选配置。
7. 无 API Key 时可继续编辑；多个模型配置持久化并可切换。
8. 保存、另存为、打开、取消未保存离开、重启恢复草稿；自动草稿不覆盖原文件。
9. 浅色和深色模式的实际窗口截图。
10. 原生应用退出可取消；再次同意退出后保留最新草稿并真正结束应用。
11. macOS `safeStorage` 实际加密/解密往返成功，密文不包含原测试字符串，bootstrap 不回传密钥。
12. 主进程真实 fetch 访问临时 HTTP 兼容服务，端点拒绝 JSON mode 后回退成功；网络 payload 不含本地路径或文档 ID。

文件测试用临时目录替代原生选择对话框的返回路径；实际磁盘写入、重启、IPC 和 CodeMirror 仍真实运行。复制测试替代 Electron 的剪贴板写函数以观察调用，避免覆盖用户剪贴板。Keychain 测试使用合成字符串，不需要真实模型 Key。

## 已实际修复的问题

- Mock 规则缺少词边界，导致将已经正确的 `He goes` 当作 `He go`。
- CodeMirror 默认样式优先级覆盖正文 padding/font，已修正并查看截图。
- Electron 运行时安装缺失，新增显式 postinstall 和启动时缺失检查。
- Vite 开发 URL 末尾斜杠规范化导致严格来源检查误判，已规范化 URL 并通过实际开发启动验证。
- 开发测试退出被应用的未保存确认阻塞，测试改为清理独立测试进程组；应用的正常保存提示保持不变。
- 正常 macOS 退出区分“关窗口”与“退出应用”，避免退出请求只留下后台进程。
- 损坏草稿在新会话自动保存前生成 recovery 备份。

## 测试边界

初版未提供实际云服务 API Key，也未连接真实本地模型。2026-10-12 已追加 Ollama gemma3:12b 实测；其他具体模型和云端账户仍未逐一联调。接口兼容性同时由 Mock fetch 与真实本地 HTTP 服务测试，不能据此保证所有模型的语言判断与参数支持。

未全面人工验证每一种系统输入法、辅助技术、显示器组合和超长文档性能。没有执行签名、公证、DMG 或本项目应用打包。

截图：

- [浅色界面](workspace-light.png)
- [深色界面](workspace-dark.png)

代码与实现细节：[IMPLEMENTATION.md](IMPLEMENTATION.md)。
