<script lang="ts">
    import { onMount, tick } from "svelte";
    import { goto } from "$app/navigation";
    import { invoke } from "@tauri-apps/api/core";

    onMount(() => {
        if (!import.meta.env.DEV) {
            goto("/home/overview", { replaceState: true });
        }
        loadSavedTemplates();
    });

    // ---- Hardcoded command definitions (from server_commands.json) ----
    interface CmdEntry { action: string; desc: string; requireAuth: boolean; data: Record<string, unknown>; }
    const COMMAND_CATEGORIES: { label: string; cmds: CmdEntry[] }[] = [
        { label: "🔐 认证", cmds: [
            { action: "login", desc: "用户登录", requireAuth: false, data: { username: "PLACEHOLDER", password: "PLACEHOLDER" } },
            { action: "refresh_token", desc: "刷新访问令牌", requireAuth: true, data: {} },
        ]},
        { label: "🔑 双因素认证", cmds: [
            { action: "setup_2fa", desc: "设置双因素认证(TOTP)", requireAuth: true, data: { method: "totp" } },
            { action: "cancel_2fa_setup", desc: "取消2FA设置", requireAuth: true, data: {} },
            { action: "validate_2fa", desc: "验证并启用2FA", requireAuth: true, data: { token: "PLACEHOLDER" } },
            { action: "disable_2fa", desc: "禁用双因素认证", requireAuth: true, data: { username: "PLACEHOLDER" } },
            { action: "get_2fa_status", desc: "获取2FA状态", requireAuth: true, data: {} },
        ]},
        { label: "🛡️ 安全管理", cmds: [
            { action: "list_banned_subnets", desc: "列出被封禁的子网", requireAuth: true, data: {} },
            { action: "create_banned_subnet", desc: "创建封禁子网规则", requireAuth: true, data: { subnet: "PLACEHOLDER" } },
            { action: "update_banned_subnet", desc: "更新封禁子网规则", requireAuth: true, data: { subnet: "PLACEHOLDER" } },
            { action: "delete_banned_subnet", desc: "删除封禁子网规则", requireAuth: true, data: { subnet: "PLACEHOLDER" } },
            { action: "list_auth_lockouts", desc: "列出认证锁定记录", requireAuth: true, data: {} },
            { action: "unlock_auth_lockouts", desc: "解锁认证锁定", requireAuth: true, data: { target: "PLACEHOLDER", scope: "PLACEHOLDER" } },
        ]},
        { label: "📄 文档", cmds: [
            { action: "get_document", desc: "获取文档(触发下载任务)", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "get_document_info", desc: "获取文档信息", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "get_document_access_rules", desc: "获取文档访问规则", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "create_document", desc: "创建文档", requireAuth: true, data: { title: "PLACEHOLDER" } },
            { action: "upload_document", desc: "上传文档(新版本)", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "delete_document", desc: "删除文档(标记删除)", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "restore_document", desc: "恢复已删除文档", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "purge_document", desc: "永久清除文档", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "rename_document", desc: "重命名文档", requireAuth: true, data: { document_id: "PLACEHOLDER", new_title: "PLACEHOLDER" } },
            { action: "move_document", desc: "移动文档", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "set_document_rules", desc: "设置文档访问规则", requireAuth: true, data: { document_id: "PLACEHOLDER", access_rules: {} } },
            { action: "set_document_tags", desc: "设置文档标签", requireAuth: true, data: { document_id: "PLACEHOLDER", tags: [] } },
        ]},
        { label: "📝 修订版本", cmds: [
            { action: "list_revisions", desc: "列出文档版本历史", requireAuth: true, data: { document_id: "PLACEHOLDER" } },
            { action: "get_revision", desc: "获取指定版本", requireAuth: true, data: { id: "PLACEHOLDER" } },
            { action: "set_current_revision", desc: "设置当前版本", requireAuth: true, data: { document_id: "PLACEHOLDER", revision_id: "PLACEHOLDER" } },
            { action: "delete_revision", desc: "删除版本", requireAuth: true, data: { id: "PLACEHOLDER" } },
        ]},
        { label: "📁 文件", cmds: [
            { action: "download_file", desc: "下载文件(分块传输)", requireAuth: false, data: { task_id: "PLACEHOLDER", max_chunk_size: 65536 } },
            { action: "upload_file", desc: "上传文件(分块传输)", requireAuth: false, data: { task_id: "PLACEHOLDER", file_size: 0, sha256: null, max_chunk_size: 65536 } },
        ]},
        { label: "📂 目录", cmds: [
            { action: "list_directory", desc: "列出目录内容", requireAuth: true, data: { folder_id: null } },
            { action: "get_directory_info", desc: "获取目录信息", requireAuth: true, data: { directory_id: "PLACEHOLDER" } },
            { action: "get_directory_access_rules", desc: "获取目录访问规则", requireAuth: true, data: { directory_id: "PLACEHOLDER" } },
            { action: "create_directory", desc: "创建目录", requireAuth: true, data: { name: "PLACEHOLDER" } },
            { action: "delete_directory", desc: "删除目录(标记删除)", requireAuth: true, data: { folder_id: "PLACEHOLDER" } },
            { action: "restore_directory", desc: "恢复已删除目录", requireAuth: true, data: { folder_id: "PLACEHOLDER" } },
            { action: "purge_directory", desc: "永久清除目录", requireAuth: true, data: { folder_id: "PLACEHOLDER" } },
            { action: "rename_directory", desc: "重命名目录", requireAuth: true, data: { folder_id: "PLACEHOLDER", new_name: "PLACEHOLDER" } },
            { action: "move_directory", desc: "移动目录", requireAuth: true, data: { folder_id: "PLACEHOLDER", target_folder_id: null } },
            { action: "set_directory_rules", desc: "设置目录访问规则", requireAuth: true, data: { directory_id: "PLACEHOLDER", access_rules: {} } },
            { action: "list_deleted_items", desc: "列出已删除项目", requireAuth: true, data: { folder_id: "PLACEHOLDER" } },
        ]},
        { label: "🔍 搜索", cmds: [
            { action: "search", desc: "搜索文档和目录", requireAuth: true, data: { query: "PLACEHOLDER" } },
        ]},
        { label: "👤 用户管理", cmds: [
            { action: "list_users", desc: "列出用户", requireAuth: true, data: {} },
            { action: "create_user", desc: "创建用户", requireAuth: true, data: { username: "PLACEHOLDER", password: "PLACEHOLDER" } },
            { action: "delete_user", desc: "删除用户", requireAuth: true, data: { username: "PLACEHOLDER" } },
            { action: "rename_user", desc: "重命名用户(昵称)", requireAuth: false, data: { username: "PLACEHOLDER" } },
            { action: "get_user_info", desc: "获取用户信息", requireAuth: true, data: { username: "PLACEHOLDER" } },
            { action: "get_user_avatar", desc: "获取用户头像", requireAuth: true, data: { username: "PLACEHOLDER" } },
            { action: "set_user_avatar", desc: "设置用户头像", requireAuth: true, data: { username: "PLACEHOLDER", document_id: "PLACEHOLDER" } },
            { action: "change_user_groups", desc: "修改用户所属组", requireAuth: true, data: { username: "PLACEHOLDER" } },
            { action: "change_user_permissions", desc: "修改用户权限", requireAuth: true, data: { username: "PLACEHOLDER", permissions: [{ permission: "PLACEHOLDER", granted: true, start_time: 0, end_time: 0 }] } },
            { action: "set_passwd", desc: "设置密码", requireAuth: false, data: { username: "PLACEHOLDER", new_passwd: "PLACEHOLDER" } },
            { action: "manage_user_status", desc: "管理用户状态(active|disabled)", requireAuth: true, data: { username: "PLACEHOLDER", status: "disabled", reason: null } },
            { action: "block_user", desc: "封禁用户", requireAuth: true, data: { username: "PLACEHOLDER", block_types: [], target: { type: "all" }, reason: null } },
            { action: "unblock_user", desc: "解封用户", requireAuth: true, data: { block_id: "PLACEHOLDER" } },
            { action: "update_user_block", desc: "更新封禁记录理由", requireAuth: true, data: { block_id: "PLACEHOLDER", reason: null } },
            { action: "list_user_blocks", desc: "列出用户封禁记录", requireAuth: true, data: { username: "PLACEHOLDER" } },
        ]},
        { label: "👥 组管理", cmds: [
            { action: "list_groups", desc: "列出组", requireAuth: true, data: {} },
            { action: "create_group", desc: "创建组", requireAuth: true, data: { group_name: "PLACEHOLDER" } },
            { action: "delete_group", desc: "删除组", requireAuth: true, data: { group_name: "PLACEHOLDER" } },
            { action: "rename_group", desc: "重命名组", requireAuth: true, data: { group_name: "PLACEHOLDER", display_name: null } },
            { action: "get_group_info", desc: "获取组信息", requireAuth: true, data: { group_name: "PLACEHOLDER" } },
            { action: "change_group_permissions", desc: "修改组权限", requireAuth: true, data: { group_name: "PLACEHOLDER", permissions: [] } },
        ]},
        { label: "🔗 访问控制", cmds: [
            { action: "grant_access", desc: "授予访问权限", requireAuth: true, data: { entity_type: "user", entity_identifier: "PLACEHOLDER", target_type: "document", target_identifier: "PLACEHOLDER", access_types: [], start_time: 0 } },
            { action: "revoke_access", desc: "撤销访问权限", requireAuth: true, data: { entry_id: "PLACEHOLDER" } },
            { action: "view_access_entries", desc: "查看访问条目", requireAuth: true, data: { object_type: "user", object_identifier: "PLACEHOLDER" } },
        ]},
        { label: "⚙️ 系统", cmds: [
            { action: "lockdown", desc: "锁定/解锁服务器", requireAuth: true, data: { status: true } },
            { action: "view_audit_logs", desc: "查看审计日志", requireAuth: true, data: {} },
        ]},
        { label: "🔐 密钥环", cmds: [
            { action: "upload_user_key", desc: "上传用户密钥", requireAuth: true, data: { content: "PLACEHOLDER" } },
            { action: "get_user_key", desc: "获取用户密钥", requireAuth: true, data: { id: "PLACEHOLDER" } },
            { action: "delete_user_key", desc: "删除用户密钥", requireAuth: true, data: { id: "PLACEHOLDER" } },
            { action: "set_user_preference_dek", desc: "设置首选DEK", requireAuth: true, data: { id: "PLACEHOLDER" } },
            { action: "list_user_keys", desc: "列出用户密钥", requireAuth: true, data: {} },
        ]},
        { label: "🧩 内置扩展", cmds: [
            { action: "server_info", desc: "获取服务器信息", requireAuth: false, data: {} },
            { action: "diagnostics", desc: "获取服务器诊断信息(需DIAGNOSTICS权限)", requireAuth: true, data: {} },
            { action: "shutdown", desc: "关闭服务器(需要SHUTDOWN权限)", requireAuth: true, data: {} },
        ]},
        { label: "🐛 Debug", cmds: [
            { action: "throw_exception", desc: "抛出测试异常(仅debug模式,需DEBUGGING权限)", requireAuth: true, data: {} },
        ]},
        { label: "🧩 OIDC SSO", cmds: [
            { action: "sso_oidc_start", desc: "启动OIDC SSO登录流程", requireAuth: false, data: {} },
            { action: "sso_oidc_callback", desc: "OIDC SSO回调处理", requireAuth: false, data: { state: "PLACEHOLDER" } },
        ]},
    ];

    // Build a flat lookup map for validation
    const CMD_LOOKUP: Record<string, { desc: string; requireAuth: boolean }> = {};
    for (const cat of COMMAND_CATEGORIES) {
        for (const c of cat.cmds) {
            CMD_LOOKUP[c.action] = { desc: c.desc, requireAuth: c.requireAuth };
        }
    }

    // ---- Types ----
    interface SavedTemplate {
        name: string;
        payload: Record<string, unknown>;
        noauth: boolean;
        savedAt: number;
    }
    interface LogEntry {
        type: "sent" | "recv" | "error" | "info" | "warn";
        text: string;
        time: string;
    }

    // ---- State ----
    let authenticated = $state(true);
    let payloadText = $state('{"action": "server_info"}');
    let payloadLabel = $state("—");
    let logEntries = $state<LogEntry[]>([]);
    let statusInfo = $state("就绪");
    let statusColor = $state("");
    let logRef = $state<HTMLDivElement | null>(null);
    let validationMsg = $state("");
    let validationOk = $state(true);
    let savedTemplates = $state<SavedTemplate[]>([]);
    let saveName = $state("");
    let showSaveDialog = $state(false);
    let activeTab = $state<"commands" | "saved" | "http">("commands");
    let selectedSavedIdx = $state(-1);

    // ---- HTTP request state ----
    let httpPath = $state("/");
    let httpMethod = $state("GET");
    let httpHeaders = $state('{"Accept": "text/html,application/json"}');
    let httpBody = $state("");
    let httpSending = $state(false);

    function loadCmdTemplate(cmd: CmdEntry) {
        payloadText = JSON.stringify({ action: cmd.action, data: cmd.data }, null, 2);
        payloadLabel = `${cmd.action} — ${cmd.desc}`;
        authenticated = true;
        runValidation();
    }

    // ---- Validation ----
    function validatePayload(): { ok: boolean; msg: string } {
        if (!payloadText.trim()) return { ok: true, msg: "" };
        let json: Record<string, unknown>;
        try { json = JSON.parse(payloadText); } catch (e) {
            return { ok: false, msg: `JSON 语法错误: ${(e as Error).message}` };
        }
        const action = json.action;
        if (typeof action !== "string") return { ok: false, msg: "缺少 action 字段 (string)" };

        // Check against known commands
        const def = CMD_LOOKUP[action];
        if (!def) {
            return { ok: true, msg: `⚠ action "${action}" 不在已知命令列表中` };
        }
        if (typeof json.data !== "object" || json.data === null) {
            return { ok: false, msg: "缺少 data 字段 (必须是对象)" };
        }
        return { ok: true, msg: `✅ ${def.desc}${def.requireAuth ? " (需认证)" : " (无需认证)"}` };
    }

    // ---- Helpers ----
    function ts(): string {
        const n = new Date();
        const p = (x: number, l = 2) => String(x).padStart(l, "0");
        return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}.${p(n.getMilliseconds(), 3)}`;
    }
    function addLog(type: LogEntry["type"], text: string) {
        logEntries = [...logEntries, { type, text, time: ts() }];
        tick().then(() => { if (logRef) logRef.scrollTop = logRef.scrollHeight; });
    }
    function clearLog() { logEntries = []; }

    function loadSavedTemplate(t: SavedTemplate, idx: number) {
        payloadText = JSON.stringify(t.payload, null, 2);
        payloadLabel = t.name;
        authenticated = !t.noauth;
        selectedSavedIdx = idx;
        runValidation();
    }

    // ---- Validation on input ----
    function runValidation() {
        const result = validatePayload();
        validationOk = result.ok;
        validationMsg = result.msg;
    }

    // ---- Saved templates (localStorage) ----
    const STORAGE_KEY = "cfms-dev-saved-templates";
    function loadSavedTemplates() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            savedTemplates = raw ? JSON.parse(raw) : [];
        } catch { savedTemplates = []; }
    }
    function persistSavedTemplates() {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(savedTemplates));
    }
    function saveAsNewTemplate() {
        saveName = payloadLabel !== "—" ? payloadLabel : "";
        showSaveDialog = true;
        setTimeout(() => {
            const input = document.getElementById("saveNameInput") as HTMLInputElement;
            input?.focus();
        }, 50);
    }
    function confirmSaveNew() {
        const name = saveName.trim();
        if (!name) return;
        let json: Record<string, unknown>;
        try { json = JSON.parse(payloadText); } catch { addLog("error", "JSON 无效，无法保存"); return; }
        savedTemplates = [...savedTemplates, { name, payload: json, noauth: !authenticated, savedAt: Date.now() }];
        persistSavedTemplates();
        addLog("info", `💾 已保存模板: ${name}`);
        saveName = "";
        showSaveDialog = false;
        selectedSavedIdx = savedTemplates.length - 1;
        payloadLabel = name;
    }
    function cancelSave() {
        saveName = "";
        showSaveDialog = false;
    }
    function overwriteSaved(idx: number) {
        if (idx < 0 || idx >= savedTemplates.length) return;
        const name = savedTemplates[idx].name;
        let json: Record<string, unknown>;
        try { json = JSON.parse(payloadText); } catch { addLog("error", "JSON 无效，无法覆盖"); return; }
        savedTemplates[idx] = { name, payload: json, noauth: !authenticated, savedAt: Date.now() };
        persistSavedTemplates();
        addLog("info", `📝 已覆盖模板: ${name}`);
    }
    function deleteSaved(idx: number) {
        if (idx < 0 || idx >= savedTemplates.length) return;
        const name = savedTemplates[idx].name;
        savedTemplates = savedTemplates.filter((_, i) => i !== idx);
        persistSavedTemplates();
        addLog("info", `🗑 已删除模板: ${name}`);
        if (selectedSavedIdx === idx) selectedSavedIdx = -1;
    }

    // ---- Send via Tauri IPC ----
    async function doSend() {
        if (!validationOk && validationMsg.includes("语法错误")) {
            addLog("error", validationMsg);
            return;
        }
        const txt = payloadText.trim();
        if (!txt) { addLog("warn", "Payload 为空"); return; }
        let json: unknown;
        try { json = JSON.parse(txt); } catch (e) {
            addLog("error", `JSON 解析错误: ${(e as Error).message}`);
            return;
        }
        const jsonStr = JSON.stringify(json);
        addLog("sent", `\u2192 ${authenticated ? "[AUTH]" : "[NOAUTH]"} ${jsonStr}`);
        statusInfo = "发送中..."; statusColor = "#58a6ff";
        try {
            const response = await invoke<string>("send_raw_request", { payload: jsonStr, authenticated });
            addLog("recv", `\u2190 ${response}`);
            statusInfo = "就绪"; statusColor = "";
        } catch (err) {
            const msg = typeof err === "string" ? err : ((err as Error).message ?? JSON.stringify(err));
            addLog("error", `\u2716 ${msg}`);
            statusInfo = "错误"; statusColor = "#f85149";
            setTimeout(() => { statusInfo = "就绪"; statusColor = ""; }, 2000);
        }
    }
    function sendReplay(count: number) {
        addLog("info", `\u23F3 批量发送 ${count} 次...`);
        for (let i = 0; i < count; i++) setTimeout(() => doSend(), i * 100);
    }

    // ---- HTTP request ----
    async function doHttpRequest() {
        if (!httpPath.trim()) { addLog("warn", "URL 路径不能为空"); return; }
        httpSending = true;
        const method = httpMethod.toUpperCase();
        addLog("sent", `\u2192 HTTP ${method} ${httpPath.trim()}`);
        statusInfo = "发送中..."; statusColor = "#58a6ff";
        try {
            const response = await invoke<string>("fetch_server_page", {
                path: httpPath.trim(),
                method,
                headers: httpHeaders.trim() || null,
                body: (method === "POST" || method === "PUT" || method === "PATCH") ? (httpBody.trim() || null) : null,
            });
            const parsed = JSON.parse(response);
            const status = parsed.status;
            const statusEmoji = status < 300 ? "\u2705" : status < 400 ? "\u2139" : "\u274C";
            addLog("recv", `\u2190 HTTP ${status} ${parsed.url}`);
            // Log headers summary
            const headerKeys = Object.keys(parsed.headers || {}).join(", ");
            if (headerKeys) addLog("info", `   Headers: ${headerKeys}`);
            // Log body preview (first 2000 chars)
            const bodyPreview = (parsed.body || "").substring(0, 2000);
            addLog("info", `   Body (${(parsed.body || "").length} bytes):\n${bodyPreview}${(parsed.body || "").length > 2000 ? "\n... (truncated)" : ""}`);
            statusInfo = `${statusEmoji} HTTP ${status}`; statusColor = status < 300 ? "#3fb950" : status < 400 ? "#d2991d" : "#f85149";
        } catch (err) {
            const msg = typeof err === "string" ? err : ((err as Error).message ?? JSON.stringify(err));
            addLog("error", `\u2716 ${msg}`);
            statusInfo = "错误"; statusColor = "#f85149";
        } finally {
            httpSending = false;
            setTimeout(() => { statusInfo = "就绪"; statusColor = ""; }, 3000);
        }
    }
    function onKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); doSend(); }
    }

    // Auto-validate on input change
    $effect(() => { void payloadText; runValidation(); });
</script>

<svelte:head>
    <title>CFMS 命令测试工具</title>
</svelte:head>

{#if import.meta.env.DEV}
    <div class="tester">
        <!-- Toolbar -->
        <div class="toolbar">
            <label class="auth-toggle">
                <input type="checkbox" bind:checked={authenticated} />
                <span>附带认证</span>
            </label>
            <span class="status" style="color: {statusColor || 'var(--text-muted)'}">{statusInfo}</span>
            <span class="validation {validationOk ? 'val-ok' : 'val-err'}">{validationMsg || "输入 JSON"}</span>
            <button class="btn btn-save" onclick={saveAsNewTemplate}>💾 保存模板</button>
            {#if selectedSavedIdx >= 0}
                <button class="btn btn-save" onclick={() => overwriteSaved(selectedSavedIdx)}>📝 覆盖当前</button>
            {/if}
            <button class="btn btn-send" onclick={doSend}>📤 发送</button>
            <button class="btn btn-replay" onclick={() => sendReplay(5)}>🔄 ×5</button>
            <button class="btn btn-replay" onclick={() => sendReplay(10)}>🔥 ×10</button>
            <button class="btn btn-clear" onclick={clearLog}>🗑 清空</button>
        </div>

        <div class="main-content">
            <!-- Left: Templates -->
            <div class="left-panel">
                <!-- Tab bar -->
                <div class="tab-bar">
                    <button class="tab-btn" class:active={activeTab === "commands"} onclick={() => activeTab = "commands"}>📋 命令模板</button>
                    <button class="tab-btn" class:active={activeTab === "saved"} onclick={() => activeTab = "saved"}>💾 已保存 ({savedTemplates.length})</button>
                    <button class="tab-btn" class:active={activeTab === "http"} onclick={() => activeTab = "http"}>🌐 HTTP 请求</button>
                </div>

                {#if activeTab === "commands"}
                    <div class="cmd-list">
                        {#each COMMAND_CATEGORIES as cat}
                            <div class="cmd-group-header">{cat.label}</div>
                            {#each cat.cmds as cmd}
                                <button class="cmd-item" onclick={() => loadCmdTemplate(cmd)}>
                                    <span class="cmd-name">{cmd.action}</span>
                                    <span class="cmd-desc">{cmd.desc}</span>
                                    {#if !cmd.requireAuth}
                                        <span class="cmd-badge noauth">无需认证</span>
                                    {/if}
                                </button>
                            {/each}
                        {/each}
                    </div>
                {:else if activeTab === "saved"}
                    <div class="saved-list">
                        {#if savedTemplates.length === 0}
                            <div class="saved-empty">暂无已保存模板<br/>编辑 JSON 后点击 💾 保存模板</div>
                        {:else}
                            {#each savedTemplates as t, i}
                                <div
                                    class="saved-item"
                                    class:selected={i === selectedSavedIdx}
                                    onclick={() => loadSavedTemplate(t, i)}
                                    onkeydown={(e) => e.key === "Enter" && loadSavedTemplate(t, i)}
                                    role="button"
                                    tabindex="0"
                                >
                                    <span class="saved-name">{t.name}</span>
                                    <span class="saved-meta">{t.noauth ? "无认证" : "带认证"} · {new Date(t.savedAt).toLocaleString()}</span>
                                    <button class="saved-del" onclick={(e) => { e.stopPropagation(); deleteSaved(i); }} title="删除">✕</button>
                                </div>
                            {/each}
                        {/if}
                    </div>
                {:else}
                    <!-- HTTP Request Form -->
                    <div class="http-form">
                        <div class="http-row">
                            <select class="http-method" bind:value={httpMethod}>
                                <option>GET</option>
                                <option>POST</option>
                                <option>PUT</option>
                                <option>DELETE</option>
                                <option>PATCH</option>
                                <option>HEAD</option>
                            </select>
                            <input
                                class="http-path"
                                type="text"
                                bind:value={httpPath}
                                placeholder="/path/to/page"
                                onkeydown={(e) => e.key === "Enter" && doHttpRequest()}
                            />
                        </div>
                        <div class="http-section-label">Headers (JSON)</div>
                        <textarea
                            class="http-textarea"
                            bind:value={httpHeaders}
                            placeholder={'{"Accept": "text/html"}'}
                            spellcheck="false"
                            rows="3"
                        ></textarea>
                        {#if httpMethod === "POST" || httpMethod === "PUT" || httpMethod === "PATCH"}
                            <div class="http-section-label">Body</div>
                            <textarea
                                class="http-textarea"
                                bind:value={httpBody}
                                placeholder="Request body..."
                                spellcheck="false"
                                rows="4"
                            ></textarea>
                        {/if}
                        <button
                            class="btn btn-send http-send-btn"
                            onclick={doHttpRequest}
                            disabled={httpSending}
                        >
                            {httpSending ? "⏳ 发送中..." : `📤 发送 ${httpMethod}`}
                        </button>
                        <div class="http-hint">
                            使用当前连接的服务器地址，通过 HTTPS 请求自定义页面/API。
                        </div>
                    </div>
                {/if}
            </div>

            <!-- Top-Right: Payload Editor -->
            <div class="payload-panel">
                <div class="panel-header">
                    <span class="panel-title">📝 Payload</span>
                    <span class="panel-label">{payloadLabel}</span>
                    {#if showSaveDialog}
                        <div class="save-dialog">
                            <input id="saveNameInput" type="text" bind:value={saveName} placeholder="模板名称..." onkeydown={(e) => e.key === "Enter" && confirmSaveNew()} />
                            <button class="btn btn-send" style="padding:2px 8px;font-size:11px;" onclick={confirmSaveNew}>保存</button>
                            <button class="btn btn-clear" style="padding:2px 8px;font-size:11px;" onclick={cancelSave}>取消</button>
                        </div>
                    {/if}
                </div>
                <textarea
                    class="payload-editor"
                    bind:value={payloadText}
                    placeholder={'{"action": "server_info"}'}
                    spellcheck="false"
                    onkeydown={onKeydown}
                ></textarea>
            </div>

            <!-- Bottom-Right: Log -->
            <div class="log-panel">
                <div class="panel-header">
                    <span class="panel-title">📋 日志</span>
                    <span class="panel-count">{logEntries.length} 条</span>
                </div>
                <div class="log-console" bind:this={logRef}>
                    {#if logEntries.length === 0}
                        <div class="log-placeholder">通过 Tauri IPC 发送请求，响应将显示在此处</div>
                    {:else}
                        {#each logEntries as entry}
                            <div class="log-entry {entry.type}">
                                <span class="ts">{entry.time}</span>{entry.text}
                            </div>
                        {/each}
                    {/if}
                </div>
            </div>
        </div>
    </div>
{/if}

<style>
    /* ===== Reset & Vars ===== */
    .tester {
        --bg-primary: #0d1117;
        --bg-secondary: #161b22;
        --bg-tertiary: #1a1a2e;
        --border: #21262d;
        --text-primary: #c9d1d9;
        --text-secondary: #8b949e;
        --text-muted: #484f58;
        --blue: #58a6ff;
        --red: #f85149;
        --orange: #d2991d;
        --green: #3fb950;

        display: flex;
        flex-direction: column;
        height: 100%;
        font-family: "JetBrains Mono", "Noto Sans SC", monospace;
        font-size: 13px;
        background: var(--bg-primary);
        color: var(--text-primary);
    }

    /* ===== Toolbar ===== */
    .toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }
    .auth-toggle {
        display: flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        color: var(--text-secondary);
        cursor: pointer;
        user-select: none;
    }
    .status {
        font-size: 12px;
        margin-right: auto;
    }

    .btn {
        padding: 5px 12px;
        border: none;
        border-radius: 5px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
        white-space: nowrap;
        transition: all 0.15s;
    }
    .btn-save {
        background: #1a5c2a;
        color: #ccc;
    }
    .btn-save:hover {
        background: #22753a;
    }

    .validation {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 3px;
        margin-left: auto;
        margin-right: 8px;
        max-width: 320px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .val-ok { color: #3fb950; background: #1a2a1a; }
    .val-err { color: #f85149; background: #2a1a1a; }

    .save-dialog {
        display: flex;
        align-items: center;
        gap: 4px;
        margin-left: 8px;
    }
    .save-dialog input {
        width: 140px;
        padding: 2px 6px;
        border: 1px solid var(--border);
        border-radius: 3px;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 11px;
        outline: none;
    }
    .save-dialog input:focus { border-color: var(--blue); }

    /* ===== Main Layout ===== */
    .main-content {
        display: grid;
        grid-template-columns: 340px 1fr;
        grid-template-rows: 1fr 1fr;
        flex: 1;
        overflow: hidden;
        gap: 1px;
        background: var(--border);
    }

    /* ===== Left Panel ===== */
    .left-panel {
        grid-row: 1 / 3;
        display: flex;
        flex-direction: column;
        background: var(--bg-tertiary);
        overflow: hidden;
    }
    .tab-bar {
        display: flex;
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }
    .tab-btn {
        flex: 1;
        padding: 6px 8px;
        border: none;
        background: transparent;
        color: var(--text-secondary);
        font-family: inherit;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.15s;
        border-bottom: 2px solid transparent;
    }
    .tab-btn.active {
        color: var(--blue);
        border-bottom-color: var(--blue);
    }
    .tab-btn:hover:not(.active) { color: var(--text-primary); }

    /* Command list */
    .cmd-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
    }
    .cmd-group-header {
        padding: 8px 8px 4px;
        font-size: 11px;
        font-weight: 700;
        color: var(--text-secondary);
    }
    .cmd-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 6px 10px;
        margin: 1px 0;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        color: var(--text-primary);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.1s;
        line-height: 1.4;
    }
    .cmd-item:hover {
        border-color: var(--blue);
        background: #1a2035;
    }
    .cmd-name {
        font-weight: 600;
        display: block;
        font-size: 12px;
    }
    .cmd-desc {
        font-size: 10px;
        color: var(--text-secondary);
        display: block;
        margin-top: 1px;
    }
    .cmd-badge {
        font-size: 9px;
        padding: 1px 5px;
        border-radius: 3px;
        display: inline-block;
        margin-top: 2px;
    }
    .cmd-badge.noauth { background: #3a2020; color: #f85149; }

    /* Saved list */
    .saved-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
    }
    .saved-empty {
        color: var(--text-muted);
        text-align: center;
        padding: 30px 10px;
        font-size: 12px;
    }
    .saved-item {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        text-align: left;
        padding: 6px 10px;
        margin: 1px 0;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.1s;
    }
    .saved-item:hover { border-color: var(--blue); }
    .saved-item.selected { border-color: var(--green); background: #1a2a1a; }
    .saved-name { font-weight: 600; flex: 1; }
    .saved-meta { font-size: 10px; color: var(--text-muted); }
    .saved-del {
        font-size: 14px;
        color: #555;
        cursor: pointer;
        padding: 0 4px;
        background: none;
        border: none;
        font-family: inherit;
        line-height: 1;
    }
    .saved-del:hover { color: var(--red); }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 6px 12px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
        flex-shrink: 0;
    }
    .panel-title {
        font-weight: 600;
        font-size: 11px;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }
    .panel-count { font-size: 10px; color: var(--text-muted); }
    .panel-label { font-size: 11px; color: var(--text-muted); }

    /* ===== Payload Panel ===== */
    .payload-panel {
        display: flex;
        flex-direction: column;
        background: var(--bg-tertiary);
        overflow: hidden;
    }
    .payload-editor {
        flex: 1;
        padding: 10px;
        border: none;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        line-height: 1.5;
        resize: none;
        outline: none;
        tab-size: 2;
    }
    .payload-editor:focus { box-shadow: inset 0 0 0 1px var(--blue); }
    .payload-editor::placeholder { color: var(--text-muted); }

    /* ===== Log Panel ===== */
    .log-panel {
        display: flex;
        flex-direction: column;
        background: var(--bg-tertiary);
        overflow: hidden;
    }
    .log-console {
        flex: 1;
        padding: 8px;
        overflow-y: auto;
        background: var(--bg-primary);
        font-size: 11px;
        line-height: 1.5;
    }
    .log-placeholder { color: var(--text-muted); text-align: center; padding-top: 30px; }
    .log-entry { padding: 2px 0; white-space: pre-wrap; word-break: break-all; border-bottom: 1px solid #ffffff05; }
    .log-entry .ts { color: var(--text-muted); margin-right: 6px; }
    .log-entry.sent { color: #7ee787; }
    .log-entry.recv { color: var(--blue); }
    .log-entry.error { color: var(--red); }
    .log-entry.info { color: var(--text-secondary); }
    .log-entry.warn { color: var(--orange); }

    /* ===== HTTP Request Form ===== */
    .http-form {
        flex: 1;
        overflow-y: auto;
        padding: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
    }
    .http-row {
        display: flex;
        gap: 6px;
    }
    .http-method {
        width: 90px;
        padding: 6px 8px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-secondary);
        color: var(--blue);
        font-family: inherit;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        outline: none;
    }
    .http-method:focus { border-color: var(--blue); }
    .http-path {
        flex: 1;
        padding: 6px 10px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: "JetBrains Mono", monospace;
        font-size: 12px;
        outline: none;
    }
    .http-path:focus { border-color: var(--blue); }
    .http-path::placeholder { color: var(--text-muted); }
    .http-section-label {
        font-size: 10px;
        font-weight: 700;
        color: var(--text-secondary);
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-top: 4px;
    }
    .http-textarea {
        width: 100%;
        padding: 6px 8px;
        border: 1px solid var(--border);
        border-radius: 4px;
        background: var(--bg-primary);
        color: var(--text-primary);
        font-family: "JetBrains Mono", monospace;
        font-size: 11px;
        line-height: 1.4;
        resize: vertical;
        outline: none;
        tab-size: 2;
        box-sizing: border-box;
    }
    .http-textarea:focus { border-color: var(--blue); }
    .http-textarea::placeholder { color: var(--text-muted); }
    .http-send-btn {
        align-self: flex-start;
        margin-top: 4px;
    }
    .http-hint {
        font-size: 10px;
        color: var(--text-muted);
        line-height: 1.5;
        margin-top: 4px;
    }

    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #30363d; border-radius: 3px; }
    ::-webkit-scrollbar-thumb:hover { background: #484f58; }
</style>
