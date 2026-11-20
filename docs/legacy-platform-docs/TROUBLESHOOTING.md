# TROUBLESHOOTING RUNBOOK

## 1. 3D Virtual Office & Browser Issues

| Symptom | Root Cause | Resolution |
| --- | --- | --- |
| Redirected to `/login` when opening `http://127.0.0.1:3200/office` | Missing or expired `studio_access` HttpOnly cookie | Paste `studioAccessToken` from `${ALLINONE_HOME}\config\secrets\office-bridge-auth.json` into `/login`. |
| Low FPS (`<8 FPS`) during active coding/test builds on `GT 710` | Entry-level GPU (`GT 710` `2 GB`) fill-rate saturation | Select **`LOW`** quality in the top bar or click **`2D PIXEL`** (`20+ FPS`, `113 MB` heap). |
| Top bar shows orange **`STALE`** indicator | Office Bridge snapshot older than `60s` or Paperclip unreachable | Run `${ALLINONE_HOME}\ai-platform.cmd status` to check `PaperclipServer` (`3100`) and `OfficeVirtualCompany` (`3210`). |
| `403 Forbidden` when opening a path in Evidence Viewer | Path is outside authorized `workspaces/`, `reports/`, or `docs/` | Place project artifacts inside `${ALLINONE_HOME}\workspaces\<project>` (security path-jail blocks `C:\Windows`, `hermes`, and `secrets`). |

---

## 2. Service & Synchronization Recovery

```powershell
# Check all 7 Scheduled Tasks & 12 health components
${ALLINONE_HOME}\ai-platform.cmd status

# Restart Office Bridge + Hermes3D supervisor cleanly
Stop-ScheduledTask -TaskPath "\Hermes\" -TaskName "OfficeVirtualCompany"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'office-bridge|hermes3d' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Start-ScheduledTask -TaskPath "\Hermes\" -TaskName "OfficeVirtualCompany"

# Inspect supervisor & bridge logs
Get-Content ${ALLINONE_HOME}\logs\office-supervisor.log -Tail 40
Get-Content ${ALLINONE_HOME}\logs\office-bridge-stderr.log -Tail 40
```
