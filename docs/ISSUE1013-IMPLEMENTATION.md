# issue1013：保存状态、邮件分句、反馈保留与语法审议

日期：2026-10-13。对应 [issue1013.md](../issue/issue1013.md) 的五项问题。沿用现有 Electron、React、TypeScript、CodeMirror 6、Zod 和 Node fetch；没有增加运行时依赖。此次验证使用隔离的界面测试目录，以及现有默认 Ollama gemma3:12b 的固定例句测试，没有修改真实模型配置、凭据或作文。

## 1. 本次行为与代码入口

| 问题 | 修复后的行为 | 主要代码 |
| --- | --- | --- |
| 空白新文档显示已保存 | 没有真实文件关联时显示“未保存至文件”；保存取消、自动草稿写入均不会变成“已保存” | [schema.ts](../src/models/schema.ts)、[documents.ts](../electron/storage/documents.ts)、[App.tsx](../src/App.tsx) |
| 邮件称呼被拆开 | Email Writing 模式把 `Dear Alex,` 与下一行 `Hello.` 作为一个审议单元，原始换行与位置不变 | [sentences.ts](../src/core/sentences.ts)、[coordinator.ts](../src/core/coordinator.ts) |
| 修改时旧意见和全文反馈消失 | 可明确对应到同一句的编辑保留旧结果；修改等待默认 3 秒；全文反馈只由用户主动刷新 | [coordinator.ts](../src/core/coordinator.ts)、[FeedbackCard.tsx](../src/components/FeedbackCard.tsx)、[App.tsx](../src/App.tsx) |
| however 被当作缺少上下文 | 自动和手动单句请求统一携带前后文；提示词明确使用上下文，实际 HTTP 测试核验请求内容 | [coordinator.ts](../src/core/coordinator.ts)、[provider.ts](../electron/llm/provider.ts)、[FeedbackCard.tsx](../src/components/FeedbackCard.tsx) |
| trouble 的语法错误被措辞优化掩盖 | 优先检查谓语/主谓一致，客观错误排在可选优化前；含可选优化的单句结果最多追加一次独立语法复核 | [provider.ts](../electron/llm/provider.ts) |

## 2. 技术栈与职责

| 技术 | 本次用途 |
| --- | --- |
| Electron 主进程 / Node fs | 维护真实文件关联，读取及保存草稿；异步访问模型 |
| React / TypeScript | 区分当前正文和旧审议结果，保留全文快照，展示修改/上下文状态 |
| CodeMirror 6 | 保留正文、光标与撤销；旧结果不再给新原句画错误下划线 |
| 纯 TypeScript 分句与调度器 | 邮件开头合并、句子身份匹配、独立修改等待、缓存及旧请求取消 |
| Zod | 兼容旧草稿/设置，增加等待配置与文件关联标记，严格校验模型结果 |
| Node fetch / AbortController | 发送相同上下文、有限修复和语法复核，保留超时/取消控制 |
| Vitest / Playwright Electron | 分句/调度/存储/Provider 单元回归，真实窗口、编辑器、IPC 和本地 HTTP 回归 |

没有引入独立语法服务或硬编码用户例句的纠错规则。模型语言判断仍由当前选定 Provider 完成。

## 3. 新文档保存状态

原状态只检查 `dirty`。新建空文档没有正文修改，因此 dirty=false，但这不能证明它已经保存到文件。

现在增加可选 `hasFile` 字段以兼容旧草稿：

- 新建：`hasFile=false`，显示“未保存至文件”。空白内容仍不需要丢弃确认。
- 打开文件或实际保存成功：`hasFile=true`；正文没有新修改时显示“已保存”。
- 取消保存、保存失败：不改变关联状态。
- 恢复/写入草稿：主进程根据自身保存的真实 path 映射计算 hasFile，防止把自动草稿或 renderer 的声明误当作文件保存。
- 文件名不参与判断：真实保存为 `未命名.md` 也能正确显示“已保存”。

仍保留保存期间继续输入的保护：保存完成只对应点击时的文本快照，后续输入保持 dirty。

## 4. Email Writing 的审议单元

`splitSentences()` 增加写作模式参数。Email Writing 下识别逗号结尾的短称呼 `Dear/Hi/Hello/Hey …,` 或 `To whom it may concern,`，将它与后面的开场句合并。例如：

```text
Dear Alex,
Hello.
```

请求的 `original_text` 保留上面两行，不拼接成另一个字符串；`from/to` 仍是原文 UTF-16 范围。允许一个空行，支持 LF/CRLF。称呼后正文未结束时，整体保持 incomplete，等完成后再自动分析。

该规则不跨 Markdown 标题、列表、引用或代码边界，不改变其他写作模式的普通换行规则。它是有限的邮件开头规则，并不是通用跨段落语言解析器。

## 5. 修改等待与意见保留

### 配置位置

**右上角齿轮或 ⌘, → 写作设置 → 编辑与外观 → 修改后重新评估等待（毫秒）**。

默认 **3000 ms，即 3 秒**；允许 **1000–30000 ms**。字段名 `revisionDebounceMs`。旧设置加载时自动补此默认值；已有 `debounceMs` 和模型配置保持原值。保存设置时才写入新字段。

| 触发 | 等待规则 |
| --- | --- |
| 初次写完一句，新插入句末标点 | 220 ms 合并窗口 |
| 普通新内容停顿 | 原有“停顿延迟”，默认 1200 ms |
| 修改已有完整句子 | 独立“修改后重新评估等待”，默认 3000 ms |
| 等待时继续输入 | 重新计时 |
| 用户点击重新评估/分析选区 | 立即主动提交，仍受主进程排队限制 |
| IME 组合输入 | 暂停自动调度，组合结束后恢复 |

三个计时器按条目类别提交；新写句子的短计时器不会把正在修改的句子提前送出。应用内排队仍不计入单次 HTTP 超时。

### 当前句旧意见

此前只按原文完全一致复用卡片，一改字就生成无结果的新条目。现在先保留所有原文完全一致的匹配，再用公共前后缀确定编辑区间，匹配该区间内唯一的旧/新句子。

在写作模式、题目和分析配置未变化、映射明确时，保留卡片 ID、旧原句、旧建议和解释，设置 `textChanged=true`。状态按以下顺序变化：

```text
已审议 → 修改正文 → 保留上次意见 → 等待 3 秒 → 排队/分析（仍保留旧意见）
                                                  ├─ 成功：替换为新结果
                                                  └─ 失败：保留旧意见并显示失败
```

旧建议“接受修改”禁用，基于旧意见的正文标记移除；推荐句仍可供对照。原文变化会立即取消旧请求，返回时仍校验请求 UUID、当前签名与原文，防止迟到结果覆盖新内容。撤销回相同原文和上下文时可复用已有缓存。

拆句、合句或无法确定对应关系时，不把一份旧意见挂到任意新句子上。附近未改句子的反馈继续沿用此前确认的规则：标注“上下文已变化”，等待手动重评。

### 全文意见

全文保存与当前结果对应的正文、题目、模式和模型配置快照。同一文档修改后保留结果，显示“全文或分析设置已变化”，不会自动重新发送全文。点击“分析全文”或全文卡片“重新评估”才更新。

刷新过程中再次改文会取消该次请求，保留上一份已完成结果；刷新失败也不清空旧结果。成功时一起更新结果及快照。切换到其他文档或主动忽略时才清除显示，避免跨文档串用。

## 6. 上下文是否实际发送

**会发送。自动审议和手动重评共用同一条请求路径。** 此前代码已携带上下文，因此 however 的误判不能简单归因为完全没有传前文。

本次将签名计算和请求构造统一到 `surrounding()`：按顺序取最近 **两句完整前文、一句完整后文**，每句最多 3000 字符，另带填写的题目。手动重评使用点击时的最新内容。后文还没有写完时不会发送它；之后写完，也不会擅自刷新前句已有结果。

模型收到的首个 user JSON 形式如下，本地文件路径、文档 ID 不进入请求体：

```json
{
  "sentence_id": "…",
  "original_text": "Last day, however, I experienced issues with the heating system.",
  "context": {
    "before": ["I recently moved into your apartment, and I found it cozy and comfortable."],
    "after": ["Could you arrange a repair?"],
    "task": ""
  }
}
```

提示词明确说明 before/after 是已提供的上下文，应结合前文的积极评价与后文的问题判断转折，不能仅因当前单句缺少对比对象而删除 however。

每次成功结果在内部保存该请求的 `contextSnapshot`。按后续界面要求，反馈卡片不展示“本次审议使用的上下文”、前后句数量或上下文原文；模型仍接收相同上下文。真实 Electron 测试捕获主进程发出的 HTTP body，验证自动和手动两条路径，并确认展开详情后也不出现上下文明细。

## 7. 语法优先与有限复核

结构合法不代表语言判断正确。原系统允许模型把实际语法问题解释为 word_choice/improvement；仅按 JSON schema 无法识别这一语义错误。

本次有三层处理：

1. **提示词顺序**：先逐个检查独立谓语、主谓一致、动词形式/时态、词性和拼写，再看措辞优化。and 后的分句，以及 truly 等副词后的谓语也必须检查；优先最小必要修改，不无依据更改时态。
2. **结构约束**：`grammar/spelling` 必须是 `severity=error`，否则进入已有的最多一次格式修复。有效问题列表按 error 优先稳定排序，最多三条，避免可选建议排在客观错误前。
3. **独立语法复核**：单句 needs_revision 中包含任何 improvement 时，最多追加一轮，包括“一个语法错误 + 一个可选优化”的混合结果。重新发送系统提示词、原句和原上下文；只附上待检查的原文片段，不附第一轮 assistant 结论。复核仍可返回真正的可选优化，不强制升级所有风格建议。

实测曾发现，把第一轮回答直接附回对话，会让小模型继续沿用错误分类。改为独立复核后，定向真实测试用了两轮 HTTP，明确返回 trouble → troubles 的 grammar/error。这里采用通用谓语检查，没有针对该句写死替换规则。

good、纯客观错误和全文分析不触发此复核。每次审议最多增加一轮；总网络尝试上限从 6 改为 7，包含初始请求、最多两次格式降级、两次瞬态重试、一次格式修复和一次语法复核。每轮各自计时，用户取消会中止；有可选优化的结果可能比纯错误结果多等待一轮生成。

模型仍可能漏判，尤其第一轮直接返回 good 或漏掉其他错误但没有 improvement 时不会触发复核。此次通过固定问题回归，不代表模型已具备百分之百语法准确率。

## 8. 实际验证

| 检查 | 结果 |
| --- | --- |
| Node 22.23.2：`npm run check` | 类型检查、8 个文件 / **94 项单元测试**、生产构建通过；最终提示词调整后再跑 `npm test`，94 项仍通过 |
| `npm run test:e2e` | 重新构建并运行真实 Electron，**35 项全部通过**，约 1.5 分钟 |
| `scripts/dev-smoke.mjs` | **通过**：`bash run.sh → Vite → sandboxed Electron → Mock 反馈 → 接受修改` |
| 真实 `npm run test:ollama:review` | 当前默认 **gemma3:12b，原 60 秒超时**；四个固定示例全部通过，总计 **44.354 秒**，最终完整一轮每例各 1 次 HTTP |
| 独立复核定向实测 | trouble 示例经 2 次 HTTP 后返回 grammar/error，40.442 秒；完整测试的首轮已直接识别，因此没有额外复核 |
| 界面截图 | 已查看旧意见保留/禁用接受、修改等待设置、全文反馈显示 |

四个真实示例依次验证：有前文的 however 保留；freeze/trouble 示例明确包含 trouble 的语法错误；有前后文的手动重评情境保留 however；`Dear Alex,\nHello.` 合并后不被当作 incomplete。每一次实际 HTTP payload 都检查上下文与请求一致。最终 trouble 示例同时识别 freeze 和 trouble 的客观错误。

新增 **15 项单元测试**、**6 项 Electron 测试**，覆盖保存/取消/恢复、邮件换行及偏移、等待时长与焦点、旧意见的成功/失败/撤销/拆合句边界、全文刷新被编辑打断、上下文真实发送及详情不显示请求明细、设置持久化、语法分类和复核上限。文件对话框测试替换返回路径；实际文件、IPC、编辑器与窗口仍真实运行。E2E 的模型响应来自临时 HTTP 服务；真实 Ollama 结果另行验证，不混为一谈。

复验命令：

```bash
npm run check
npm run test:e2e
npm run test:dev
# Ollama 已运行且测试模型当前不驻留时，可选：
npm run test:ollama:review
# 可用 TWA_OLLAMA_PROFILE=<已保存配置的 ID> 选择本机配置
```

Ollama 脚本 [ollama-review-smoke.mjs](../scripts/ollama-review-smoke.mjs) 只读取模型设置并发送固定例句，限本机无认证端点；若该模型已驻留则停止，结束时尝试释放自身加载的模型。不读取作文或凭据，不修改实际配置。早期提示词/附带第一轮结论的尝试未通过 trouble 语法断言，未记为通过；最终通过记录如上。

截图：[修改中的旧反馈](issue1013-preserved-feedback.png)、[等待设置](issue1013-settings.png)、[全文反馈](issue1013-full-review.png)。设置截图用 4500 ms 演示可编辑及持久化，产品默认值仍是 3000 ms。

全项目技术说明：[IMPLEMENTATION.md](IMPLEMENTATION.md)。完整本轮及历史记录：[VALIDATION.md](VALIDATION.md)。
