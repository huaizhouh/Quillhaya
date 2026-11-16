# Windows 验收记录

实现与自动测试日期：2026-11-14；最终复核：2026-11-15（中国标准时间）。机器为 Windows 11 x64，系统构建 10.0.26200，主屏系统缩放 125%。开始时分支为 `main`，最终复核时为 `dev_win`；基线提交 `b8e328a62dedd234b6a00538a47df452412af694`。本任务没有切换分支。移植开始时 `windows/README.md` 已有用户修改，已原样保留在历史交接部分。

工具链为本目录内便携 Node 24.22.1 / npm 11.19.1；Electron 44.7.0、electron-builder 26.15.3、electron-vite 4.0.1、Vite 6.4.4、TypeScript 5.9.3、Vitest 5.0.3、Playwright 1.64.0。所有直接依赖版本与根锁文件一致，没有升级 Mac 依赖。

## 实际执行

命令均在 `windows/` 执行；本机使用 `.\quillhaya.cmd` 或 `.tools/node-v24.22.1-win-x64/` 中的 Node/npm。工具执行时因沙箱网络、文件 realpath 和 GUI 进程权限使用了经审批的沙箱外运行，应用本身的 Electron sandbox 从未关闭。

| 检查 | 结果 |
| --- | --- |
| `npm.cmd ci` | 独立安装依赖；官方 Electron 下载完成并校验 SHA256 |
| `npm.cmd ci --offline` | 使用本目录缓存重新安装 434 个包，postinstall 成功；验证独立锁文件可重现 |
| `npm.cmd run check` | 最终带高缩放修正的版本：类型检查、生产构建、126/126 项单元测试、64/64 项界面回归全部通过；无跳过、无失败 |
| `npm.cmd run test:dev` | 实际 electron-vite dev 启动成功；HTTP renderer、preload、CSP、沙箱、写作反馈、隔离数据和退出清理通过 |
| `npm.cmd run pack:win` / `dist:win` | x64 unpacked 程序及 NSIS 安装程序成功生成 |
| `npm.cmd run test:package` | 真实 EXE 的身份、版本、架构、包清单、图标、沙箱、修改/撤销、收藏、草稿/暂停重启、原生加密与认证请求通过 |
| `npm.cmd run test:installer` | 当前账户的独立中文/空格目录安装成功；快捷方式目标和 AppUserModelID 正确；安装版冒烟、同版本重装及再次冒烟通过；卸载清理 EXE、注册信息与快捷方式 |
| `npm.cmd run verify:source` | 53 个共享输入源文件未改变 |
| 基线 SHA256 审计与 Git 状态 | `windows/` 之外 129 个已跟踪文件逐字节不变；所有新增/修改文件均在 `windows/` |

包测试会在启动前检查 ASAR/main 支持 `QUILLHAYA_TEST_USER_DATA`，启动后核对真实 userData 路径，再写合成数据。安装测试拒绝覆盖已有安装、快捷方式或安装器缓存；本次没有预先存在的 Quillhaya 安装。测试产生的系统注册、快捷方式和安装器缓存均已清理，用户真实 appData 未用于测试。

安装验收使用当前 Windows 账户的隔离安装与数据目录，**并非干净 Windows 账户或虚拟机验收**。机器没有 Windows Sandbox。重装验证使用同一 1.0.3 包，不能替代未来跨版本升级测试。

原生窗口目视检查确认了羽毛图标、Windows 标题栏、菜单，以及标题栏双击最大化/还原。拖动操作没有观察到窗口位置改变，因此不记为通过；需后续人工复核。临时目视检查进程在等待关闭时超时；2026-11-15 复核已无 Quillhaya 测试窗口或工作区测试进程，预览合成数据及早先失败下载的临时文件均已清理。这一临时检查不属于上述 64 项通过的自动回归。

## 测试中发现并处理的问题

- 复制根项目的 Mac 快捷键、菜单首项、POSIX 权限断言与绝对截图路径不适合 Windows，均在有 SHA256/片段数量保护的暂存补丁中按平台语义调整。
- Windows 高 DPI 下 `setContentSize` 存在小范围取整；布局断言允许最多 2 CSS 像素尺寸误差，仍检查卡片操作布局。
- Playwright CDP 键盘注入不触发 Electron 原生菜单加速键；菜单快捷键测试改为 Electron `sendInputEvent`，编辑器快捷键仍使用实际键盘事件。
- 非 100% 页面缩放时 CDP 截图会裁切 Electron 内容，改为原生 `webContents.capturePage()`。弹窗实际边界正常；额外发现 150% 页面缩放下原 530px 最小高度挤出编辑底栏，增加 Windows 紧凑布局后修复。
- 100% / 125% / 150% 页面缩放均检查收藏弹窗、设置弹窗和底栏可见边界，设置表单无横向溢出，模拟 IME 组合输入成功。截图已目视复查。
- Electron 安装器在当前代理环境的 Node 下载发生停滞，改从同一官方 GitHub 发布地址下载，并按 Electron 包内 checksums.json 验证；后续离线安装直接使用已校验缓存。
- 打包验收脚本修正 ASAR API 在 Windows 上要求的原生路径分隔符。

Electron Windows x64 官方压缩包 SHA256：`eee30dc8fa1f5ea95490e59f44e46ea68dd24c6e93d22facf70fe5c2d4c2665c`。

## 产物及记录

- 安装程序：`dist/Quillhaya-1.0.3-Windows-x64-Setup.exe`
- 未安装版：`dist/win-unpacked/Quillhaya.exe`
- 签名状态：应用与安装程序均由 `Get-AuthenticodeSignature` 确认为 **NotSigned**。打包器输出“signing with signtool.exe”不代表实际签名成功；未配置证书，没有发布。
- 报告：`reports/e2e.json`、`reports/installer.txt`、`reports/package-files.txt`、`reports/audit.json`
- 截图：`reports/screenshots/`，含明暗主题、收藏、设置、开发启动、安装版和三个缩放比例。全部为合成数据。

最终安装包的大小与 SHA256 见 `reports/audit.json`；该文件由基线审计生成，同时确认 ASAR 内所有 `out/` 文件与最终生产构建一致。

本次最终安装包：112,742,485 字节（约 107.5 MiB）；SHA256 为 `a34a06fe969024de4115b85af080830489239ad0faae40407ece91a04e2d36b4`。

## 尚未覆盖

- 原生系统中文输入法候选窗与连续组合输入的人工作业；当前是 Chromium IME composition 自动化验证。
- 原生标题栏鼠标拖动与不同 DPI 下任务栏图标的人工复核。
- 不同显示器、不同系统 DPI、ARM64 与其他 Windows 版本；当前仅本机 x64，额外测试的是页面缩放。
- 真实 Ollama 模型和外部 OpenAI-compatible 服务；已有测试使用 Mock 或本地 HTTP/Ollama 协议夹具，不代表真实模型联调通过。
- 干净账户/虚拟机、跨版本升级、生产证书签名和 SmartScreen 信任验证。
- 普通卸载保留用户数据的策略已明确配置并核对 NSIS 模板；未用用户真实 appData 做删除或保留试验。
- 没有运行 Mac 回归，也没有重新构建 DMG。
