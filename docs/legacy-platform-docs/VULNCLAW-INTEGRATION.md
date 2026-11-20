# VulnClaw Defensive Security Integration (`VULNCLAW-INTEGRATION.md`)

## 1. Strict Defensive Scope

VulnClaw (`v0.4.1`, tag `0b34878f84b089b21fcf85ecd445315f14df0672`) diintegrasikan **murni sebagai mesin analisis keamanan defensif lokal**. Seluruh alur ofensif dinonaktifkan dan diblokir pada batas integrasi (`integration/vulnclaw_defensive.py`).

### Enabled Defensive Capabilities
- **Static Source & Configuration Review (`codescan` L1/L2):** Analisis AST/pola kode sumber pada direktori kerja yang telah diotorisasi (`${ALLINONE_HOME}\workspaces`, `tests`, `reports`) menghasilkan output JSON, SARIF 2.1.0, dan Markdown tersanitasi.
- **Defensive LLM Triage (`combo/X`):** Penilaian kemungkinan *false positive*, rasionalisasi prioritas, dan panduan remediasi defensif berbasis JSON murni tanpa eksekusi shell.
- **Structured Findings Lifecycle (`integration/findings_engine.py`):** Penyimpanan SQLite (`${ALLINONE_HOME}\data\findings\findings.db`), deduplikasi berbasis sidik jari SHA-256 (`fingerprint`), validasi format CWE/CVE (menolak CVE fiktif), sensor kredensial otomatis, dan netralisasi *prompt injection*.

### Blocked Capabilities (Enforced by Code & Config)
- `exploit`, `solve`, `run`, `persistent`, `recon`, `scan_network`, `python_execute`, `shell_command`, `http_probe_batch`, `traffic_repeat` -> memicu `PermissionError` pada `assert_capability_allowed()`.
- Seluruh MCP server dinonaktifkan (`enabled_mcp_servers = []`).
- Akses ke `${ALLINONE_HERMES_HOME}`, `${ALLINONE_HOME}\config\secrets`, dan `C:\Windows` ditolak keras (`PermissionError` pada `validate_authorized_scan_path()`).

## 2. Runtime & Environment Isolation

- **Isolated Virtualenv:** `${ALLINONE_HOME}\runtime\vulnclaw-venv\Scripts\python.exe` (`Python 3.14.9`, terpisah penuh dari venv Hermes `Python 3.11.16`).
- **Config Directory:** `${ALLINONE_HOME}\data\vulnclaw\config.yaml` (dikunci dengan NTFS ACL).
- **Scrubbed Process Env:** `build_isolated_vulnclaw_env()` hanya meneruskan variabel dasar OS Windows (`SystemRoot`, `COMSPEC`, `PATH` lokal venv, `VULNCLAW_CONFIG_DIR`), memastikan `0` variabel `HERMES_*`, `TELEGRAM_*`, atau `PAPERCLIP_*` bocor ke proses VulnClaw.

## 3. Findings Lifecycle & Paperclip Synchronization

Setiap temuan melewati siklus hidup teraudit pada tabel `findings` dan `finding_events`:

```text
IMPORTED ──► UNDER_REVIEW (Auto-creates Paperclip [Security Review] Issue)
                 ├──► FALSE_POSITIVE (Closed with audit rationale)
                 ├──► ACCEPTED_RISK  (Owner-acknowledged exception)
                 └──► CONFIRMED / REMEDIATION_REQUIRED (Auto-creates Paperclip [Remediation] Child Issue)
                           └──► IN_PROGRESS ──► READY_FOR_VERIFICATION ──► RESOLVED
```
