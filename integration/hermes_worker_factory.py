#!/usr/bin/env python3
"""Provision isolated Hermes named profiles for Paperclip roles.

Uses `<HERMES_ROOT>/profiles/<profile_id>` so Hermes shares the single installed Python venv
(`0 MB` duplicate venvs) while keeping `.env`, `config.yaml`, `SOUL.md`, `memories/`, `sessions/`,
and `state.db` 100% isolated from the Owner's default Telegram profile.
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")
ALLINONE_HERMES_HOME = os.environ.get("ALLINONE_HERMES_HOME") or str(Path.home() / "AppData" / "Local" / "hermes")


CUSTOM_PROVIDER_URL = os.environ.get("ALLINONE_CUSTOM_PROVIDER_URL") or "https://api.openai.com/v1"
PLATFORM_ROOT = Path(ALLINONE_HOME)
WORKERS_ROOT = PLATFORM_ROOT / "workers"
HERMES_DEFAULT_ROOT = Path(ALLINONE_HERMES_HOME)
PROFILES_ROOT = HERMES_DEFAULT_ROOT / "profiles"
SECRET_WORKER_ENV = PLATFORM_ROOT / "config" / "secrets" / "worker-llm.env"
HERMES_EXE = (ALLINONE_HERMES_HOME + r"\bin\hermes.exe")


def _to_profile_id(role_slug: str) -> str:
    clean = re.sub(r"[^a-z0-9]", "", role_slug.lower())
    if not clean.startswith("pc"):
        clean = "pc" + clean
    return clean[:24]


def provision_worker_home(
    role_slug: str,
    *,
    role_title: str,
    authorized_workspace: str,
    allowed_toolsets: list[str],
    extra_soul_rules: str = "",
) -> dict[str, str]:
    profile_id = _to_profile_id(role_slug)
    hermes_home = PROFILES_ROOT / profile_id
    role_meta_dir = WORKERS_ROOT / role_slug

    for sub in ("memories", "sessions", "skills", "logs", "plans", "workspace", "cron", "home"):
        (hermes_home / sub).mkdir(parents=True, exist_ok=True)
    role_meta_dir.mkdir(parents=True, exist_ok=True)

    # Mark --no-skills opt-out so `hermes update` never syncs 64 owner skills into worker profiles
    (hermes_home / ".no_bundled_skills").write_text("1\n", encoding="utf-8")

    # Lock NTFS ACL on worker profile directory
    sid_proc = subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-Command",
            "([Security.Principal.WindowsIdentity]::GetCurrent()).User.Value",
        ],
        capture_output=True,
        text=True,
        check=True,
    )
    sid = sid_proc.stdout.strip()
    subprocess.run(
        [
            "icacls.exe",
            str(hermes_home),
            "/inheritance:r",
            "/grant:r",
            f"*{sid}:(OI)(CI)F",
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
        ],
        capture_output=True,
        check=True,
    )

    # Copy ONLY stripped LLM provider credentials (no Telegram token, no CUA driver)
    existing_pc_key = ""
    env_dst = hermes_home / ".env"
    if env_dst.exists():
        for line in env_dst.read_text(encoding="utf-8", errors="ignore").splitlines():
            if line.startswith("PAPERCLIP_API_KEY="):
                existing_pc_key = line.strip()
                break
    shutil.copyfile(SECRET_WORKER_ENV, env_dst)
    if existing_pc_key:
        with env_dst.open("a", encoding="utf-8") as fh:
            fh.write(f"\n{existing_pc_key}\n")

    ws_norm = authorized_workspace.replace("\\", "/")
    config_yaml = f"""model:
  default: combo/X
  provider: custom
  base_url: {CUSTOM_PROVIDER_URL}
openrouter_base_url: {CUSTOM_PROVIDER_URL}
providers:
  custom:
    base_url: {CUSTOM_PROVIDER_URL}
    key_env: CUSTOM_API_KEY
_config_version: 54
updates:
  pre_update_backup: "off"
curator:
  backup:
    enabled: false
skills:
  ledger: false
terminal:
  backend: local
  home_mode: real
  persistent_shell: false
  timeout: 180
  client_env_passthrough:
    - PAPERCLIP_API_URL
    - PAPERCLIP_RUN_ID
    - PAPERCLIP_TASK_ID
    - PAPERCLIP_AGENT_ID
    - PAPERCLIP_COMPANY_ID
    - PAPERCLIP_WAKE_REASON
    - PAPERCLIP_WAKE_COMMENT_ID
  env_passthrough:
    - PAPERCLIP_API_KEY
code_execution:
  mode: project
network:
  force_ipv4: true
computer_use:
  cua_telemetry: false
  autostart: false
  no_overlay: true
approvals:
  mode: smart
  timeout: 60
  cron_mode: deny
  single_query_mode: deny
  unattended_mode: deny
"""
    (hermes_home / "config.yaml").write_text(config_yaml, encoding="utf-8")

    soul_md = f"""# Role Identity: {role_title} (`{role_slug}` / profile `{profile_id}`)
- Organization: **Unified AI Engineering & Operations** (Paperclip-orchestrated).
- Authorized workspace boundary: `{ws_norm}`.
- Permitted toolsets: `{", ".join(allowed_toolsets)}`.
- Windows Paperclip API note (`jq` is not installed on this Windows host; use Python `urllib.request` in `terminal` when updating Paperclip issues):
  ```bash
  python -c "import json, os, urllib.request; api=os.environ.get('PAPERCLIP_API_URL','http://127.0.0.1:3100/api').rstrip('/'); api=api if api.endswith('/api') else api+'/api'; tid=os.environ['PAPERCLIP_TASK_ID']; data=json.dumps({{'status':'done','comment':'Completed and verified.'}}).encode(); req=urllib.request.Request(api+'/issues/'+tid, data=data, method='PATCH', headers={{'Authorization':'Bearer '+os.environ['PAPERCLIP_API_KEY'],'X-Paperclip-Run-Id':os.environ.get('PAPERCLIP_RUN_ID',''),'Content-Type':'application/json'}}); urllib.request.urlopen(req, timeout=15).read()"
  ```
- Prohibited actions:
  1. Never read or modify Owner profile (`{ALLINONE_HERMES_HOME}` root `.env`, `state.db`, `memories/`), or `{ALLINONE_HOME}/config/secrets`.
  2. Never access or modify folders outside `{ws_norm}` unless explicitly listed in task scope.
  3. Never bypass UAC, alter Windows services/firewall, run offensive network scans, or self-escalate permissions.
  4. Never output or store API keys, tokens, or passwords in comments, files, or memory.
{extra_soul_rules}
""".strip() + "\n"
    (hermes_home / "SOUL.md").write_text(soul_md, encoding="utf-8")
    (role_meta_dir / "AGENTS.md").write_text(soul_md, encoding="utf-8")

    mem_file = hermes_home / "memories" / "MEMORY.md"
    if not mem_file.exists():
        mem_file.write_text(f"# Isolated Role Memory — {role_title}\n", encoding="utf-8")

    bridge_src = PLATFORM_ROOT / "paperclip" / "packages" / "adapters" / "hermes" / "skills" / "paperclip-task-bridge"
    if bridge_src.exists():
        bridge_dst = hermes_home / "skills" / "paperclip-task-bridge"
        if bridge_dst.exists():
            shutil.rmtree(bridge_dst)
        shutil.copytree(bridge_src, bridge_dst)

    manifest = {
        "role_slug": role_slug,
        "profile_id": profile_id,
        "role_title": role_title,
        "hermes_home": str(hermes_home),
        "instructions_file": str(role_meta_dir / "AGENTS.md"),
        "hermes_exe": HERMES_EXE,
        "authorized_workspace": authorized_workspace,
        "toolsets": ",".join(allowed_toolsets),
    }
    (role_meta_dir / "role-manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return manifest


def bind_agent_paperclip_key(hermes_home: str | Path, pc: object, agent_id: str, role_slug: str) -> None:
    """Mint (once) and bind an agent-scoped Paperclip API key into the isolated profile `.env`."""
    home = Path(hermes_home)
    env_file = home / ".env"
    marker = home / ".paperclip_key_meta.json"
    txt = env_file.read_text(encoding="utf-8", errors="ignore") if env_file.exists() else ""
    if marker.exists() and "PAPERCLIP_API_KEY=" in txt:
        try:
            meta = json.loads(marker.read_text(encoding="utf-8"))
            if meta.get("agent_id") == agent_id:
                return
        except Exception:
            pass
    created = pc.create_agent_key(agent_id, {"name": f"{role_slug}-profile-key"})  # type: ignore[attr-defined]
    token = str(created.get("token") or "").strip()
    if not token:
        raise RuntimeError(f"Paperclip create_agent_key for {agent_id} did not return a token")
    lines = [l for l in txt.splitlines() if not l.startswith("PAPERCLIP_API_KEY=")]
    lines.append(f"PAPERCLIP_API_KEY={token}")
    env_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    marker.write_text(
        json.dumps({"agent_id": agent_id, "key_id": created.get("id"), "role_slug": role_slug}, indent=2),
        encoding="utf-8",
    )

