# AVATAR SYSTEM & VISUAL IDENTITY SPECIFICATION (`AVATAR-SYSTEM.md`)

Implementasi sumber:
- Mesh 3D artikulasi prosedural: [agents.tsx](file:///${ALLINONE_HOME}/hermes3d/source/src/features/retro-office/objects/agents.tsx)
- Potret SVG deterministik: [multiavatar.ts](file:///${ALLINONE_HOME}/hermes3d/source/src/lib/avatars/multiavatar.ts) (MIT License)
- Katalog profil visual 11 role: [agent-identity.js](file:///${ALLINONE_HOME}/office-bridge/contracts/agent-identity.js)

---

## 1. Licensing & Asset Provenance

- **3D Character Rig (`agents.tsx`):** Dibangun secara prosedural menggunakan geometri `Three.js` murni di bawah **MIT License** (tanpa ketergantungan karakter berhak cipta pihak ketiga).
- **2D Avatar Portraits (`multiavatar.js`):** Generator vektor deterministik berlisensi **MIT**.
- **Office Furniture & Lighting (`public/office-assets/`):** Furnitur `.glb` berlisensi **CC0 1.0 Public Domain** (Kenney) dan peta lingkungan HDRI `office_env_1k.hdr` berlisensi **CC0**.

---

## 2. Canonical 11-Employee Visual Identity Table

Setiap avatar dipetakan secara satu-ke-satu ke UUID kanonis `paperclip_agent_id` sehingga **tidak pernah terjadi duplikasi avatar** saat browser reconnect:

| # | Display Name | Canonical Paperclip ID | Dept | Visual Profile ID | Accent Color | Badge | Baseline Wave |
|---:|---|---|---|---|---|---|---|
| 1 | `CEO Agent` | `00000004-0000-4000-8000-000000000004` | `EXEC` | `vp-ceo-01` | `#f59e0b` (Amber Gold) | 👑 | Wave-1 (`ACTIVE`) |
| 2 | `CTO Agent` | `00000006-0000-4000-8000-000000000006` | `EXEC` | `vp-cto-02` | `#d97706` (Bronze) | 🏛️ | Wave-2 (`STANDBY`) |
| 3 | `Backend Developer` | `00000001-0000-4000-8000-000000000001` | `ENG` | `vp-backend-03` | `#2563eb` (Royal Blue) | ⚙️ | Wave-1 (`ACTIVE`) |
| 4 | `Frontend Developer` | `00000009-0000-4000-8000-000000000009` | `ENG` | `vp-frontend-04` | `#0ea5e9` (Sky Cyan) | 🎨 | Wave-2 (`STANDBY`) |
| 5 | `DevOps Engineer` | `00000005-0000-4000-8000-000000000005` | `ENG` | `vp-devops-05` | `#4f46e5` (Indigo) | 🚀 | Wave-2 (`STANDBY`) |
| 6 | `QA Engineer` | `0000000c-0000-4000-8000-00000000000c` | `QA LAB` | `vp-qa-06` | `#10b981` (Emerald) | 🧪 | Wave-1 (`ACTIVE`) |
| 7 | `Security Lead` | `00000003-0000-4000-8000-000000000003` | `SOC` | `vp-seclead-07` | `#dc2626` (Crimson) | 🛡️ | Wave-2 (`STANDBY`) |
| 8 | `Security Reviewer` | `0000000a-0000-4000-8000-00000000000a` | `SOC` | `vp-secreview-08` | `#ef4444` (Red Alert) | 🔍 | Wave-1 (`ACTIVE`) |
| 9 | `Findings Analyst` | `00000007-0000-4000-8000-000000000007` | `SOC` | `vp-findings-09` | `#f97316` (Orange) | 📊 | Wave-2 (`STANDBY`) |
| 10 | `Remediation Reviewer` | `00000002-0000-4000-8000-000000000002` | `SOC` | `vp-remreview-10` | `#e11d48` (Rose) | ✅ | Wave-2 (`STANDBY`) |
| 11 | `Report & Compliance Agent` | `00000008-0000-4000-8000-000000000008` | `COMP` | `vp-compliance-11` | `#8b5cf6` (Violet) | 📋 | Wave-2 (`STANDBY`) |

---

## 3. Supported Postures, Animations & Indicators

- **Postures & Motion:** `standing`, `sitting` (di kursi meja departemen), `walking` (mengikuti rute grid A* dengan `WALK_SPEED`), animasi mengetik/bekerja saat `retro_status === "working"`, dan orientasi badan (`facing`) menghadap monitor atau lawan kolaborasi.
- **Overhead Nameplate & Status Subtitle:** Menampilkan nama karyawan, singkatan departemen (`EXEC`, `ENG`, `QA LAB`, `SOC`, `COMP`), status aktivasi (`ACTIVE` vs `STANDBY`), dan `visual_state` aktual.
- **Selection & Spotlight:** Klik pada mesh 3D avatar mengarahkan fokus kamera ke avatar tersebut, menyalakan efek `SceneSpotlightEffect`, dan langsung membuka **Agent Inspector & Command Center** untuk karyawan tersebut.
