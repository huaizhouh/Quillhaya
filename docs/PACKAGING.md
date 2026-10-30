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
| Bundle ID | `com.zloyan.quillhaya`，Quillhaya 独立应用身份 |
| 架构 / 用途分类 | `arm64` / `public.app-category.productivity` |
| macOS 应用图标 | `icon/generated/app-icon.icns` |
| 启动页、源码运行 Dock 图标 | `icon/generated/app-icon.png` |
| 应用 | `dist/mac-arm64/Quillhaya.app` |
| 安装镜像 | `dist/Quillhaya-1.0.1-arm64.dmg`（版本号跟随 package.json） |

`icon/icon.png` 是用户提供的羽毛原图，保持原样。`npm run dev` 和 `npm run build` 会自动执行 `npm run icons`：使用系统 Swift / CoreGraphics 裁去多余白边，生成圆角底板和透明边距，并通过 `iconutil` 导出 ICNS；`pack:mac` 和 `dist:mac` 因调用 build 也会自动更新图标。

生成内容放在 `icon/generated/`，不再读取用户提供的满幅 `icon/icon.icns` 或旧 `icon.iconset`。更换原图后运行正常构建命令即可，避免 PNG 已更换而 ICNS 仍是旧图的问题。按当前 `.gitignore`，`icon/` 由项目拥有者在本地提供；复制工程到另一台机器时需带上 `icon/icon.png`。具体参数和效果见 [图标适配说明](ICON-ADAPTATION.md)。

Renderer 通过 Vite 导入 PNG，生成带内容哈希的本地资源并装入应用；ICNS 由 electron-builder 放入应用 Resources，并在 Info.plist 中引用。打包只包括编译产物、包元数据及生产依赖，不会把源码目录的作文、issues、测试或配置文件一并打入。

当前配置使用本机 ad-hoc 签名，未配置 Developer ID、公证或自动更新，不执行发布。正式对外分发所需的证书和公证信息由发布者提供；本次改名与图标调整没有更改签名策略。

## 数据兼容与检查

1.0.1 起使用独立 Bundle ID、`Quillhaya/` 用户目录及 `Quillhaya Safe Storage` 钥匙串命名空间。开发模式单独使用 `Quillhaya Development`。不自动迁移、读取或解密旧应用数据，首次使用需重新配置。实现见 [STORAGE-ISOLATION.md](STORAGE-ISOLATION.md)。

`test:package` 使用隔离目录验证：

- Info.plist 的 Quillhaya 应用身份、可执行文件名、架构及用途分类。
- 打包 ICNS 与生成文件字节一致，主窗口左上角只显示文字。
- 首次启动使用默认 Mock，写作反馈、忽略、重评和接受修改正常。
- 通过真实系统钥匙串加密保存合成 API Key，磁盘及 bootstrap 不含明文密钥。
- 退出后把同一签名的 `.app` 复制到另一个临时安装位置，再次启动；已保存状态和草稿恢复，使用保存的密钥访问本地 HTTP 测试服务成功。

测试不再启动旧名称程序或验证旧密文兼容。密钥检查使用系统接口及合成测试字符串，不读取用户真实 API Key；不更改用户的实际数据目录。

同一个已保存密钥的构建正常重启，无需重复授权。跨版本更新若继续采用 ad-hoc 签名，系统可能将新的构建识别为不同程序并要求授权；稳定的跨版本身份需要发布者提供正式签名证书。应用不会通过放宽钥匙串访问控制或明文保存来绕过系统保护。详情见 [Electron 44.7.0 safeStorage 文档](https://github.com/electron/electron/blob/v44.7.0/docs/api/safe-storage.md)。
