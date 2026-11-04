// Local network diagnostics command.
//
// The detection itself lives in `crate::custom::diagnostics`; this adapter only
// maps the addresses into the IPC shape the dev-tools window expects.

/// Return the local host IP addresses (IPv4 and IPv6) for diagnostic use.
#[tauri::command]
pub fn local_ip_addresses() -> Vec<String> {
    crate::custom::diagnostics::local_ip_addresses()
        .into_iter()
        .map(|ip| ip.to_string())
        .collect()
}
