# issue1029：Quillhaya 命名、图标与文档整理

日期：2026-10-29。对应 [issues/issue1029.md](../issues/issue1029.md)。项目已移至 `Quillhaya`；沿用 Electron、React、TypeScript、Vite、electron-builder、Vitest 和 Playwright，没有新增依赖。

> 2026-10-29 晚间追加：用户更换为羽毛图标，并反馈 Dock 大小不协调。当前图标生成路径和留白参数已更新，详见 [图标适配说明](ICON-ADAPTATION.md)；以下保留首次命名调整的实现记录。

## 技术栈与职责

| 技术 | 本次职责 |
| --- | --- |
| Electron / TypeScript | 管理应用名、窗口标题、原生菜单、开发模式 Dock 图标与已有密钥存储兼容 |
| React / CSS | 更新界面品牌文字、启动页和左上角 PNG 图标 |
| Vite / electron-vite | 将 PNG 导入编译为本地静态资源，生成主进程、preload 和页面产物 |
| electron-builder | 从 productName 和 ICNS 生成 macOS arm64 应用与 DMG |
| Vitest / Playwright | 校验菜单标签、真实 Electron 界面、打包资源和加密数据兼容性 |

CodeMirror、模型调用、结构化返回校验及反馈调度沿用现有实现。本次没有引入新的分析规则。

## 完成内容

| 要求 | 实际实现 |
| --- | --- |
| 右键查询只显示中文 | 原生菜单标签从“查询（Look Up）”改为“查询”，仍调用原有系统词典接口 |
| 使用 icon/ 的图标 | 打包采用 `icon/icon.icns`；左上角、启动页及开发模式 Dock 采用 `icon/icon.png` |
| 正式应用名 Quillhaya | npm 包、打包 productName、运行时应用名、系统菜单及新产物命名全部更新 |
| 主界面名称 | 窗口标题、HTML 标题、左上角及启动错误页统一为 `Quillhaya - Writing Assistant` |
| README 清理 | 去掉 TOEFL/toefl 标识、Conda 环境说明、环境文件条目及 Conda 故障排查；保留 Node/npm 启动方法 |
| README 不包含打包教程 | 打包说明单独放入 [PACKAGING.md](PACKAGING.md)，README 不再包含打包步骤 |

模型提示词、分析规则、模式和请求协议均未修改。模型中的考试或英语写作语义不随品牌文字做全局替换。`run.sh` 缺少 Node 时改为提示直接安装 Node，不再要求激活 Conda。

## 名称和资源如何生效

1. `package.json` 与 `package-lock.json` 的包名同步为 `quillhaya`；`build.productName` 设置为 `Quillhaya`，生成 `Quillhaya.app` 和对应 DMG。1.0.0 当时保留原 Bundle ID；1.0.1 按独立存储要求改为 `com.zloyan.quillhaya`。
2. `build.mac.icon` 指向现有 ICNS。打包验证从 Info.plist 读取实际图标文件，再与源文件比较字节。
3. `App.tsx` 导入 PNG，由 Vite 复制为带哈希的静态资源；生产包可离线显示，不依赖源码目录或外部图片地址。
4. 源码开发模式在 ready 后设置 Dock 图标；打包版本使用系统读取的 ICNS，无需依赖工程内的 PNG 路径。
5. HTML 标题和 BrowserWindow 初始标题同时更新，防止页面加载后把新窗口名覆盖回旧名。

代码入口：[package.json](../package.json)、[main.ts](../electron/main.ts)、[App.tsx](../src/App.tsx)、[index.html](../index.html)、[context-menu.ts](../electron/context-menu.ts)、[package-smoke.mjs](../scripts/package-smoke.mjs)。

## 存储兼容性（历史方案，1.0.1 已撤销）

**以下兼容方案已按用户要求撤销。当前实现不再读取旧目录或旧钥匙串，详见 [STORAGE-ISOLATION.md](STORAGE-ISOLATION.md)。**

沿用原有用户目录 `~/Library/Application Support/TOEFL Writing Assistant/`，不迁移、复制或删除用户文件。已有 `settings.json`、`credentials.json` 和 `draft.json` 继续读取；测试目录覆盖变量也保持不变。

不能简单地在主进程最开始将 `app.setName()` 改为 Quillhaya：当前 Electron 44.7.0 在初始化时以应用名设置 macOS Keychain service/account。改变该命名空间可能使之前保存的密钥不能解密。依据：[Electron 44.7.0 的初始化源码](https://github.com/electron/electron/blob/v44.7.0/shell/browser/electron_browser_main_parts.cc#L597-L639)。

实际做法是在 ready 之前保留旧名字供内部密钥存储初始化，在 `app.whenReady()` 回调开头改为 `Quillhaya`，随后再创建菜单和窗口。最终 `app.getName()` 和用户看到的菜单都是新名称；保留的旧字符串只用于数据兼容，不作为前台品牌显示。没有把密钥导出为明文或要求重新保存所有配置。

增加 `tests/fixtures/legacy-storage.cjs` 复现旧命名空间，仅接受隔离测试目录；用旧名称进程加密合成字符串，再分别用新源码应用和新打包应用解密。Playwright 会给源码启动注入 `use-mock-keychain`，因此兼容用例在首次加解密前移除相关模拟开关，打包冒烟另断言该开关不存在，确保验证真实系统钥匙串。

本次还将上一版 `Writing Assistant-1.0.0-arm64.dmg` 只读挂载，用其中的实际旧应用加密合成字符串，再由新 `Quillhaya.app` 成功解密。macOS 对新应用的钥匙串访问弹窗由用户手动允许，测试没有修改系统访问控制。这项旧兼容验证现已移除；1.0.1 改为验证新应用独立保存及重启读取。

## 文档与项目迁移

- 当前总技术说明更新项目名及直接使用 Node/npm 的环境说明。
- 历史问题说明中的链接从 `../issue/` 修正为 `../issues/`，历史记录的时间与结论保留。
- README 主界面截图随本次回归更新；历史问题截图保留原始记录。
- 用户已经修改的 `.gitignore` 和 issues 目录迁移保持原状；图标仍按现有忽略规则由本地提供，不擅自改变版本管理策略。

## 验证方式

复用现有单元测试与界面回归，更新“查询”标签断言，并补充运行时名称、菜单名、标题、图标成功加载及旧密文兼容验证。打包冒烟增加实际 ICNS、Bundle 名称和旧密文的检查。全部验证使用临时数据目录和合成凭据，不调用真实模型。

实际执行命令与结果见 [VALIDATION.md](VALIDATION.md)。安装包生成方式和签名状态见 [PACKAGING.md](PACKAGING.md)。
