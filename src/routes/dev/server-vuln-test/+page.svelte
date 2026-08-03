<script lang="ts">
    import { onMount, tick } from "svelte";
    import { goto } from "$app/navigation";
    import { invoke } from "@tauri-apps/api/core";

    onMount(() => {
        if (!import.meta.env.DEV) {
            goto("/home/overview", { replaceState: true });
        }
    });

    // ---- State ----
    let authenticated = $state(true);
    let payloadText = $state('{"action": "server_info"}');
    let payloadLabel = $state("—");
    let logEntries = $state<LogEntry[]>([]);
    let statusInfo = $state("就绪");
    let statusColor = $state("");
    let logRef = $state<HTMLDivElement | null>(null);

    interface VulnTemplate {
        id: string;
        grp: string;
        tag: string;
        name: string;
        desc: string;
        payload: Record<string, unknown>;
        noauth?: boolean;
    }

    interface LogEntry {
        type: "sent" | "recv" | "error" | "info" | "warn";
        text: string;
        time: string;
    }

    // ---- Vulnerability templates ----
    const vulnerabilities: VulnTemplate[] = [
        {
            id: "v01",
            grp: "🔴 严重",
            tag: "tag-critical",
            name: "V01: download_file 无需认证",
            desc: "直接调用下载 — 未设置 require_auth=True",
            payload: {
                action: "download_file",
                data: { task_id: "PLACEHOLDER_TASK_ID" },
            },
            noauth: true,
        },
        {
            id: "v02",
            grp: "🔴 严重",
            tag: "tag-critical",
            name: "V02: upload_file 无需认证",
            desc: "直接调用上传 — 未设置 require_auth=True",
            payload: {
                action: "upload_file",
                data: {
                    task_id: "PLACEHOLDER_TASK_ID",
                    file_size: 1024,
                    sha256: null,
                    file_name: "probe.txt",
                },
            },
            noauth: true,
        },
        {
            id: "v03",
            grp: "🔴 严重",
            tag: "tag-critical",
            name: "V03: claim_file_task 无身份验证",
            desc: "Task ID 即凭证 — 不校验请求者身份",
            payload: {
                action: "claim_file_task",
                data: { task_id: "PLACEHOLDER_TASK_ID" },
            },
            noauth: true,
        },
        {
            id: "v04",
            grp: "🟠 高危",
            tag: "tag-high",
            name: "V04: server_info 信息泄露",
            desc: "无需认证获取版本/扩展/锁定状态",
            payload: { action: "server_info" },
            noauth: true,
        },
        {
            id: "v05",
            grp: "🟠 高危",
            tag: "tag-high",
            name: "V05: 未认证请求重放",
            desc: "未认证请求无 nonce 保护, 可无限重放",
            payload: { action: "server_info" },
            noauth: true,
        },
        {
            id: "v06",
            grp: "🟠 高危",
            tag: "tag-high",
            name: "V06: 速率限制观察模式",
            desc: "rate_limit.mode=observe, 不拒绝",
            payload: { action: "server_info" },
            noauth: true,
        },
        {
            id: "v07",
            grp: "🟡 中危",
            tag: "tag-medium",
            name: "V07: 锁定白名单 bypass",
            desc: "download_file/upload_file 锁定模式仍可用",
            payload: {
                action: "download_file",
                data: { task_id: "PLACEHOLDER_TASK_ID" },
            },
            noauth: true,
        },
        {
            id: "v08",
            grp: "🟡 中危",
            tag: "tag-medium",
            name: "V08: DB 重置风险",
            desc: "init 文件删除后重建 DB",
            payload: { action: "server_info" },
            noauth: true,
        },
        {
            id: "v09",
            grp: "🟢 低危",
            tag: "tag-low",
            name: "V09: Debug 异常接口",
            desc: "探测 debug_raise_exception",
            payload: {
                action: "debug_raise_exception",
                data: { message: "security-probe" },
            },
            noauth: true,
        },
        {
            id: "v10",
            grp: "🟢 低危",
            tag: "tag-low",
            name: "V10: 未公开接口探测",
            desc: "自定义 action 探测隐藏接口",
            payload: { action: "list_users" },
            noauth: false,
        },
    ];

    // ---- Helpers ----
    function ts(): string {
        const n = new Date();
        const p = (x: number, l = 2) => String(x).padStart(l, "0");
        return `${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}.${p(n.getMilliseconds(), 3)}`;
    }

    function addLog(type: LogEntry["type"], text: string) {
        logEntries = [...logEntries, { type, text, time: ts() }];
        tick().then(() => {
            if (logRef) logRef.scrollTop = logRef.scrollHeight;
        });
    }

    function clearLog() {
        logEntries = [];
    }

    function loadTemplate(v: VulnTemplate) {
        payloadText = JSON.stringify(v.payload, null, 2);
        payloadLabel = v.name;
        if (v.noauth !== undefined) {
            authenticated = !v.noauth;
        }
    }

    // ---- Send via Tauri IPC ----
    async function doSend() {
        const txt = payloadText.trim();
        if (!txt) {
            addLog("warn", "Payload 为空");
            return;
        }

        let json: unknown;
        try {
            json = JSON.parse(txt);
        } catch (e) {
            addLog("error", `JSON 解析错误: ${(e as Error).message}`);
            return;
        }

        const jsonStr = JSON.stringify(json);
        const prefix = authenticated ? "[AUTH] " : "[NOAUTH] ";
        addLog("sent", `\u2192 ${prefix}${jsonStr}`);

        statusInfo = "发送中...";
        statusColor = "#58a6ff";

        try {
            const response = await invoke<string>("send_raw_request", {
                payload: jsonStr,
                authenticated,
            });
            addLog("recv", `\u2190 ${response}`);
            statusInfo = "就绪";
            statusColor = "";
        } catch (err) {
            const msg =
                typeof err === "string"
                    ? err
                    : ((err as Error).message ?? JSON.stringify(err));
            addLog("error", `\u2716 ${msg}`);
            statusInfo = "错误";
            statusColor = "#f85149";
            setTimeout(() => {
                statusInfo = "就绪";
                statusColor = "";
            }, 2000);
        }
    }

    function sendReplay(count: number) {
        addLog("info", `\u23F3 批量发送 ${count} 次...`);
        statusInfo = "批量发送中...";
        for (let i = 0; i < count; i++) {
            setTimeout(() => doSend(), i * 100);
        }
    }

    function onKeydown(e: KeyboardEvent) {
        if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
            e.preventDefault();
            doSend();
        }
    }
</script>

<svelte:head>
    <title>CFMS 服务器漏洞测试</title>
</svelte:head>

{#if import.meta.env.DEV}
    <div class="tester">
        <!-- Toolbar -->
        <div class="toolbar">
            <label class="auth-toggle">
                <input type="checkbox" bind:checked={authenticated} />
                <span>附带认证</span>
            </label>
            <span
                class="status"
                style="color: {statusColor || 'var(--text-muted)'}"
                >{statusInfo}</span
            >
            <button class="btn btn-send" onclick={doSend}>📤 发送</button>
            <button class="btn btn-replay" onclick={() => sendReplay(5)}
                >🔄 重放×5</button
            >
            <button class="btn btn-replay" onclick={() => sendReplay(10)}
                >🔥 洪泛×10</button
            >
            <button class="btn btn-clear" onclick={clearLog}>🗑 清空</button>
        </div>

        <div class="main-content">
            <!-- Left: Templates -->
            <div class="vuln-panel">
                <div class="panel-header">
                    <span class="panel-title">🎯 漏洞测试模板</span>
                    <span class="panel-count">10 项</span>
                </div>
                <div class="vuln-list">
                    {#each vulnerabilities as v}
                        {@const showGroup =
                            v === vulnerabilities[0] ||
                            v.grp !==
                                vulnerabilities[vulnerabilities.indexOf(v) - 1]
                                    ?.grp}
                        {#if showGroup}
                            <div class="vuln-group-header">{v.grp}</div>
                        {/if}
                        <button
                            class="vuln-item"
                            onclick={() => loadTemplate(v)}
                        >
                            <span class="vuln-name">{v.name}</span>
                            <span class="vuln-desc">{v.desc}</span>
                            <span class="vuln-tag {v.tag}"
                                >{v.grp.charAt(0)}</span
                            >
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Top-Right: Payload Editor -->
            <div class="payload-panel">
                <div class="panel-header">
                    <span class="panel-title">📝 请求 Payload (JSON)</span>
                    <span class="panel-label">{payloadLabel}</span>
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
                    <span class="panel-title">📋 通信日志</span>
                    <span class="panel-count">{logEntries.length} 条</span>
                </div>
                <div class="log-console" bind:this={logRef}>
                    {#if logEntries.length === 0}
                        <div class="log-placeholder">
                            通过 Tauri IPC 发送请求，响应将显示在此处
                        </div>
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
    .btn-send {
        background: var(--blue);
        color: #000;
    }
    .btn-send:hover {
        background: #4c9aff;
    }
    .btn-replay {
        background: #5533aa;
        color: #ccc;
    }
    .btn-replay:hover {
        background: #6644bb;
    }
    .btn-clear {
        background: #333;
        color: #ccc;
    }
    .btn-clear:hover {
        background: #444;
    }

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

    /* ===== Vuln Panel ===== */
    .vuln-panel {
        grid-row: 1 / 3;
        display: flex;
        flex-direction: column;
        background: var(--bg-tertiary);
        overflow: hidden;
    }
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
    .panel-count {
        font-size: 10px;
        color: var(--text-muted);
    }
    .panel-label {
        font-size: 11px;
        color: var(--text-muted);
    }

    .vuln-list {
        flex: 1;
        overflow-y: auto;
        padding: 4px;
    }
    .vuln-group-header {
        padding: 8px 8px 4px;
        font-size: 11px;
        font-weight: 700;
        color: var(--text-secondary);
    }
    .vuln-item {
        display: block;
        width: 100%;
        text-align: left;
        padding: 8px 10px;
        margin: 2px 0;
        border: 1px solid var(--border);
        border-radius: 5px;
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-family: inherit;
        font-size: 12px;
        cursor: pointer;
        transition: all 0.15s;
        line-height: 1.4;
    }
    .vuln-item:hover {
        border-color: var(--blue);
        background: #1a2035;
    }
    .vuln-name {
        font-weight: 600;
        display: block;
    }
    .vuln-desc {
        font-size: 11px;
        color: var(--text-secondary);
        display: block;
        margin-top: 2px;
    }
    .vuln-tag {
        font-size: 10px;
        padding: 1px 6px;
        border-radius: 3px;
        display: inline-block;
        margin-top: 4px;
    }
    .tag-critical {
        background: #3a1520;
        color: #e94560;
    }
    .tag-high {
        background: #3a2a10;
        color: #ff8c00;
    }
    .tag-medium {
        background: #2a2a10;
        color: #ffc107;
    }
    .tag-low {
        background: #152030;
        color: #58a6ff;
    }

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
    .payload-editor:focus {
        box-shadow: inset 0 0 0 1px var(--blue);
    }
    .payload-editor::placeholder {
        color: var(--text-muted);
    }

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
    .log-placeholder {
        color: var(--text-muted);
        text-align: center;
        padding-top: 30px;
    }
    .log-entry {
        padding: 2px 0;
        white-space: pre-wrap;
        word-break: break-all;
        border-bottom: 1px solid #ffffff05;
    }
    .log-entry .ts {
        color: var(--text-muted);
        margin-right: 6px;
    }
    .log-entry.sent {
        color: #7ee787;
    }
    .log-entry.recv {
        color: var(--blue);
    }
    .log-entry.error {
        color: var(--red);
    }
    .log-entry.info {
        color: var(--text-secondary);
    }
    .log-entry.warn {
        color: var(--orange);
    }

    ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
    }
    ::-webkit-scrollbar-track {
        background: transparent;
    }
    ::-webkit-scrollbar-thumb {
        background: #30363d;
        border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
        background: #484f58;
    }
</style>
