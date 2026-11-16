# Quillhaya Windows 版本

已完成独立 Windows 工程、平台适配与 x64 NSIS 安装包。版本为 **1.0.3**；Windows 相关代码、依赖、缓存、测试及产物全部位于本目录，根 Mac 工程保持不变。

安装包：[Quillhaya-1.0.3-Windows-x64-Setup.exe](dist/Quillhaya-1.0.3-Windows-x64-Setup.exe)。这是**未签名**的本地构建，没有自动发布。产物目录被 Git 忽略，克隆后需自行构建。

## 开发与验证

需要 Windows x64 和 Node.js 22.12 或更高版本。在本目录运行（使用 npm.cmd 可避免 PowerShell 选择 npm.ps1）：

```powershell
cd windows
npm.cmd ci
npm.cmd run dev
npm.cmd run check
npm.cmd run test:dev
npm.cmd run pack:win
npm.cmd run test:package
npm.cmd run dist:win
```

本次机器的便携 Node/npm 放在忽略提交的 `.tools/node-v24.22.1-win-x64/`。本机无需修改全局 PATH，也可使用：

```powershell
cd windows
.\quillhaya.cmd run dev
.\quillhaya.cmd run check
.\quillhaya.cmd run dist:win
```

完整检查包括类型检查、生产构建、126 项单元测试和 64 项 Electron 界面测试。打包验收另用真实 EXE 检查系统加密、密钥重启后本地 HTTP 调用、草稿、暂停、收藏、撤销、包内容和图标。实际结果见 [VALIDATION.md](VALIDATION.md)。

`npm.cmd run test:installer` 会临时安装、重新安装并卸载本包，检查快捷方式与注册信息；检测到已有 Quillhaya 安装、快捷方式或安装器缓存时会拒绝运行，建议用于干净测试账户。此脚本仅对本次进程设置 PowerShell 执行策略，不修改系统执行策略。

## 数据与维护

- 安装版数据：系统 appData 下的 `Quillhaya`；开发版：`Quillhaya Development`，相互独立。
- 密钥由 Windows 系统加密；草稿和收藏是本地明文文件。普通卸载保留用户数据。
- 测试仅用 `QUILLHAYA_TEST_USER_DATA` 指定的临时目录、合成内容和本地服务，不读取真实模型配置。
- 不编辑 `.workspace/`：它由根源码和 `platform/adaptations.json` 自动生成。源文件变化会触发 SHA256 和片段匹配校验失败，需要审查并更新 Windows 补丁。
- 原羽毛图案已保留，图标生成命令为 `npm.cmd run icons`，不依赖 Xcode、Swift 或 Git Bash。
- [IMPLEMENTATION.md](IMPLEMENTATION.md) 说明源码复用、构建隔离、平台差异和维护方式。

系统中文输入法人工验收、不同显示器的真实 DPI、跨版本升级、干净账户测试和真实 Ollama 模型联调仍需补充；已完成的模拟 IME、页面缩放、本地协议测试不能代替这些验证。

---

<details>
<summary>原始 Windows 开发交接（历史记录，以下待办状态已由上方实现及验收文档取代）</summary>

# Quillhaya Windows 开发交接

交接日期：2026-11-14。本文供在 Windows 上继续工作的 Codex 阅读。

**本次只建立 `windows/` 并编写交接文档，尚未实现或验证 Windows 版本。后续目标是在 Windows 上运行、测试和打包 Quillhaya，同时保持现有 macOS 工程与开发环境不变。**

## 1. 用户要求与工作边界

用户要求：

> 将 Quillhaya 也打包出 Windows 版本。为分隔 Windows 和 Mac 开发内容，在根目录单独建立 windows 文件夹，仅在其中加入 Windows 相关代码，不改变 Mac 的开发环境。之后由 Windows 上的 Codex 继续。

后续实现应遵守：

- 所有 Windows 专用代码、配置、脚本、依赖清单及锁文件、测试、资源和文档放在 `windows/` 内。
- Windows 构建产物、暂存源码、缓存及测试报告也写在 `windows/` 内；系统临时测试数据使用独立临时目录。
- 根目录的 `package.json`、`package-lock.json`、`electron.vite.config.ts`、`tsconfig.json`、`run.sh`、`electron/`、`src/`、`scripts/`、`tests/`、`icon/` 作为现有 macOS 工程保留，允许只读参考和复用，不为 Windows 适配直接改写。
- 不在根目录安装或升级依赖，不复用从 Mac 拷来的 `node_modules`，不向根目录的 `out/`、`dist/` 或 `icon/generated/` 写入 Windows 产物。
- 如确实必须调整共享源文件，先说明具体原因与影响，请用户重新确定范围；不要默默扩大修改范围。
- 当前只交接，不安装 Windows 工具链，不生成 EXE，也不重新打包 DMG。

## 2. 已核对的项目基线

| 项目 | 当前状态 |
| --- | --- |
| 应用名 | Quillhaya |
| 窗口/界面标题 | Quillhaya - Writing Assistant |
| 版本 | `1.0.3` |
| 分支 | `dev` |
| 本次读取时的 HEAD | `08d8ed6544910018240fd46573e78b38e837c0ef`（`add Collection`） |
| 本次开始时工作区 | 干净；后续接手必须重新检查，不覆盖届时已有改动 |
| 应用 ID | `com.zloyan.quillhaya` |
| 已有安装包 | `dist/Quillhaya-1.0.3-arm64.dmg`，Apple Silicon Mac |
| macOS 发布状态 | ad-hoc 签名，未公证；没有配置自动更新 |
| Node 要求 | 根工程声明 `>=22.12.0` |
| 后端 | Electron 主进程中的 Node.js/TypeScript；没有 Python 后端 |

当前 Mac 工作目录为 `/Users/zhaoyanximo/AIhzHuang/Project/Quillhaya`。历史聊天中的 `untitledProject` 路径已经过时；Windows 上应从实际检出的仓库位置计算路径，不能硬编码本机路径。

按当前根锁文件读取的版本：Electron **44.7.0**、electron-builder **26.15.3**、electron-vite **4.0.1**、Vite **6.4.4**、React **19.3.0**、TypeScript **5.9.3**、Zod **3.25.76**、CodeMirror view **6.43.14**、Vitest **5.0.3**、Playwright **1.64.0**。这是已有工程的版本记录，不能理解为对未来版本或 Windows 兼容性的保证；后续先核对实际锁文件及对应官方文档，避免无关升级。

2026-11-03 的 macOS 验收记录包括 126 项单元测试、59 项 Electron 界面回归，以及布局调整后的 6 项收藏定向复验。1.0.3 DMG 实测过收藏、排序、取消收藏、草稿及暂停状态的重启恢复。这些是历史 Mac 验收结果，**不是 Windows 测试结果**，本次交接也未重新执行它们。

## 3. 功能及实现入口

需要在 Windows 上保留的主要功能：

- Markdown 写作，Academic Discussion / Email Writing / General English 三种模式，题目与情境输入。
- 单句自动反馈、选区分析、主动全文分析；中文解释及英文建议。
- 用户主动接受修改、忽略、重新评估、复制推荐句、撤销；反馈到达不能打断输入或跳动光标。
- 多模型配置及连接测试；Mock、Ollama 和 OpenAI-compatible 服务；每个模型的补充提示词。
- 暂停自动分析、停止请求并释放本应用使用的 Ollama 模型，重启保持暂停。
- Markdown 打开/保存/另存为、自动草稿、外部文件冲突检测、重启恢复。
- 反馈收藏：完整结果快照、时间逆序、自定义上下移动、取消收藏、重启恢复。
- 明暗主题、字号、反馈栏调整、字数统计、计时器、右键编辑和反馈定位。

| 源文件/目录 | 职责 |
| --- | --- |
| `electron/main.ts` | 应用身份、窗口、原生菜单、安全设置、白名单 IPC、退出清理 |
| `electron/preload.ts` | 固定能力桥接，不能开放任意 IPC 或 Node 能力 |
| `electron/context-menu.ts` | 原生编辑菜单、反馈定位；系统词典查询当前仅适用于 macOS |
| `electron/llm/provider.ts`、`response-schema.ts` | 模型协议、提示词、结构化输出与返回值校验 |
| `electron/llm/queue.ts`、`runtime.ts`、`ollama.ts` | 排队、取消、运行状态与 Ollama 释放 |
| `electron/storage/identity.ts`、`store.ts` | 开发/安装身份、配置、草稿、系统加密凭据 |
| `electron/storage/documents.ts` | 文件对话框、读写、冲突检测、保存确认 |
| `electron/storage/favorites.ts` | 收藏的校验、原子写入、串行更新和恢复 |
| `src/App.tsx`、`src/main.tsx` | 界面编排、应用入口、错误恢复 |
| `src/core/coordinator.ts`、`sentences.ts` | 分句、去抖、缓存、上下文与过期响应防护 |
| `src/editor/WritingEditor.tsx` | CodeMirror 输入、标记、明确接受修改及撤销 |
| `src/models/schema.ts`、`favorites.ts` | 共享类型、Zod 校验、IPC 契约与收藏结构 |
| `src/components/`、`src/styles/` | 卡片、设置、收藏夹、主题及布局 |
| `tests/unit/`、`tests/e2e/` | 可参考或复用的逻辑和 Electron 行为测试 |

数据流：编辑器 → 分句/调度 → preload 白名单 → 主进程校验/队列 → Provider → 校验结果 → 反馈卡片。未经用户接受不得把模型建议写回正文。IPC 成功返回结构是 **`{ ok: true, value: ... }`**，不是 `data`。

## 4. 推荐的目录与隔离实现

建议做成 **Windows 独立 npm 工程，根业务源码只读复用**。以下是后续建议布局，目前除本 README 外均未创建：

```text
windows/
  README.md                   本交接文档，之后补充实际启动说明
  package.json                独立脚本、依赖与应用元数据
  package-lock.json           Windows 工程自己的可复现依赖锁
  .gitignore                  暂存目录、产物、缓存与测试报告
  electron.vite.config.ts     Windows 构建入口与全部输出路径
  electron-builder.yml        Windows 安装包配置
  tsconfig.json
  vitest.config.ts
  playwright.config.ts
  platform/                   Windows 主进程/界面适配文件
  assets/                     图标源文件、PNG、ICO
  scripts/                    准备源码、图标、启动、打包验证
  tests/                      Windows 专用及适配后的测试
  IMPLEMENTATION.md           最终实现与维护方式
  VALIDATION.md               实际执行命令和结果
  .workspace/                 自动生成的源码暂存区，不提交
  out/                        Windows 编译产物，不提交
  dist/                       Windows 安装包，不提交
```

推荐实现顺序：

1. 在 `windows/` 建立独立依赖与脚本，保留与当前业务源码相容的依赖版本。不要将该目录注册成需要改写根配置的 npm workspace。版本先以 `1.0.3` 为功能基线，发布编号在 Windows 工程中管理。
2. 准备脚本只读复制需要的根 `electron/`、`src/`、`index.html` 到 `windows/.workspace/`，保留相对目录结构；按白名单选择文件，不复制整个仓库或任何用户数据。把 Windows 适配文件覆盖到暂存区，生成的源码不手工维护。
3. 窗口、快捷键文案及存储报错若需要修改，修改 `windows/platform/` 内的适配实现，构建时应用到暂存副本；不要改根文件。对覆盖文件记录来源版本、差异和维护方法；共享源码变化时校验兼容，避免无提示沿用过时副本。不要依赖无校验的全局字符串替换。
4. 让 Vite 的 main/preload/renderer 入口、TypeScript 检查范围、依赖解析和缓存都明确指向 Windows 工程。配置路径应基于配置文件所在目录解析，不能依赖调用者正好位于某个 cwd。
5. 根 `src/App.tsx` 导入 `../icon/generated/app-icon.png`；暂存副本必须有对应资源，或在 Windows 配置/适配入口明确重定向。不能因此运行 Mac 图标脚本或回写根图标目录。
6. 编译产物维持 main、preload、renderer 的相对布局；主进程仍能找到 `../preload/preload.cjs` 和 `../renderer/index.html`。沙箱 preload 保持 CJS。
7. Windows 包的 `main` 指向自己的 `out/main/main.js`，构建器只包含自己的编译产物、包元数据、必要生产依赖和资源。依赖安装、打包配置、图标、输出目录都显式落在 `windows/`。

如果实际检验后采用直接只读引用根源码、配合 Windows 入口或模块映射的方式，也可以，但必须证明所有解析、缓存和输出均隔离。不能为了少写一个 Windows 配置而修改现有 Mac 构建。

## 5. 已发现的适配点

### 构建、资源和安装包

- 根 `package.json` 的 `predev` / `prebuild` 会调用 `xcrun swift scripts/prepare-icons.swift`，脚本依赖 CoreGraphics、ImageIO 和 `/usr/bin/iconutil`。因此 Windows 工程不能转调根 `npm run dev/build/dist:mac`。
- `run.sh`、`scripts/dev-smoke.mjs` 使用 Bash 和 Unix 进程组；`scripts/package-smoke.mjs` 限定 macOS，检查 `.app`、Info.plist 和系统钥匙串。这些入口需要 Windows 自有等价实现。
- Windows 启动优先使用 npm 脚本/Node；如提供 PowerShell 启动脚本，处理带空格和中文路径，避免要求 Git Bash、Xcode 或修改系统执行策略。
- 在目标 Windows 机器重新安装 Electron 运行时和依赖，不复制 Mac 的二进制或缓存。
- 初始建议产出 **Windows x64 NSIS 安装程序 `.exe`**，先验证 unpacked 目录内程序，再测试安装版。x64 是默认建议，不代表用户已指定架构；接手后先检查目标机器，ARM64 需求单独确认。便携版属于可选项。
- 应用名继续使用 Quillhaya，建议继续使用 `com.zloyan.quillhaya`，并核对任务栏 AppUserModelID 与安装快捷方式身份。Windows 构建配置不继承 macOS 的 `identity: "-"`、DMG 或 ICNS 选项。
- 用户提供的羽毛图案必须保留，不重新绘制。Windows 资源在 `windows/assets/` 生成多尺寸 ICO 与 PNG，实测任务栏、窗口、安装器和高 DPI 下的显示。主界面左上角名称旁不要重新添加图标。
- **根 `icon/*` 被 Git 忽略**：仅克隆 Git 仓库不一定有 `icon/icon.png`。迁移时需要另外携带原始羽毛图；可检查仓库内 `docs/quillhaya-icon.png` 是否足以作为现有图案来源，但不要未经核对把展示图片当作原始素材。此交接没有复制图标。 (GIT忽略问题已修复)
- 独立设置安装器产物命名（包含版本、Windows、架构），不要覆盖 Mac 的 `dist/`。未配置正式 Windows 签名时如实记录；不要承诺消除 SmartScreen 提示，也不要自动发布安装包。

### 窗口、快捷键和交互

- `electron/main.ts` 当前使用 `titleBarStyle: 'hiddenInset'` 与 `trafficLightPosition`；`src/styles/app.css` 的 `.titlebar` 左侧保留 98px 空间。Windows 入口应选择合适的原生标题栏及布局，验证最小化、最大化、关闭、拖拽与双击，不保留 Mac 三色按钮空位。
- 主进程菜单大多已使用 `CmdOrCtrl`，但“设置…”快捷键当前只位于 macOS 应用菜单。Windows 需检查设置入口和 `Ctrl+,` 是否一致。
- `src/App.tsx` 的保存、新建、打开、设置提示，以及接受修改后的撤销提示含硬编码 `⌘`。Windows 界面应显示实际可用的 `Ctrl` 组合键，并验证编辑器、题目输入和设置字段的撤销/全选行为。
- 保留非 macOS `window-all-closed → app.quit()` 行为；验证 X、Alt+F4、菜单退出都经过保存确认、草稿落盘、收藏写入和模型释放流程，取消关闭后仍能继续编辑。
- 系统词典查询目前通过 `process.platform === 'darwin'` 限定。Windows 保留剪切/复制/粘贴/全选/反馈定位，不能承诺已有 macOS 系统词典能力，也不为替代词典自动上传选中文本。
- 在 Windows 中文输入法、明暗主题、100%/125%/150% 缩放、940px 最小窗口下验收：正文输入、按钮点击、收藏弹窗、长文本及反馈栏不遮挡、不溢出。

### 存储与密钥

- 安装版应用名为 `Quillhaya`，开发版为 `Quillhaya Development`。应用在 Electron 初始化加密组件前确定身份，使用 `app.getPath('appData')` 拼接各自目录，并设置 `userData`。Windows 延续开发/安装隔离，实际目录运行时核验，不硬编码 Mac Application Support 路径。
- `settings.json` 保存非密钥设置，`credentials.json` 保存系统加密密文及端点绑定信息，`draft.json` 保存草稿，`favorites.json` 保存完整反馈及排序。草稿/收藏是未加密本地文本。
- 用户明确要求应用使用自己的身份和凭据，不读取旧应用名称下的数据，不自动迁移旧密钥。也不要将 Mac 的加密凭据直接拷入 Windows 并假定可解密。
- 当前使用 `safeStorage.isAsyncEncryptionAvailable`、`encryptStringAsync`、`decryptStringAsync`。Windows 接手时核对所选 Electron 版本对这些接口的支持，并在真实 Windows 安装版验证可用性、保存、退出及再次使用。
- 继续保持：bootstrap/打开设置只检查密钥保存状态，不解密；模型调用需要密钥时才异步读取。凭据同时校验端点、认证类型及请求头绑定，防止更换地址后误发旧密钥。
- 系统加密失败不能报告保存成功、不能覆盖已保存凭据、不能改用明文。当前报错含“请解锁钥匙串”，Windows 适配应给出符合实际系统的提示，保持错误处理行为。
- 当前文件创建使用 `0700/0600`，原子更新使用临时文件加 rename。Windows 上需要实际验证权限与替换行为，不能把 POSIX 权限位直接当作 Windows ACL 的证明；写入失败需保留原数据并可重试。
- 支持中文/空格路径、Windows 路径分隔符及 CRLF；继续使用 `node:path` 和 URL API，不手拼 `file://` 路径。

### 测试入口

- `tests/e2e/editor.ts` 已按系统区分 Meta/Control；其他用例仍有 `Meta+z`、`Meta+End`、`Meta+ArrowUp`、`Meta+A` 和 `/private/tmp/...`。Windows 测试需逐项按动作语义适配，不直接把所有 Meta 字样机械替换成 Control。
- 根收藏存储测试有 `0600` 权限断言，根系统词典测试及包验证也有平台条件。保留共同业务断言，在 Windows 副本中适配平台断言，不通过跳过核心流程制造“全绿”。
- Windows 的 Vitest/Playwright 配置应指向自己的构建、测试与报告目录，截图放在 `windows/` 内，不能覆盖根 `docs/` 的 Mac 截图。
- E2E 使用 Electron 自身及临时 Mock/HTTP 服务；真实 Ollama 联调要单独记录环境及结果，不能把 Mock 通过当作模型兼容性验证。

## 6. 必须延续的产品决策与安全边界

1. 修改一句之后，附近未改句子的旧反馈保留，必要时标注“上下文已变化”，由用户手动重新评估。不要恢复自动连锁重评。
2. 重新分析时仍展示旧结果；修改了原句时旧建议不能直接覆盖新正文。不要在用户界面展示模型审议所用的前后文列表。
3. 模型输出通过结构与语义校验；用户不希望为每个模型错误例子不断新增显式提示词规则。Windows 移植不应顺带重写提示词或模型判断策略。
4. 分析超时与排队区分，保留现有请求令牌、取消、过期结果及跨文档防护；不因平台迁移再次分析已经完成且未改动的句子。
5. 暂停/停止状态跨重启保留。收藏保存的是当次反馈中的原文及完整结果，不是后来已编辑的正文；排序和删除完成落盘后再更新 UI。
6. 维持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`、CSP、主窗口 IPC 来源校验及参数校验，不能通过关闭这些保护解决路径或加载问题。
7. 测试必须使用 `QUILLHAYA_TEST_USER_DATA`：启动前确认新构建识别该变量，启动后核对实际 `app.getPath('userData')` 等于临时目录，路径比较考虑 Windows 规范化。验证通过前不能写设置、密钥或草稿。
8. 历史上曾因运行不识别隔离变量的旧构建误写真实模型配置及凭据，已向用户披露，用户不要求恢复旧备份。这个问题不需要重新调查，但隔离检查必须保留，不能再次测试真实用户目录。
9. 只使用合成 API Key、合成作文、Mock 或本地测试服务；包内禁止包含个人配置、凭据、草稿和收藏。不要请求用户把真实 API Key 写进交接文档或日志。
10. 面向用户的介绍沿用 Quillhaya 名称与通用英语写作场景，避免沿用旧考试品牌名称。

## 7. Windows 接手后的执行清单

以下都是**待办**，并非已完成的功能或已存在的命令。

- [ ] 阅读本文件、核对当前分支/提交/未提交改动，确认 Windows 版本、CPU 架构、Node/npm 与图标素材。
- [ ] 建立 `windows/` 独立依赖、锁文件、忽略规则和准备源码流程，验证不会写根工程。
- [ ] 完成 Windows 图标、构建配置、窗口、快捷键文案、菜单与系统存储提示适配。
- [ ] 提供 Windows 工程内可执行的 `dev`、`typecheck`、`test`、`build`、`test:e2e`、`pack:win`、`dist:win`、`test:package` 等脚本；按实际实现记录准确命令。
- [ ] 在真实 Windows 上运行类型/逻辑检查和界面回归：输入与撤销、模型设置、反馈、收藏、文件读写、关闭确认、暂停及重启恢复。
- [ ] 用临时数据先验收 unpacked EXE，再生成安装程序，在干净测试账户或隔离环境完成安装/启动/退出/升级/卸载验证。卸载和升级的用户数据保留策略要明确，避免静默删除。
- [ ] 安装版验证合成密钥加密保存、同一 Windows 账户重启后调用本地测试服务；磁盘及返回给界面的数据无明文 Key。开发版与安装版数据互不读取。
- [ ] 检查 app.asar 与安装资源清单，确认只包含应用文件，检查版本、应用名、图标、架构与产物路径。
- [ ] 将实现方法、源码复用/覆盖方式、技术栈、实际测试记录与剩余限制写在 `windows/IMPLEMENTATION.md`、`windows/VALIDATION.md`。
- [ ] 最后用 Git diff 确认所有改动都在 `windows/`，确认根依赖、源码和 Mac 资源无变化；不要宣称本次执行了未运行的 Mac 回归。

建议完成后在 Windows 工程支持如下使用流程（**目前尚不可执行**）：

```powershell
cd windows
npm ci
npm run dev
npm run check
npm run pack:win
npm run test:package
npm run dist:win
```

自动测试通过后，提供可定位的 Windows 安装包路径和准确的签名状态。不要仅以编译成功或生成 EXE 为完成标准。

## 8. 继续阅读

以下链接相对于本文件，可在整份仓库迁移后继续使用：

- [应用介绍与现有功能](../README.md)
- [整体技术实现](../docs/IMPLEMENTATION.md)
- [macOS 打包说明，仅供理解当前边界](../docs/PACKAGING.md)
- [独立数据与密钥存储](../docs/STORAGE-ISOLATION.md)
- [暂停状态持久化](../docs/ISSUE1030-2-IMPLEMENTATION.md)
- [完整反馈收藏实现](../docs/ISSUE1103-IMPLEMENTATION.md)
- [图标资源与 macOS 适配](../docs/ICON-ADAPTATION.md)
- [历史实际验收记录](../docs/VALIDATION.md)
- [测试数据隔离入口](../tests/e2e/isolated-electron.ts)

`issues/*`  当前被根 Git 忽略；不要假定 Windows 克隆后一定拥有历史 issue 或原始素材。上面的已跟踪文档和源文件是接手的主要依据；运行时仍以接手时实际仓库状态为准。

</details>
