# CFMS Client Custom

[English](README.md)

[![CI](https://github.com/DoubleCircle-dev/cfms_client_tauri-custom/actions/workflows/ci.yml/badge.svg)](https://github.com/DoubleCircle-dev/cfms_client_tauri-custom/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/DoubleCircle-dev/cfms_client_tauri-custom?display_name=tag)](https://github.com/DoubleCircle-dev/cfms_client_tauri-custom/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**CFMS Client** 是 [保密文件管理系统（CFMS）](https://github.com/cfms-dev) 的跨平台客户端，可安全连接 CFMS 服务器、按权限访问保密文档并管理文件传输。应用面向桌面平台，也支持 Android。

`custom` 分支由 DoubleCircle 维护，是基于[上游 CFMS Client](https://github.com/cfms-dev/cfms_client_tauri) 的定制版本。它保留上游客户端作为基础，并添加此分支专属的功能与集成。

## custom 分支简介

custom 分支在跟进 CFMS Client 上游开发的同时，维护 DoubleCircle 专属功能。目前，分支模块涵盖自定义消息、通知、聊天、工具、桌面集成、文件同步、运行时服务和扩展。共享的身份验证、文件操作、传输和平台支持仍以上游客户端为基础。

### custom 如何在原版基础上修改

分支专属功能集中在 `src/lib/injection/modules/` 下，并在 `src/lib/injection/modules/index.ts` 中注册。共享注入注册表 `src/lib/injection/registry.ts` 负责暴露模块元数据，供导航、设置、路由标题、父路由、翻译和生命周期钩子等接入点使用。

上游文件通过少量明确的接入点读取注册表。这样可避免把大部分定制功能直接写入上游文件，减少合并冲突，也让跟进上游更新时更容易审查。新增分支功能时：

1. 在 `src/lib/injection/modules/` 下为功能建立独立模块。
2. 在 `src/lib/injection/modules/index.ts` 中注册该模块。
3. 通过现有注册表元数据接入功能；只有上游应用尚无接入点时，才在相应位置添加必要的接入代码。
4. 运行相关检查和测试，并确认新增功能没有破坏上游原有行为。

同步上游更新时，应保留共享文件中的上游改动，并重新检查少量注册表接入点。如果模块机制能够提供相应能力，应避免把分支专属功能直接写入上游维护的目录、组件或其他文件。

> [!IMPORTANT]
> 本客户端仅适用于已部署且经授权访问的 CFMS 服务器，不是通用网盘或文件服务器客户端。

## 功能

- **安全连接与登录** — WSS 连接、受信任的 CA 证书、最近使用的服务器记录、密码或 OpenSSH 公钥登录、双重验证、密码修改和密码找回指引。
- **文件工作区** — 目录浏览、搜索与排序、收藏、面包屑导航、条目详情、回收站、拖放上传和上下文菜单操作。
- **可靠传输** — 上传冲突处理、分块传输、持久化下载队列、暂停与恢复、重试和批量控制。
- **访问与管理** — 文档访问授权与规则、用户和群组管理、审计入口及服务状态；具体能力受服务器端权限控制。
- **隐私与安全控制** — 加密的本地偏好设置、应用锁（PIN、生物识别或平台支持时的通行密钥）、屏幕保护、紧急锁定状态和应用内更新检查。
- **无障碍与自适应界面** — 英文和简体中文、Fluent 2 风格、本地打包的 Noto Sans 与 Noto Serif、键盘快捷键、虚拟列表，以及大型目录的渐进式加载。

## 开始使用

### 环境要求

- [Node.js](https://nodejs.org/) 24（CI 使用的版本；本地环境至少应满足依赖项的运行时要求）
- [pnpm](https://pnpm.io/) 11
- [Rust stable](https://www.rust-lang.org/tools/install)，包括 `rustup`
- Tauri 所需的平台依赖。Android 开发还需要 Android Studio、Android SDK 和 NDK。

Windows 通常还需要 Visual Studio 的 **使用 C++ 的桌面开发**工作负载和 WebView2 Runtime。Linux 依赖及完整的签名、发布配置请参阅 [BUILD.md](BUILD.md)。

### 安装依赖

```powershell
git clone --branch custom --recurse-submodules https://github.com/DoubleCircle-dev/cfms_client_tauri-custom.git
Set-Location cfms_client_tauri-custom
pnpm install --frozen-lockfile
```

CA 证书库以 Git 子模块形式管理。如果克隆时未初始化子模块，请运行：

```powershell
git submodule update --init --recursive
```

### 开发、检查与测试

```powershell
# 以开发模式启动桌面应用（Tauri 会启动前端开发服务）
pnpm tauri dev

# 运行前端类型检查
pnpm check

# 运行前端单元测试
pnpm test

# 构建前端静态资源
pnpm build

# 为当前平台构建安装包
pnpm tauri build
```

所有 JavaScript 包管理及脚本命令均使用 **pnpm**，不要使用 `npm`。保持 pnpm 与锁文件同步是确保本地和 CI 构建可复现的必要条件。

### 移动端开发

```powershell
# Android：配置好工具链后，首次生成原生项目
pnpm tauri android init

# 在已连接的设备或模拟器上启动开发构建
pnpm tauri android dev

# 生成 APK 和 AAB
pnpm tauri android build
```

iOS 项目生成和构建需要 macOS：

```bash
pnpm tauri ios init
pnpm tauri ios dev
pnpm tauri ios build
```

## 使用客户端

1. 启动客户端，阅读并接受安全免责声明。
2. 输入管理员提供的 CFMS 服务器地址。未填写端口时默认使用 `443`。客户端会校验地址，并使用应用内置的 CA 证书库检查 TLS 连接。
3. 使用已获授权的账号登录；如果服务器要求双重验证，请完成验证。
4. 在 **文件**工作区浏览、搜索、上传和下载文档；在 **任务**中查看并控制传输。
5. 根据需要在 **设置**中配置连接、语言、隐私、应用锁、下载存储、更新和双重验证。

服务器地址、账号权限、可访问的文档范围和管理功能均由 CFMS 服务器控制。如果忘记账号密码，请联系服务器管理员。

### 身份验证协议

内置请求使用 `namespace.resource.action` 格式的名称，不使用旧版别名。身份验证 PROCESS 消息和文件传输消息保留原有名称。本客户端要求协议版本为 **29**，与服务器公布的线协议版本一致；不支持其他版本。密码登录使用基于方法的凭据。登录 MFA 通过 `core.auth.token.exchange` 交换 AUTH 令牌，目标用途为 `4`；强制修改密码时使用受限的 POST_AUTH 令牌，修改完成后必须重新登录。

登录界面也支持 Ed25519、RSA 和 NIST ECDSA 格式的 OpenSSH 私钥文件，包括带口令保护的密钥。原生客户端会在本地对服务器质询签名，并支持公钥登录和登录 MFA；私钥不会上传。本地加密偏好设置和传输记录使用操作系统安全存储中的账号级密钥；迁移已有数据时需要原密码进行一次验证。设备本地密钥不会替代服务器端由密码包装的密钥，也不会在设备之间同步。

使用顶部锁定控制旁的 **提升权限** 请求用途为 `12` 的令牌。账号的提权策略决定是否需要密码、验证器/恢复码或无需额外凭据。居中的计时器根据已签发 JWT 的载荷显示到期时间。提权令牌保存在原生端内存中，在有效期内用于已认证命令，并独立于普通会话过期；刷新令牌不会延长提权有效期。目前，提权界面支持密码和 TOTP 验证；如果提权策略要求公钥或扩展身份验证方法，客户端会明确提示暂不支持。

悬停在未激活的提权按钮上时，按钮会以警示色高亮。提权期间，按钮使用锁定控制的危险状态样式；再次点击会立即在本地丢弃提权令牌并返回普通会话。

**设置 → 身份验证**提供凭据清单、公钥注册、标签修改与删除，以及针对登录、MFA 和提权策略的原子化版本校验编辑。策略和公钥写入需要先提权，并具有 `configure_auth_methods`（本人）或 `super_configure_auth_methods`（本人或其他用户）权限。查看其他账号需要独立的 `super_list_user_auth_methods` 权限；配置权限不会自动授予查看凭据清单的权限。普通密码修改需要提权和配置权限，且请求中不包含旧密码。POST_AUTH 密码修改仅允许 `new_passwd`，不需要配置权限。TOTP 设置只会激活凭据；登录 MFA 仍须通过 MFA 策略单独配置。注册公钥并不意味着该密钥已获准用于某种用途；策略选项通过明确的凭据 ID 选择密钥。服务器会检查修改是否仍保留可用的登录和提权路径。

远程账号操作通过不可变的 `user_id` UUID 选择目标，包括头像、密码重置、群组和权限变更、状态、封禁、TOTP 管理、密钥环列表和直接访问授权。用户查询可通过 `core.user.info.get` 明确指定用户名或 UUID。密码登录仍以用户名作为凭据选择器；本人修改密码时使用令牌中的主体标识。

### 可选的 GitHub API 令牌

更新检查和 CA 证书列表刷新会通过 GitHub REST API 读取公开仓库。匿名请求通常共享每个来源 IP 每小时 60 次的限额；使用个人访问令牌认证的请求通常使用该账号每小时 5,000 次的限额。这些是 GitHub 的主要限额，并不保证每次请求都成功。详情请参阅 [GitHub 的速率限制文档](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)。

如需配置令牌，请打开 **设置 → GitHub API**。建议使用权限范围尽可能小的[细粒度个人访问令牌](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token)。读取公开仓库不需要写入权限。令牌保存在本设备的安全凭据存储中，仅用于上述 GitHub API 请求，包括 CFMS 登录前的更新检查。令牌不会发送到 CFMS 服务器，也不会发送到更新或证书下载地址。不再需要认证请求时，可在同一页面移除令牌。如果令牌失效，客户端会继续匿名请求，并提示更新或移除令牌。

## 安全说明

CFMS 用于处理保密信息。授权文件会在客户端设备本地解密，因此终端设备安全至关重要：

- 仅在可信且安全加固的设备和环境中连接。避免在公共场所或他人可看到屏幕的位置使用应用。
- 除非充分了解风险且正在进行受控故障排查，否则不要关闭 TLS 证书验证。
- 启用应用锁和系统屏幕锁，及时安装客户端更新，并遵守组织关于保密数据处理与分发的规定。
- 不要提交私钥、签名证书、凭据或包含敏感文件的构建产物。
- 妥善保管已配置的 GitHub 令牌。令牌归创建它的 GitHub 账号所有；除非主动移除令牌或重置本地应用数据，否则它会保留在本设备上。
- 应用锁是 UI 隐私保护机制，不是原生授权边界：UI 锁定时，已有传输和服务状态仍会继续运行。
- 原生客户端会尽量缩短应用所持有密码、令牌、DEK 和序列化请求缓冲区的生命周期，并对其进行清零。WebView/JavaScript、操作系统、网络库、寄存器及历史内存分配中的副本无法保证被可靠擦除。
- 发布构建会禁用前端 source map 和详细的 WebView/stdout 日志；Linux 发布构建还会禁用普通的同用户进程转储。这些措施均不代表能够抵御管理员、root、内核失陷、越狱设备或物理取证。

首次使用应用时会显示完整免责声明。

## 项目结构

```text
src/                    SvelteKit 页面、组件、状态存储和 Tauri API 封装
src/lib/injection/      分支模块注册表与定制功能贡献
src-tauri/              Tauri 入口、IPC 命令、平台配置和打包资源
crates/
  core/                 共享类型、常量和错误
  crypto/               密钥派生、数据加密和密钥包装
  transport/            TLS、WebSocket 流和代理连接
  transfer/             分块上传、下载、校验和解密
  service/              连接、RPC、偏好设置、任务和下载队列服务
static/                 图标、字体和前端静态资源
scripts/                字体嵌入、版本同步和发布说明工具
.github/workflows/      CI、打包和发布自动化
```

前端不会直接执行敏感文件 I/O 或网络操作。这些操作会跨越 Tauri IPC 边界，由 Rust 服务层处理。

## 维护命令

```powershell
# 查看、设置或递增统一应用版本
pnpm app:version:show
pnpm app:version set 0.32.3
pnpm app:version bump patch
pnpm app:version:check

# 维护应用内更新日志并导出发布说明
pnpm app:changelog -- --version 0.32.3 --write
pnpm app:release-notes

# 将字体资源嵌入应用资源
pnpm assets:fonts
```

版本工具会同步 `package.json`、Cargo 工作区、Tauri 配置，以及适用时生成的移动端版本元数据。发布流程、平台签名密钥和构建产物详情请参阅 [BUILD.md](BUILD.md)。

## 贡献

欢迎提交问题和拉取请求。提交更改前，至少运行：

```powershell
pnpm check
pnpm test
pnpm app:version:check
```

请保持更改范围清晰，补充适当的测试，并且不要提交构建产物、私有证书、密钥或真实保密文件。

## 许可证

本项目依据 [Apache License 2.0](LICENSE) 授权。
