# Quillhaya 1.0.1 独立数据与密钥存储

完成日期：2026-10-30（10 月 29 日开始实施）。用户要求新应用独立保存配置和 API Key，取消旧名称兼容，并解决重新打开时为了检查密钥而触发钥匙串弹窗的问题。

## 最终行为

| 内容 | 安装版 | 源码开发版 |
| --- | --- | --- |
| 原生应用名 / 加密身份 | `Quillhaya` | `Quillhaya Development` |
| Application Support 子目录 | `Quillhaya/` | `Quillhaya Development/` |
| macOS Keychain service | `Quillhaya Safe Storage` | `Quillhaya Development Safe Storage` |
| 配置、草稿、凭据 | 分别独立保存，不互相读取 | 分别独立保存，不互相读取 |

安装版 Bundle ID 改为 `com.zloyan.quillhaya`，版本为 1.0.1。窗口与界面名称仍为 `Quillhaya - Writing Assistant`。不读取旧目录，不复制旧凭据，不启动旧名称测试程序，不自动迁移。用户需要在新版中重新添加模型和 API Key；需要的旧 Markdown 文件可自行打开。

## 技术栈与调用流程

仍使用 TypeScript、Electron 44.7.0、Node 文件 API、Zod、Vitest 和 Playwright；无新增依赖。

- [identity.ts](../electron/storage/identity.ts)：根据 `app.isPackaged` 确定数据与钥匙串身份。主进程在 Electron 初始化之前设置最终名称，ready 之后不再改名。
- [store.ts](../electron/storage/store.ts)：使用 `isAsyncEncryptionAvailable`、`encryptStringAsync`、`decryptStringAsync`。系统等待授权时不以同步加解密阻塞主线程。
- [main.ts](../electron/main.ts)：实际模型连接和分析才等待凭据解密；分析队列取得凭据后再次检查取消信号，避免取消期间完成解密后继续发请求。
- 设置页显示“已保存密钥”，不把保存状态误认为已验证连接成功。

保存设置时，对 API Key 使用系统加密后写入 `credentials.json`；设置和凭据文件写入完成才返回成功。系统加密不可用或加密失败时返回错误，不退回明文，也不覆盖已保存的记录。凭据只发送给配置指定的端点。

每条凭据的公开元数据只含 endpoint、auth、header 及 ciphertext，API Key 在密文内。加密 payload 内也保存 endpoint、auth、header，解密后再次核对，防止仅修改公开元数据就把旧密钥发送到不同地址。改变端点或认证方式后，“已保存”状态不再适用于新目标。

启动、恢复界面和打开设置时，`keyStatus()` 只检查记录及绑定，不调用任何系统加解密接口。保存后的正常重启可以直接显示设置，实际调用模型时异步读取本应用自己的凭据。环境变量仍是用户显式配置的可选来源。

## 系统授权的边界

这次修改消除了读取旧命名空间、开发/安装版混用和 bootstrap 主动解密这三个触发来源。没有删除系统钥匙串项、重设钥匙串密码、修改访问控制列表或将加密密钥写进普通文件。

同一个已经成功保存 API Key 的应用构建正常重启，应直接读到它自己保存的凭据。不能替 macOS 保证钥匙串被锁定、访问权限被撤销、应用签名发生变化时永远不出现系统授权。当前仍为 ad-hoc 签名；正式跨版本分发要避免因签名变化重新授权，需要稳定的签名证书。[Electron 44.7.0 官方说明](https://github.com/electron/electron/blob/v44.7.0/docs/api/safe-storage.md)明确指出异步接口及稳定签名的要求。

## 验证与隔离

单元测试覆盖安装/开发身份、保存重启、不解密的保存状态检查、端点绑定、公开元数据篡改、加密失败不覆盖、系统不可用时不主动解密。

界面回归覆盖保存合成密钥后重启，以及禁用系统加解密接口后仍能 bootstrap 和打开设置。安装包测试使用真实钥匙串，把合成密钥保存后关闭应用，复制同一构建到另一位置，重新打开并用保存的密钥访问本地 HTTP 测试端点。

所有新测试使用 `QUILLHAYA_TEST_USER_DATA`。界面测试统一通过 [isolated-electron.ts](../tests/e2e/isolated-electron.ts) 启动：首先检查已构建产物支持隔离变量，再核对运行进程的实际 userData 路径；不匹配就退出，禁止进入设置或文档写入步骤。Ollama 人工集成脚本改用 `QUILLHAYA_` 前缀，默认读取安装版 Quillhaya 的设置，不自动访问旧目录。

实际检查结果及本次测试执行失误的影响记录见 [VALIDATION.md](VALIDATION.md)。
