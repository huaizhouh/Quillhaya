# Quillhaya macOS 构建与打包

面向维护者，适用于当前 electron-builder 26.15.3 配置。启动及日常使用见 [README](../README.md)。

## 环境与命令

在 macOS Apple Silicon 上使用 Node.js ≥ 22.12、npm 和 Xcode Command Line Tools（或完整 Xcode），无需 Conda。在项目目录执行：

```bash
npm ci
npm run check
npm run pack:mac       # 构建源码并生成 .app
npm run dist:mac       # 构建源码并生成 .app、DMG
npm run test:package   # 验证刚生成的 .app
codesign --verify --deep --strict 'dist/mac-arm64/Quillhaya.app'
```

已完成源码构建且图标未更换、只需重新打包时：

```bash
npx --no electron-builder --mac --arm64 --publish never
```

## 名称、图标与产物

| 配置 | 当前值 |
| --- | --- |
| npm 包名 | `quillhaya` |
| 正式应用名 / `productName` | `Quillhaya` |
| 主窗口标题及左上角文字 | `Quillhaya - Writing Assistant` |
| Bundle ID | `com.zloyan.writingassistant`，保留已有身份 |
| 架构 / 用途分类 | `arm64` / `public.app-category.productivity` |
| macOS 应用图标 | `icon/generated/app-icon.icns` |
| 启动页、源码运行 Dock 图标 | `icon/generated/app-icon.png` |
| 应用 | `dist/mac-arm64/Quillhaya.app` |
| 安装镜像 | `dist/Quillhaya-1.0.0-arm64.dmg`（版本号跟随 package.json） |

`icon/icon.png` 是用户提供的羽毛原图，保持原样。`npm run dev` 和 `npm run build` 会自动执行 `npm run icons`：使用系统 Swift / CoreGraphics 裁去多余白边，生成圆角底板和透明边距，并通过 `iconutil` 导出 ICNS；`pack:mac` 和 `dist:mac` 因调用 build 也会自动更新图标。

生成内容放在 `icon/generated/`，不再读取用户提供的满幅 `icon/icon.icns` 或旧 `icon.iconset`。更换原图后运行正常构建命令即可，避免 PNG 已更换而 ICNS 仍是旧图的问题。按当前 `.gitignore`，`icon/` 由项目拥有者在本地提供；复制工程到另一台机器时需带上 `icon/icon.png`。具体参数和效果见 [图标适配说明](ICON-ADAPTATION.md)。

Renderer 通过 Vite 导入 PNG，生成带内容哈希的本地资源并装入应用；ICNS 由 electron-builder 放入应用 Resources，并在 Info.plist 中引用。打包只包括编译产物、包元数据及生产依赖，不会把源码目录的作文、issues、测试或配置文件一并打入。

当前配置使用本机 ad-hoc 签名，未配置 Developer ID、公证或自动更新，不执行发布。正式对外分发所需的证书和公证信息由发布者提供；本次改名与图标调整没有更改签名策略。

## 数据兼容与检查

Bundle ID、用户数据位置及旧 Keychain 命名空间保持稳定。主进程在 Electron 初始化密钥存储之后设置可见应用名，避免直接改名导致旧 API Key 密文无法解密。具体实现见 [ISSUE1029-IMPLEMENTATION.md](ISSUE1029-IMPLEMENTATION.md#存储兼容性)。

`test:package` 使用隔离目录验证：

- Info.plist 的应用名、可执行文件名、Bundle ID、架构和用途分类。
- 打包 ICNS 与本次生成的 ICNS 字节一致，确保没有回退到 Electron 默认图标。
- 主窗口名称、左上角纯文字品牌、沙箱和本地页面正常。
- 使用旧命名空间加密的合成字符串，在 Quillhaya 打包应用中仍可解密。
- Mock 反馈、忽略、重新评估、接受修改仍可用。

兼容测试使用真实 macOS 钥匙串加解密合成字符串，显式排除 Playwright 模拟钥匙串；系统若弹出访问授权，需要由用户在系统弹窗处理。测试不读取用户真实 API Key 或作文。历史 `Writing Assistant` 名称的 DMG 可能仍在输出目录中；本次新产物以 `Quillhaya` 为名，以本页路径为准。
