#!/usr/bin/env python3
"""Update IMPLEMENTATION-LEDGER.json and IMPLEMENTATION-LEDGER.md atomically."""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")


ROOT = Path(ALLINONE_HOME)
LEDGER_JSON = ROOT / "IMPLEMENTATION-LEDGER.json"
LEDGER_MD = ROOT / "IMPLEMENTATION-LEDGER.md"


def update_phases(updates: dict[str, str]) -> None:
    data = json.loads(LEDGER_JSON.read_text(encoding="utf-8"))
    data["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%S%z")
    for ph in data["phases"]:
        if ph["id"] in updates:
            ph["status"] = updates[ph["id"]]
    LEDGER_JSON.write_text(json.dumps(data, indent=2), encoding="utf-8")

    lines = [
        "# UNIFIED AUTONOMOUS AI AGENT PLATFORM — IMPLEMENTATION LEDGER",
        "",
        f"- **Host:** `{data['host']}`",
        f"- **Root Directory:** `{data['root_dir']}`",
        f"- **Last Updated:** `{data['updated_at']}`",
        "",
        "| Phase | Name | Status | Report |",
        "|---|---|---|---|",
    ]
    for ph in data["phases"]:
        lines.append(f"| `{ph['id']}` | {ph['name']} | `{ph['status']}` | `{ph['report']}` |")
    LEDGER_MD.write_text("\n".join(lines) + "\n", encoding="utf-8")


if __name__ == "__main__":
    pairs = {}
    for arg in sys.argv[1:]:
        k, v = arg.split("=", 1)
        pairs[k] = v
    update_phases(pairs)
    print("LEDGER_UPDATED:", pairs)
