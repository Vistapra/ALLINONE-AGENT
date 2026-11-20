# 3D VIRTUAL OFFICE LAYOUT & DEPARTMENT SPECIFICATION (`OFFICE-LAYOUT-SPECIFICATION.md`)

Implementasi sumber:
- Pemetaan departemen & meja: [agent-identity.js](file:///${ALLINONE_HOME}/office-bridge/contracts/agent-identity.js)
- Engine scene 3D & A* pathfinding: [RetroOffice3D.tsx](file:///${ALLINONE_HOME}/hermes3d/source/src/features/retro-office/RetroOffice3D.tsx)
- Fallback 2D Pixel Office: [PixelOffice2D.tsx](file:///${ALLINONE_HOME}/hermes3d/source/src/features/pixel-office/PixelOffice2D.tsx)
- Persistensi tata letak: `${ALLINONE_HOME}\office-data\layouts\company-layout.json` & `${ALLINONE_HOME}\office-data\studio-state\`

---

## 1. Spatial Coordinate System & Navigation

- **Ukuran Lantai Kanvas:** `1800 × 1800` unit (`SCALE = 0.018` -> `32.4 × 32.4` meter dunia 3D `Three.js`).
- **Sistem Navigasi:** Grid `A*` (`buildNavGrid` + `astar`) dengan penghindaran rintangan furnitur/dinding (`isNavAreaFree`) dan pemisahan tabrakan antar-avatar (`applyAgentCollisionBumps`, `AGENT_RADIUS = 20`, `SEPARATION_STRENGTH = 3`).
- **Kontrol Kamera:**
  - **Isometric Overview (`SCENE_CAMERA_FOV = 40`):** Tampilan sinematik sudut isometrik seluruh perusahaan.
  - **Department Quick-Jump (`flyToCanvas`):** Lompatan kamera mulus ke 8 departemen dengan tombol pintas di bar atas.
  - **Perspective Third-Person Follow-Cam (`FOLLOW_CAMERA_FOV = 58`):** Mengikuti pergerakan avatar yang dipilih secara real-time.
  - **Orbit, Pan & Zoom:** Drag kiri untuk orbit, scroll untuk zoom in/out (`+` / `−`), `Space + Drag` untuk pan.

---

## 2. Eight Corporate Departments & Canonical Workstation Mapping

| Department ID | Nama Departemen | Kamera `(x, y)` | Karyawan AI yang Ditempatkan | Koordinat Workstation `(x, y, facing)` | Fasilitas Operasional |
|---|---|---|---|---|---|
| `executive` | **Executive Office** | `(260, 210)` | 1. `CEO Agent` (`Wave-1`)<br>2. `CTO Agent` (`Wave-2`) | `(220, 190, 0°)`<br>`(340, 190, 0°)` | Executive Desks, Company Overview Board, Strategy Monitor, Delegation Board |
| `engineering` | **Engineering Department** | `(560, 360)` | 3. `Backend Developer` (`Wave-1`)<br>4. `Frontend Developer` (`Wave-2`)<br>5. `DevOps Engineer` (`Wave-2`) | `(480, 340, 0°)`<br>`(600, 340, 0°)`<br>`(720, 340, 0°)` | Individual Workstations, Project Monitors, Development Status Board, Build Display |
| `qa_lab` | **Quality Assurance Laboratory** | `(1410, 310)` | 6. `QA Engineer` (`Wave-1`) | `(1410, 300, 180°)` | Test Dashboard, Regression Status, Test Execution Monitor, Acceptance Board |
| `soc` | **Security Operations Center** | `(860, 250)` | 7. `Security Lead` (`Wave-2`)<br>8. `Security Reviewer` (`Wave-1`)<br>9. `Findings Analyst` (`Wave-2`)<br>10. `Remediation Reviewer` (`Wave-2`) | `(820, 210, 0°)`<br>`(940, 210, 0°)`<br>`(820, 330, 180°)`<br>`(940, 330, 180°)` | VulnClaw Defensive Findings Dashboard, Risk Overview, Remediation Board |
| `compliance` | **Compliance Office** | `(260, 540)` | 11. `Report & Compliance Agent` (`Wave-2`) | `(260, 540, 90°)` | Evidence Archive, Audit Report Dashboard, Documentation Board |
| `meeting_room` | **Meeting Room** | `(560, 740)` | Peserta kolaborasi & rapat aktif | Kursi meja konferensi melingkar | Conference Table, Delegation Handoff Display, Action Item Tracker |
| `ops_center` | **Operations Control Center** | `(960, 680)` | Pemantauan layanan & pemeliharaan | Rak server & terminal kontrol | 12-Component Service Health, Runtime Telemetry, `03:00 WIB` Maintenance Status |
| `lobby` | **Lobby & Lounge** | `(320, 880)` | Area penerimaan & istirahat idle | Sofa & meja resepsionis | Reception Desk, Standby Lounge, Company Directory |
