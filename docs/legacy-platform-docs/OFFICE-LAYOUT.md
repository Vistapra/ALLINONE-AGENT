# 3D VIRTUAL OFFICE LAYOUT GUIDE

> Full spatial coordinates, workstation slots, and asset licensing details are also documented in [OFFICE-LAYOUT-SPECIFICATION.md](file:///${ALLINONE_HOME}/OFFICE-LAYOUT-SPECIFICATION.md).

## 1. Eight Corporate Departments

| Department ID | Room Name | Assigned Company Roles | Facilities & Visual Displays |
| --- | --- | --- | --- |
| `executive` | **Executive Office** | `CEO Agent` (Wave-1), `CTO Agent` (Wave-2) | Executive desks, company overview board, strategy & delegation monitors |
| `engineering` | **Engineering Department** | `Backend Developer` (Wave-1), `Frontend Developer` (Wave-2), `DevOps Engineer` (Wave-2) | Individual developer workstations, project & build status displays |
| `qa_lab` | **Quality Assurance Laboratory** | `QA Engineer` (Wave-1) | Regression test monitor, test execution status, acceptance board |
| `soc` | **Security Operations Center** | `Security Reviewer` (Wave-1), `Security Lead` (Wave-2), `Findings Analyst` (Wave-2), `Remediation Reviewer` (Wave-2) | Defensive VulnClaw findings dashboard, CWE risk & remediation board |
| `compliance` | **Compliance Office** | `Report & Compliance Agent` (Wave-2) | Evidence archive, audit & compliance report dashboard |
| `meeting_room` | **Meeting Room** | Dynamic multi-agent collaboration participants | Governed conference table, active delegation & agenda display |
| `ops_center` | **Operations Control Center** | Platform health, maintenance & watchdog telemetry | 12-service functional health matrix, `03:00 WIB` maintenance monitor |
| `lobby` | **Lobby & Lounge** | Verified `IDLE` / `STANDBY` lounge zone | Reception & standby seating area |

## 2. Camera Navigation & Persistence
- **1-Click Department Presets:** Top bar buttons (`Exec`, `Eng`, `QA Lab`, `SOC`, `Compliance`, `Meeting`, `Ops`, `Lobby`) smoothly move the 3D camera to each room.
- **View Controls:** `ISO` (isometric reset), `+` / `-` (zoom), left-drag orbit, right-drag pan, scroll wheel zoom, plus **`3D` / `2D PIXEL`** mode switch.
- **Layout Storage:** Custom layout preferences persist outside Git at `${ALLINONE_HOME}\office-data\layouts\company-layout.json` via `GET/PUT /api/office-bridge/layout`.
