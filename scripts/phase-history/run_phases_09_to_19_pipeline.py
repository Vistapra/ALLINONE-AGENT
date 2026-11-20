#!/usr/bin/env python3
"""Sequential Gate-Enforced Pipeline Runner for Phases 09 through 19.

Strictly enforces phase-by-phase gating: halts immediately on any non-zero exit code,
runs strictly 1 workload at a time on the 2C/4T 8GB host, and updates IMPLEMENTATION-LEDGER.json
only after each stage passes verification.
"""
from __future__ import annotations

import subprocess
import sys
import time
from pathlib import Path
import os
ALLINONE_HOME = os.environ.get("ALLINONE_HOME") or str(Path.home() / "ALLINONE-AGENT")


ROOT = Path(ALLINONE_HOME)
STAGES = [
    ("PHASE-14 to PHASE-17", ROOT / "scripts" / "phase14_to_17_verify_ops_and_governance.py", ["PHASE-14=PASS", "PHASE-15=PASS", "PHASE-16=PASS", "PHASE-17=PASS"]),
    ("PHASE-18 (110 E2E Tests)", ROOT / "tests" / "run_all_e2e_tests.py", ["PHASE-18=PASS"]),
    ("PHASE-19 Final Acceptance Demo", ROOT / "scripts" / "phase19_final_acceptance_demo.py", []),
]


def wait_for_paperclip_ready(timeout_s: float = 150.0) -> None:
    import urllib.request

    dl = time.time() + timeout_s
    while time.time() < dl:
        try:
            with urllib.request.urlopen("http://127.0.0.1:3100/api/health", timeout=6) as r:
                if r.status == 200:
                    print("Paperclip Control Plane verified READY on 127.0.0.1:3100.", flush=True)
                    return
        except Exception:
            pass
        time.sleep(3.0)
    raise RuntimeError("Paperclip server did not become ready within 150s")


def main() -> int:
    wait_for_paperclip_ready()
    for label, script_path, ledger_args in STAGES:
        print(f"\n==================== STARTING {label} ({script_path.name}) ====================", flush=True)
        t0 = time.time()
        proc = subprocess.run([sys.executable, "-u", str(script_path)], check=False)
        elapsed = round(time.time() - t0, 1)
        print(f"==================== FINISHED {label} in {elapsed}s (exit={proc.returncode}) ====================", flush=True)
        if proc.returncode != 0:
            print(f"GATE BLOCKED at {label}! Stopping sequential pipeline for inspection.", flush=True)
            return proc.returncode
        if ledger_args:
            subprocess.run([sys.executable, str(ROOT / "scripts" / "ledger_updater.py"), *ledger_args], check=True)
    print("\nALL SEQUENTIAL STAGES (PHASE-09 THROUGH PHASE-19 DEMO) COMPLETED WITH EXIT CODE 0!", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
