#!/usr/bin/env python3
"""Verify credential separation, NTFS ACL boundaries, and zero secret exposure across platform artifacts."""
from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
SECRET_DIR = ROOT / "config" / "secrets"
VC_DIR = ROOT / "data" / "vulnclaw"
HERMES_ENV = Path((ALLINONE_HERMES_HOME + r"\.env"))


def read_env(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def sha12(val: str) -> str:
    return hashlib.sha256(val.encode("utf-8")).hexdigest()[:12] if val else ""


def check_icacls_no_broad_groups(path: Path) -> tuple[bool, str]:
    proc = subprocess.run(
        ["icacls.exe", str(path)],
        capture_output=True,
        text=True,
        check=False,
    )
    text = proc.stdout + proc.stderr
    forbidden = ("Authenticated Users", "BUILTIN\\Users", "Everyone")
    bad = [g for g in forbidden if g.lower() in text.lower()]
    return (len(bad) == 0, text.strip() if not bad else f"Forbidden ACL principals present: {bad}")


def main() -> int:
    checks: list[dict[str, object]] = []

    # 1. ACL checks
    for label, p in [("secrets_dir_acl", SECRET_DIR), ("vulnclaw_data_acl", VC_DIR)]:
        ok, detail = check_icacls_no_broad_groups(p)
        checks.append({"check": label, "passed": ok, "detail": detail.splitlines()[0] if detail else ""})

    # 2. Distinct service credentials check
    h_env = read_env(HERMES_ENV)
    w_env = read_env(SECRET_DIR / "worker-llm.env")
    p_env = read_env(SECRET_DIR / "paperclip-auth.env")
    g_env = read_env(SECRET_DIR / "hermes-api-test.env")

    tg_tok = h_env.get("TELEGRAM_BOT_TOKEN", "")
    llm_key = h_env.get("CUSTOM_API_KEY", "")
    pc_auth = p_env.get("BETTER_AUTH_SECRET", "")
    pc_jwt = p_env.get("PAPERCLIP_AGENT_JWT_SECRET", "")
    pc_sign = p_env.get("PAPERCLIP_TOOL_ACTION_SIGNING_SECRET", "")
    hg_key = g_env.get("HERMES_ISOLATED_API_KEY", "")

    fps = [sha12(x) for x in (tg_tok, llm_key, pc_auth, pc_jwt, pc_sign, hg_key)]
    distinct_ok = all(fps) and len(set(fps)) == len(fps)
    checks.append({
        "check": "distinct_service_identities",
        "passed": distinct_ok,
        "detail": f"6 distinct non-empty credential fingerprints verified ({len(set(fps))}/6 unique)",
    })

    # 3. Worker env isolation (no Telegram token, no CUA driver)
    worker_clean = (
        "TELEGRAM_BOT_TOKEN" not in w_env
        and "HERMES_CUA_DRIVER_CMD" not in w_env
        and tg_tok not in (SECRET_DIR / "worker-llm.env").read_text(encoding="utf-8")
    )
    checks.append({"check": "worker_env_stripped_of_owner_secrets", "passed": worker_clean})

    # 4. VulnClaw isolation (no Telegram token, no Hermes paths, all MCP servers disabled)
    vc_cfg_text = (VC_DIR / "config.yaml").read_text(encoding="utf-8")
    vc_clean = (
        (not tg_tok or tg_tok not in vc_cfg_text)
        and "AppData\\Local\\hermes" not in vc_cfg_text
        and "enabled: true" not in vc_cfg_text.lower()
    )
    checks.append({"check": "vulnclaw_config_isolated_and_mcp_off", "passed": vc_clean})

    # 5. Scan all docs, reports, logs, scripts, and ledgers for accidental secret values
    secret_values = [s for s in (tg_tok, llm_key, pc_auth, pc_jwt, pc_sign, hg_key) if len(s) >= 12]
    admin_file = SECRET_DIR / "paperclip-admin.json"
    if admin_file.exists():
        adm = json.loads(admin_file.read_text(encoding="utf-8"))
        if adm.get("password"):
            secret_values.append(adm["password"])

    board_file = SECRET_DIR / "paperclip-board-key.json"
    if board_file.exists():
        bdata = json.loads(board_file.read_text(encoding="utf-8"))
        if bdata.get("token"):
            secret_values.append(bdata["token"])

    ob_file = SECRET_DIR / "office-bridge-auth.json"
    if ob_file.exists():
        obdata = json.loads(ob_file.read_text(encoding="utf-8"))
        for k in ("bridgeToken", "studioAccessToken"):
            if obdata.get(k):
                secret_values.append(obdata[k])

    leaked_files: list[str] = []
    scan_roots = [
        ROOT / "docs",
        ROOT / "reports",
        ROOT / "logs",
        ROOT / "scripts",
        ROOT / "integration",
        ROOT / "office-bridge",
        ROOT / "office-data" / "event-history",
        ROOT / "office-data" / "layouts",
        ROOT / "hermes3d" / "source" / ".next" / "static",
    ]
    top_files = list(ROOT.glob("*.md")) + [ROOT / "IMPLEMENTATION-LEDGER.json"]
    candidates: list[Path] = [f for f in top_files if f.exists()]
    for sr in scan_roots:
        if sr.exists():
            candidates.extend(p for p in sr.rglob("*") if p.is_file())

    for fpath in candidates:
        try:
            content = fpath.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for sv in secret_values:
            if sv in content:
                leaked_files.append(str(fpath))
                break

    checks.append({
        "check": "zero_secret_exposure_in_artifacts",
        "passed": len(leaked_files) == 0,
        "scanned_files": len(candidates),
        "leaked_files": leaked_files,
    })

    all_ok = all(bool(c["passed"]) for c in checks)
    print(json.dumps({"overall_passed": all_ok, "checks": checks}, indent=2))
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
