//! Local network diagnostics for the dev-tools window.
//!
//! Kept out of the upstream `lib.rs` so that file only carries the one
//! `log_local_addresses` call in its bootstrap.

use std::net::IpAddr;

/// Best-effort detection of the local host addresses that would be used to
/// reach an external peer (the "egress" addresses), for IPv4 and IPv6.
///
/// Uses the well-known UDP socket trick: binding a UDP socket to the
/// unspecified address and "connecting" it to a public address makes the
/// kernel pick a source address without sending any packet. This is
/// dependency-free, works on every target platform (desktop and mobile), and
/// performs no actual network I/O. Returns a de-duplicated list of local IPs.
pub fn local_ip_addresses() -> Vec<IpAddr> {
    // Probe addresses (Google DNS / Cloudflare DNS / 114 DNS). Only the
    // routing decision matters; no packet is ever transmitted.
    const PROBES: &[&str] = &[
        "8.8.8.8:80",
        "1.1.1.1:80",
        "114.114.114.114:80",
        "[2001:4860:4860::8888]:80",
    ];

    let mut seen = std::collections::HashSet::new();
    let mut addresses = Vec::new();
    for probe in PROBES {
        let bind_addr = if probe.starts_with('[') {
            "[::]:0"
        } else {
            "0.0.0.0:0"
        };
        let Ok(socket) = std::net::UdpSocket::bind(bind_addr) else {
            continue;
        };
        if socket.connect(probe).is_err() {
            continue;
        }
        if let Ok(local) = socket.local_addr() {
            let ip = local.ip();
            if !ip.is_loopback() && seen.insert(ip) {
                addresses.push(ip);
            }
        }
    }
    addresses
}

/// Logs the detected local addresses once at startup.
pub fn log_local_addresses() {
    let addresses = local_ip_addresses();
    if addresses.is_empty() {
        tracing::warn!("Unable to determine local IP address(es)");
    } else {
        let joined = addresses
            .iter()
            .map(std::net::IpAddr::to_string)
            .collect::<Vec<_>>()
            .join(", ");
        tracing::info!("Local IP address(es): {joined}");
    }
}
