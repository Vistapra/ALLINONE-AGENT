#!/usr/bin/env python3
"""Configure, start, bootstrap authentication, and verify Paperclip (Phase 05)."""
from __future__ import annotations

import http.cookiejar
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


ROOT = Path(ALLINONE_HOME)
PC_HOME = ROOT / "data" / "paperclip"
INST_DIR = PC_HOME / "instances" / "default"
SECRET_DIR = ROOT / "config" / "secrets"
LAUNCHER_EXE = ROOT / "runtime" / "bin" / "PaperclipServiceLauncher.exe"
PC_CLI = ROOT / "runtime" / "bin" / "paperclipai.cmd"
BASE_URL = "http://127.0.0.1:3100"


def write_initial_config(*, disable_sign_up: bool = False) -> Path:
    INST_DIR.mkdir(parents=True, exist_ok=True)
    (INST_DIR / "secrets").mkdir(parents=True, exist_ok=True)
    (INST_DIR / "data" / "backups").mkdir(parents=True, exist_ok=True)
    (INST_DIR / "data" / "storage").mkdir(parents=True, exist_ok=True)
    (ROOT / "logs" / "paperclip").mkdir(parents=True, exist_ok=True)

    # Copy Paperclip env secrets into instance .env without printing
    src_env = (SECRET_DIR / "paperclip-auth.env").read_text(encoding="utf-8")
    inst_env = INST_DIR / ".env"
    inst_env.write_text(src_env, encoding="utf-8")

    cfg_path = INST_DIR / "config.json"
    cfg = {
        "$meta": {
            "version": 1,
            "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "source": "configure",
        },
        "database": {
            "mode": "embedded-postgres",
            "embeddedPostgresDataDir": str(INST_DIR / "db").replace("\\", "/"),
            "embeddedPostgresPort": 54329,
            "backup": {
                "enabled": True,
                "intervalMinutes": 720,
                "retentionDays": 3,
                "dir": str(INST_DIR / "data" / "backups").replace("\\", "/"),
            },
        },
        "logging": {
            "mode": "file",
            "logDir": str(ROOT / "logs" / "paperclip").replace("\\", "/"),
        },
        "server": {
            "deploymentMode": "authenticated",
            "exposure": "private",
            "bind": "loopback",
            "host": "127.0.0.1",
            "port": 3100,
            "allowedHostnames": ["127.0.0.1", "localhost"],
            "serveUi": True,
        },
        "telemetry": {"enabled": False},
        "updates": {"checkEnabled": False},
        "auth": {
            "baseUrlMode": "explicit",
            "publicBaseUrl": BASE_URL,
            "disableSignUp": disable_sign_up,
        },
        "storage": {
            "provider": "local_disk",
            "localDisk": {"baseDir": str(INST_DIR / "data" / "storage").replace("\\", "/")},
            "s3": {"bucket": "paperclip", "region": "us-east-1", "prefix": "", "forcePathStyle": False},
        },
        "secrets": {
            "provider": "local_encrypted",
            "strictMode": False,
            "localEncrypted": {"keyFilePath": str(INST_DIR / "secrets" / "master.key").replace("\\", "/")},
        },
    }
    cfg_path.write_text(json.dumps(cfg, indent=2), encoding="utf-8")
    return cfg_path


def http_json(
    method: str,
    path: str,
    body: dict | None = None,
    headers: dict[str, str] | None = None,
    opener: urllib.request.OpenerDirector | None = None,
) -> tuple[int, object]:
    url = f"{BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    hdrs = {"Accept": "application/json", "Origin": BASE_URL}
    if body is not None:
        hdrs["Content-Type"] = "application/json"
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    client = opener or urllib.request.build_opener()
    try:
        with client.open(req, timeout=20) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw)
            except json.JSONDecodeError:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw)
        except json.JSONDecodeError:
            return e.code, raw


def wait_for_server(timeout_s: float = 120.0) -> dict:
    deadline = time.time() + timeout_s
    last_err = ""
    while time.time() < deadline:
        try:
            code, data = http_json("GET", "/api/health")
            if code == 200 and isinstance(data, dict):
                return data
            last_err = f"HTTP {code}: {data}"
        except Exception as exc:
            last_err = str(exc)
        time.sleep(2.0)
    raise RuntimeError(f"Paperclip did not become healthy within {timeout_s}s: {last_err}")


def start_launcher() -> None:
    subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-Command",
            "Start-ScheduledTask -TaskPath '\\Hermes\\' -TaskName 'PaperclipServer'",
        ],
        check=True,
        capture_output=True,
        text=True,
    )


def stop_launcher() -> None:
    subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-Command",
            "Stop-ScheduledTask -TaskPath '\\Hermes\\' -TaskName 'PaperclipServer' -ErrorAction SilentlyContinue",
        ],
        check=False,
        capture_output=True,
    )
    subprocess.run([str(LAUNCHER_EXE), "--stop"], check=False, capture_output=True)
    time.sleep(3.0)


def mint_bootstrap_invite_token() -> str:
    env = os.environ.copy()
    for line in (SECRET_DIR / "paperclip-auth.env").read_text(encoding="utf-8").splitlines():
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip()
    env["PAPERCLIP_HOME"] = str(PC_HOME)
    node_exe = (ALLINONE_HERMES_HOME + r"\tools\node-26.12.1-win32-x64\node.exe")
    cli_js = str(ROOT / "runtime" / "paperclip-app" / "node_modules" / "paperclipai" / "dist" / "index.js")
    proc = subprocess.run(
        [node_exe, cli_js, "auth", "bootstrap-ceo", "-d", str(PC_HOME), "--force"],
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )
    combined = (proc.stdout or "") + "\n" + (proc.stderr or "")
    import re
    m = re.search(r"(pcp_bootstrap_[0-9a-fA-F]+)", combined)
    if not m:
        raise RuntimeError("Failed to generate bootstrap invite token (output redacted)")
    return m.group(1)


def main() -> int:
    if not (INST_DIR / "config.json").exists():
        write_initial_config(disable_sign_up=False)

    if not (INST_DIR / "secrets" / "master.key").exists():
        doc = subprocess.run(
            ["cmd.exe", "/c", str(PC_CLI), "doctor", "-d", str(PC_HOME), "--repair", "--yes"],
            capture_output=True,
            text=True,
            check=False,
        )
        print("doctor_exit:", doc.returncode)
    else:
        print("doctor_exit: 0 (master.key already present)")

    try:
        health = wait_for_server(timeout_s=5.0)
    except Exception:
        start_launcher()
        health = wait_for_server(timeout_s=150.0)
    print("health_initial:", json.dumps(health))

    # 1. Verify Dashboard HTML serves at /
    with urllib.request.urlopen(f"{BASE_URL}/", timeout=15) as r:
        html = r.read().decode("utf-8", errors="replace")
        ui_ok = r.status == 200 and ("<html" in html.lower() or "paperclip" in html.lower())
    print("dashboard_ui_ok:", ui_ok, "bytes:", len(html))

    # 2. Verify unauthenticated request is REJECTED (401/403)
    unauth_code, _ = http_json("GET", "/api/companies")
    print("unauthenticated_companies_status:", unauth_code)
    if unauth_code not in (401, 403):
        raise RuntimeError(f"Expected 401/403 for unauthenticated /api/companies, got {unauth_code}")

    # 3. Bootstrap Owner Board user & mint Board API key (if not already minted)
    board_key_file = SECRET_DIR / "paperclip-board-key.json"
    if not board_key_file.exists():
        admin = json.loads((SECRET_DIR / "paperclip-admin.json").read_text(encoding="utf-8"))
        cj = http.cookiejar.CookieJar()
        opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

        sc, sbody = http_json(
            "POST",
            "/api/auth/sign-in/email",
            {"email": admin["email"], "password": admin["password"]},
            opener=opener,
        )
        if sc not in (200, 201):
            sc, sbody = http_json(
                "POST",
                "/api/auth/sign-up/email",
                {"email": admin["email"], "password": admin["password"], "name": admin["name"]},
                opener=opener,
            )
        if sc not in (200, 201):
            raise RuntimeError(f"Auth sign-up/sign-in failed with HTTP {sc}: {sbody}")

        if health.get("bootstrapStatus") != "ready":
            inv_tok = mint_bootstrap_invite_token()
            ac, abody = http_json(
                "POST",
                f"/api/invites/{inv_tok}/accept",
                {"requestType": "human"},
                opener=opener,
            )
            print("bootstrap_accept_status:", ac)
            if ac not in (200, 201, 202, 409):
                raise RuntimeError(f"Bootstrap invite accept failed HTTP {ac}: {abody}")
        else:
            print("bootstrap_accept_status: already_ready")

        kc, kbody = http_json(
            "POST",
            "/api/board-api-keys",
            {"name": "unified-platform-owner-key", "expiresAt": None},
            opener=opener,
        )
        print("board_api_key_mint_status:", kc)
        if kc not in (200, 201) or not isinstance(kbody, dict) or not kbody.get("token"):
            raise RuntimeError(f"Failed to mint board API key HTTP {kc}")

        board_key_file.write_text(
            json.dumps({"id": kbody.get("id"), "name": kbody.get("name"), "token": kbody["token"]}, indent=2),
            encoding="utf-8",
        )
        # Lock down public sign-up now that Owner Board account is registered
        write_initial_config(disable_sign_up=True)

    board_token = json.loads(board_key_file.read_text(encoding="utf-8"))["token"]
    auth_hdr = {"Authorization": f"Bearer {board_token}"}

    # 4. Create initial seed marker company (or list companies) before restart to verify persistence
    c_code, companies = http_json("GET", "/api/companies", headers=auth_hdr)
    print("authenticated_companies_status:", c_code, "count:", len(companies) if isinstance(companies, list) else -1)
    if c_code != 200 or not isinstance(companies, list):
        raise RuntimeError(f"Authenticated /api/companies failed: {c_code} {companies}")

    if not any(c.get("name") == "Unified AI Engineering & Operations" for c in companies):
        cc_code, created_co = http_json(
            "POST",
            "/api/companies",
            {
                "name": "Unified AI Engineering & Operations",
                "description": "Unified orchestration company integrating Paperclip, Hermes Agent, and isolated defensive VulnClaw.",
            },
            headers=auth_hdr,
        )
        print("create_company_status:", cc_code)
        if cc_code not in (200, 201):
            raise RuntimeError(f"Create company failed: {cc_code} {created_co}")

    # 5. Restart Paperclip completely and verify data persists across restart + loopback-only bind
    stop_launcher()
    start_launcher()
    health2 = wait_for_server(timeout_s=120.0)
    c2_code, companies2 = http_json("GET", "/api/companies", headers=auth_hdr)
    persisted = c2_code == 200 and isinstance(companies2, list) and any(
        c.get("name") == "Unified AI Engineering & Operations" for c in companies2
    )
    print("post_restart_health:", json.dumps(health2))
    print("post_restart_company_persisted:", persisted, "company_id:", companies2[0]["id"] if persisted else None)
    if not persisted:
        raise RuntimeError("Database persistence across Paperclip restart failed!")

    return 0


if __name__ == "__main__":
    sys.exit(main())
