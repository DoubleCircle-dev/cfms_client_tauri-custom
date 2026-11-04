# CFMS Client Custom

[简体中文](README.zh-CN.md)

[![CI](https://github.com/DoubleCircle-dev/cfms_client_tauri-custom/actions/workflows/ci.yml/badge.svg)](https://github.com/DoubleCircle-dev/cfms_client_tauri-custom/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/DoubleCircle-dev/cfms_client_tauri-custom?display_name=tag)](https://github.com/DoubleCircle-dev/cfms_client_tauri-custom/releases)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**CFMS Client** is the cross-platform client for the [Confidential File Management System (CFMS)](https://github.com/cfms-dev). It securely connects to CFMS servers, provides controlled access to confidential documents, and manages file transfers. The application targets a native desktop experience and also supports Android.

The `custom` branch is DoubleCircle's maintained customization of the [upstream CFMS Client](https://github.com/cfms-dev/cfms_client_tauri). It retains the upstream client as its foundation and adds fork-specific features and integrations.

## About the custom branch

The custom branch follows upstream CFMS Client development while maintaining DoubleCircle-specific functionality. Its current fork modules cover custom messages, notifications, chat, tools, desktop integration, file synchronization, runtime services, and extensions. The upstream client remains the foundation for shared authentication, file operations, transfers, and platform support.

### How custom changes are kept separate

Fork-specific contributions are organized as modules under `src/lib/injection/modules/` and registered in `src/lib/injection/modules/index.ts`. The shared injection registry in `src/lib/injection/registry.ts` exposes module metadata for integration points such as navigation, settings, route titles, parent routes, translations, and lifecycle hooks.

Upstream-owned files use narrow integration seams to read that registry. This keeps most custom feature code out of upstream files, reduces merge conflicts, and makes upstream updates easier to review. When adding a fork feature:

1. Implement it in its own module under `src/lib/injection/modules/`.
2. Register the module in `src/lib/injection/modules/index.ts`.
3. Use the existing registry metadata and add only the necessary integration seam where the upstream application consumes it.
4. Run the relevant checks and tests, then verify the feature alongside the unmodified upstream behavior.

The Rust backend uses the same split. Fork code lives in `src-tauri/src/custom/`: `CustomState` holds the fork's managed state, `wiring.rs` carries start-up, window, and service hooks, `diagnostics.rs` holds local diagnostics, and the `custom::invoke_handler!` macro registers every fork IPC command. Fork command adapters live in `src-tauri/src/commands/injection/`, which `commands.rs` includes once so they keep sharing the upstream `commands` module's private helpers.

When adding a backend feature:

1. Commands: add one line to `custom::invoke_handler!` and put the adapter in `src-tauri/src/commands/injection/`.
2. State: add one field to `CustomState`.
3. Start-up or window behavior: add one function to `custom/wiring.rs`.

Upstream `lib.rs` and `commands.rs` keep only the existing seams: one call per start-up concern, one `custom: CustomState` field on `AppHandleState`, the handler-registration line, and the single `commands/injection/mod.rs` include.

When syncing upstream changes, preserve upstream changes in shared files and re-check the small registry integration seams. Avoid placing fork-specific feature implementation directly in upstream-owned catalogs or components when a module contribution can provide it.

> [!IMPORTANT]
> This client is intended only for deployed CFMS servers that you are authorized to access. It is not a general-purpose cloud-drive or file-server client.

## Features

- **Secure connection and sign-in** — WSS connections, trusted CA certificates, recent-server history, password or OpenSSH public-key sign-in, two-factor authentication, password changes, and password-recovery guidance.
- **File workspace** — directory browsing, search and sorting, favorites, breadcrumbs, item details, recycle bin, drag-and-drop uploads, and context-menu actions.
- **Reliable transfers** — upload-conflict handling, chunked transfers, a persistent download queue, pause/resume, retries, and batch controls.
- **Access and administration** — document access grants and rules, user and group management, audit entry points, and service status, subject to server-side permissions.
- **Privacy and security controls** — encrypted local preferences, app lock (PIN, biometrics, or passkeys when supported by the platform), screen protection, emergency lockdown state, and in-app update checks.
- **Accessible, responsive UI** — English and Simplified Chinese, Fluent 2 styling with locally bundled Noto Sans and Noto Serif, keyboard shortcuts, virtualized lists, and progressive loading for large directories.

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 (the version used by CI; local environments should meet the dependency runtime requirements at minimum)
- [pnpm](https://pnpm.io/) 11
- [Rust stable](https://www.rust-lang.org/tools/install), including `rustup`
- Platform-specific Tauri system dependencies. Android development also requires Android Studio, the Android SDK, and the NDK.

On Windows, you will normally also need the Visual Studio **Desktop development with C++** workload and the WebView2 Runtime. See [BUILD.md](BUILD.md) for Linux dependencies and the complete signing/release setup.

### Install dependencies

```powershell
git clone --branch custom --recurse-submodules https://github.com/DoubleCircle-dev/cfms_client_tauri-custom.git
Set-Location cfms_client_tauri-custom
pnpm install --frozen-lockfile
```

The CA certificate store is a Git submodule. If you already cloned the repository without submodules, initialize it with:

```powershell
git submodule update --init --recursive
```

### Develop, check, and test

```powershell
# Start the desktop app in development mode (Tauri starts the frontend dev service)
pnpm tauri dev

# Run the frontend type check
pnpm check

# Run frontend unit tests
pnpm test

# Build frontend static assets
pnpm build

# Build an installer/package for the current platform
pnpm tauri build
```

Use **pnpm** for all JavaScript package-management and script commands. Do not use `npm`; keeping pnpm and the lockfile in sync is required for reproducible local and CI builds.

### Mobile development

```powershell
# Android: generate the native project once the Android toolchain is configured
pnpm tauri android init

# Start a development build on a connected device or emulator
pnpm tauri android dev

# Produce APK and AAB artifacts
pnpm tauri android build
```

iOS project generation and builds require macOS:

```bash
pnpm tauri ios init
pnpm tauri ios dev
pnpm tauri ios build
```

## Using the client

1. Launch the client, then read and accept the security disclaimer.
2. Enter the CFMS server address provided by your administrator. When the port is omitted, the client uses `443`. The address is validated and TLS is checked against the CA store bundled with the application.
3. Sign in with an authorized account. Complete two-factor verification if the server requires it.
4. Use the **Files** workspace to browse, search, upload, and download documents; use **Tasks** to inspect and control transfers.
5. Configure connection, language, privacy, app lock, download storage, updates, and two-factor settings in **Settings** as needed.

Server addresses, account permissions, document scope, and administrative features are controlled by the CFMS server. Contact the server administrator if you have lost your account password.

### Authentication protocol

Built-in requests use `namespace.resource.action` names without legacy aliases. Authentication PROCESS messages and file-transfer messages retain their existing names. This client requires protocol **29**, matching the server's advertised wire version; all other protocol versions are rejected. Password sign-in uses method-based credentials. Login MFA exchanges an AUTH token through `core.auth.token.exchange` with target purpose `4`; required password changes use a restricted POST_AUTH token and require signing in again afterward.

The sign-in screen also accepts OpenSSH private-key files for Ed25519, RSA and NIST ECDSA, including passphrase-protected keys. The native client signs server challenges locally and supports public-key login and login MFA. The private key is never uploaded. Encrypted local preferences and transfer records use an account-scoped key in the operating system's secure storage; existing data requires its original password once for migration. Device-local keys do not replace the server's password-wrapped key or synchronize between devices.

Use **Elevate privileges** beside the top-bar lockdown control to request a token with purpose `12`. The account's escalation policy determines whether a password, authenticator/recovery code, or no additional proof is required. The centered timer reads expiration from the issued JWT payload. Elevated tokens stay in native memory, are used for authenticated commands while valid, and expire independently of the ordinary session. Token refresh never extends elevation. Privilege elevation currently provides password and TOTP verification interfaces; elevation policies requiring public keys or extension authentication methods display an explicit unsupported-method message.

Hovering over the inactive elevation button highlights it in the caution color. While elevated, the button uses the lockdown control's danger treatment; click it again to discard the elevated token locally and return to the ordinary session immediately.

**Settings → Authentication** exposes credential inventory, public-key registration, label changes and deletion, and atomic revision-checked policy editing for login, MFA and elevation. Policy and public-key writes require elevation and `configure_auth_methods` (self) or `super_configure_auth_methods` (self or others). Viewing another account requires the independent `super_list_user_auth_methods` permission; configuration permission does not grant inventory access. Ordinary password changes require elevation and configuration permission, with no old password in the request. POST_AUTH password changes remain restricted to `new_passwd` and require no configuration permission. TOTP setup activates a credential only; configure login MFA separately through the MFA policy. Registering a public key does not authorize it for a purpose; policy alternatives select explicit credential IDs. The server checks whether changes preserve usable login and elevation paths.

Remote account operations select immutable `user_id` UUIDs, including avatars, password resets, group and permission changes, status, blocks, TOTP administration, keyring listing and direct access grants. User discovery supports explicit username or UUID selectors through `core.user.info.get`. Username remains the credential selector for password login; self-service password changes use the token subject.

### Optional GitHub API token

Update checks and CA certificate list refreshes read public repositories through the GitHub REST API. Anonymous requests normally share a limit of 60 requests per hour per originating IP address; requests authenticated with a personal access token normally use the account's 5,000-request-per-hour limit. These are GitHub's primary limits, not a guarantee that every request will succeed. See [GitHub's rate-limit documentation](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

To configure a token, open **Settings → GitHub API**. A [fine-grained personal access token](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token) with minimal permissions is recommended. Public repository reading does not require write access. The token is saved in this device's secure credential storage and used only for the GitHub API requests above, including update checks before CFMS sign-in. It is not sent to your CFMS server or to update and certificate download URLs. Remove it on the same page when you no longer want authenticated requests. If it stops working, public requests continue anonymously and the client asks you to update or remove it.

## Security notes

CFMS is intended for confidential information. Authorized files are decrypted locally on the client device, so endpoint security is essential:

- Connect only from trusted, hardened devices and environments. Avoid using the application in public places or where others can view your screen.
- Do not disable TLS certificate validation unless you fully understand the risk and are performing controlled troubleshooting.
- Enable app lock and a system screen lock, install client updates promptly, and follow your organization's rules for handling and distributing confidential data.
- Never commit private keys, signing certificates, credentials, or build artifacts containing sensitive files.
- Keep a configured GitHub token private. It belongs to the GitHub account that created it and remains available to this device until you remove it or reset local application data.
- App lock is a privacy barrier for the UI, not a native authorization boundary: existing transfers and service state remain active while the UI is locked.
- The native client minimizes and zeroizes application-owned password, token, DEK, and serialized request buffers. WebView/JavaScript, operating-system, networking-library, register, and historical allocation copies cannot be reliably erased.
- Release builds disable frontend source maps and verbose WebView/stdout logging; Linux release builds also disable ordinary same-user process dumps. None of these controls claims to resist an administrator, root, kernel compromise, jailbroken device, or physical forensics.

The complete disclaimer is shown when the application is first used.

## Project layout

```text
src/                    SvelteKit pages, components, stores, and Tauri API wrappers
src/lib/injection/      Fork module registry and custom feature contributions
src-tauri/              Tauri entry point, IPC commands, platform config, and bundle resources
  src/custom/           Fork backend: managed state, start-up wiring, and IPC command registration
  src/commands/injection/  Fork IPC command adapters, included into the upstream commands module
crates/
  core/                 Shared types, constants, and errors
  crypto/               Key derivation, data encryption, and key wrapping
  transport/            TLS, WebSocket streams, and proxy connections
  transfer/             Chunked upload, download, verification, and decryption
  service/              Connection, RPC, preferences, tasks, and download-queue services
static/                 Icons, fonts, and frontend static assets
scripts/                Font embedding, version synchronization, and release-note tools
.github/workflows/      CI, packaging, and release automation
```

The frontend does not perform sensitive file I/O or network operations directly. Those operations cross the Tauri IPC boundary and are handled by the Rust service layer.

## Maintenance commands

```powershell
# Show, set, or increment the unified application version
pnpm app:version:show
pnpm app:version set 0.32.3
pnpm app:version bump patch
pnpm app:version:check

# Maintain the in-app changelog and export release notes
pnpm app:changelog -- --version 0.32.3 --write
pnpm app:release-notes

# Embed font assets into the application resources
pnpm assets:fonts
```

The version utility synchronizes `package.json`, the Cargo workspace, the Tauri configuration, and generated mobile version metadata where present. For the release process, platform signing secrets, and artifact details, see [BUILD.md](BUILD.md).

## Contributing

Issues and pull requests are welcome. Before submitting a change, run at least:

```powershell
pnpm check
pnpm test
pnpm app:version:check
```

Keep changes focused, add appropriate tests, and do not commit build output, private certificates, keys, or real confidential documents.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
