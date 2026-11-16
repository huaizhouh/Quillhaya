# Windows 实现

Windows 工程独立位于本目录，应用版本为 1.0.3，默认构建 x64 NSIS 安装程序。共享业务源代码来自根工程；没有修改 Mac 的源码、依赖清单、锁文件或图标。

## 构建与源码复用

- `package.json` 的依赖版本精确固定为交接时根锁文件的版本，并保留完整独立锁文件。安装只在本目录执行。
- React、CodeMirror 等渲染库打入前端产物，在 Windows 工程列为开发依赖；运行时只保留主进程外置的 Zod，避免重复打入整套前端依赖。`after-pack.cjs` 移除 Electron 分发包自带的欢迎应用。
- `scripts/prepare.mjs` 按文件类型白名单复制 `electron/`、`src/`、`tests/` 和 `index.html` 到 `.workspace/`，拒绝符号链接；每次重新生成暂存区，防止已删除源文件残留。
- `platform/adaptations.json` 保存每个需适配源文件的 SHA256（统一 LF 后计算）、原片段、替换片段和预期出现次数。源码或锚点变化会立即停止构建，维护者必须审查差异再更新，不能只刷新哈希绕过审查。
- `.workspace/` 是生成结果，不手工编辑。新增补丁必须在 `platform/` 管理。源码基线为 `b8e328a62dedd234b6a00538a47df452412af694`，保留移植开始时 README 的用户改动。
- `electron.vite.config.ts` 根据自身位置设置输入、缓存和输出。main/preload/renderer 相对布局保持原状，preload 仍为沙箱可用的 CJS。Node、npm、Electron 下载缓存、builder 缓存和测试报告都在本目录。
- `scripts/run.mjs` 切换到 Windows 工程目录；可从仓库根目录执行 `node windows/scripts/run.mjs build`。npm 安装应先进入 `windows/`。
- `scripts/install.mjs` 显式执行锁定依赖的 esbuild/Electron 安装入口，兼容默认限制依赖生命周期脚本的 npm 版本。

## 平台差异

使用 Windows 原生标题栏和窗口按钮，移除 Mac 三色按钮预留空间。文件菜单提供 `Ctrl+,` 设置入口和退出；界面中的保存、打开、新建、撤销、错误恢复和复制提示采用 Windows 组合键。设置页装饰不再使用 Command 符号。右键仍使用原生剪切、复制、粘贴、全选和反馈定位，Windows 不提供 macOS 系统词典项。

`platform/windows.css` 为高度不足或页面放大的窗口提供紧凑布局，防止编辑底栏被根工程的 530px 最小高度挤出视口；窄窗口下设置表单改为单列。缩放截图使用 Electron 原生 `capturePage`，避免 CDP 截图在非 100% 页面缩放时裁切内容；同时验证弹窗和底栏的真实 DOM 边界。

应用及快捷方式身份为 `com.zloyan.quillhaya`，运行时显式设置 AppUserModelID。开发版名为 `Quillhaya Development`，安装版名为 `Quillhaya`，由 `app.getPath('appData')` 计算各自数据目录。没有旧名称数据迁移逻辑。

密钥继续使用 Electron 异步 safeStorage；Windows 底层为 DPAPI。打开设置和 bootstrap 不解密，模型请求才读取密钥，仍校验端点与认证信息绑定。系统加密失败不使用明文、不报告成功，提示改为 Windows 账户与系统加密服务。DPAPI 不是同一账户中不同应用之间的访问隔离；POSIX `0600` 也不是 Windows ACL 保证。[Electron safeStorage 官方文档](https://www.electronjs.org/docs/latest/api/safe-storage)

安全边界仍为 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`，保留 CSP、导航限制和 IPC 来源/参数校验。没有改写模型提示词、分析调度或收藏业务规则。

## 图标

沿用仓库中已审核的羽毛 PNG 及对应尺寸图，不调用生成式工具，不重绘。`assets/source/manifest.json` 记录原始图案和 PNG 的哈希。`scripts/icons.mjs` 将 16/32/64/128/256px PNG 封装成多尺寸 ICO；窗口、EXE、安装器使用该 ICO，启动页使用 PNG。主界面名称旁没有重新添加图标。

更换羽毛素材时同时更新本目录的 PNG 母版、各尺寸图和来源哈希，再运行 `npm.cmd run icons`；构建不会自动同步或回写根目录的 Mac 图标。

## 安装包与数据保留

`electron-builder.yml` 只打包 `out/`、必要生产依赖、包元数据和 ICO。输出文件为 `dist/Quillhaya-1.0.3-Windows-x64-Setup.exe`。NSIS 采用当前用户安装、可选安装路径，不自动启动应用，不发布到任何服务。

没有配置 Windows 代码签名证书；安装程序和应用为未签名构建。更新/重新安装与普通卸载保留用户数据，配置明确设置 `deleteAppDataOnUninstall: false`。卸载不等同于清除写作内容；用户需要删除数据时应先自行备份。详见 [NSIS 配置文档](https://www.electron.build/nsis/)。

## 测试

共享 126 项单元测试和 Electron 回归在暂存副本中运行。Windows 仅按平台语义调整快捷键、菜单、路径、窗口内容尺寸和 POSIX 权限断言；保留业务测试。截图写入 `reports/screenshots/`。

Windows 新测试覆盖 Ctrl 快捷键、原生窗口状态、关闭取消、中文/空格文件路径、CRLF、文件冲突、缩放及模拟 IME composition。模拟组合输入不能代替系统中文输入法人工验收。

每次测试在启动前检查构建识别 `QUILLHAYA_TEST_USER_DATA`，启动后验证真实 userData 与临时测试目录一致，再执行设置、密钥和草稿操作。`test:package` 检查 app.asar 清单与资源，并在真正打包的 EXE 中检查加密密钥重启后调用本地 HTTP 服务、草稿、暂停、收藏和撤销。只使用合成数据。

实际执行结果和仍未覆盖的项目以 [VALIDATION.md](VALIDATION.md) 为准。
