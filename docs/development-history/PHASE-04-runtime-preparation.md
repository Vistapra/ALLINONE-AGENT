# PHASE 04 — RUNTIME & DEPENDENCY PREPARATION

## 1. Objective
Menyiapkan seluruh runtime yang dibutuhkan Paperclip (`Node.js >= 24.11.0`, `npm`, `pnpm`) dan VulnClaw (`Python >= 3.10` dalam virtual environment terpisah) serta mendefinisikan batas resource mesin tanpa mengubah Node.js global (`v20.16.0`) maupun Python environment Hermes (`3.11.16`).

## 2. Prerequisites
- `PHASE-03` (`PASS`) selesai.
- Portable `node-26.12.1-win32-x64`, `npm-12.2.2-win32-x64`, `pnpm-12.15.0-win32-x64`, `uv-0.13.5-win32-x64`, dan `python-3.14.9+20261021-win32-x64` terverifikasi di host.

## 3. Current Condition
- Global `node` pada `PATH` sistem adalah `v20.16.0` (dipakai oleh proyek lokal existing di `C:\laragon`).
- Hermes memakai managed Python `3.11.16` sendiri yang tidak boleh dicampur dengan paket eksternal.
- Docker tidak tersedia di host (`docker -> NOT FOUND`) dan RAM fisik `8,126.5 MB` tidak mendukung overhead VM Linux tambahan.

## 4. Technical Analysis
1. **Isolasi Runtime Paperclip:** Wrapper eksplisit `node26.cmd` (`v26.12.1`), `npm26.cmd` (`12.2.2`), dan `pnpm12.cmd` (`12.15.0`) ditempatkan di `${ALLINONE_HOME}\runtime\bin` sehingga Paperclip memperoleh Node `26.12.1` (`>= 24.11.0`) tanpa menyentuh `PATH` global Windows.
2. **Isolasi Runtime VulnClaw:** `uv venv` membuat environment terisolasi di `${ALLINONE_HOME}\runtime\vulnclaw-venv` berbasis CPython `3.14.9` (memenuhi `requires-python >= 3.10` dan `Programming Language :: Python :: 3.14` pada `pyproject.toml` VulnClaw).
3. **Evaluasi Docker:** Karena Docker tidak terpasang, RAM host 8 GB, dan CPU 2 core / 4 thread, pendekatan container ditolak secara teknis demi stabilitas desktop; isolasi dicapai melalui proses user-space terpisah, NTFS ACL ketat, penonaktifan seluruh MCP VulnClaw, dan pembatasan permukaan ke modul statis/defensif *on-demand*.
4. **Batas Resource:** Ditetapkan secara deklaratif di `${ALLINONE_HOME}\config\resource-limits.json` (`max_parallel_engineering_tasks = 1`, `paperclip_node_max_old_space_mb = 1024`, `min_free_disk_gb_c = 3.0`, `min_free_disk_gb_d = 2.0`, `worker_max_turns_per_run = 25`).

## 5. Implementation Plan
- Membuat `${ALLINONE_HOME}\config\resource-limits.json`.
- Membuat wrapper eksplisit `node26.cmd`, `npm26.cmd`, dan `pnpm12.cmd` di `${ALLINONE_HOME}\runtime\bin`.
- Membuat virtual environment `${ALLINONE_HOME}\runtime\vulnclaw-venv` dengan `uv`.
- Menjalankan uji diagnostik seluruh runtime dan ruang penyimpanan.

## 6. Actual Execution
- Menulis `resource-limits.json` dan membuat shim runtime terisolasi pada `${ALLINONE_HOME}\runtime\bin`.
- Menjalankan `uv venv ${ALLINONE_HOME}\runtime\vulnclaw-venv` menggunakan CPython `3.14.9`.
- Menjalankan verifikasi versi global vs isolated runtime serta sisa ruang disk `C:` dan `D:`.

## 7. Files Created
- `${ALLINONE_HOME}\config\resource-limits.json`
- `${ALLINONE_HOME}\runtime\bin\node26.cmd`
- `${ALLINONE_HOME}\runtime\bin\npm26.cmd`
- `${ALLINONE_HOME}\runtime\bin\pnpm12.cmd`
- `${ALLINONE_HOME}\runtime\vulnclaw-venv\`
- `${ALLINONE_HOME}\docs\PHASE-04-runtime-preparation.md`

## 8. Files Modified
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.json`
- `${ALLINONE_HOME}\IMPLEMENTATION-LEDGER.md`

## 9. Commands Executed
- `uv.exe venv ${ALLINONE_HOME}\runtime\vulnclaw-venv --python ...\python.exe`
- Pemeriksaan versi `node`, `node26.cmd`, `npm26.cmd`, `pnpm12.cmd`, `vulnclaw-venv\Scripts\python.exe`, dan `hermes.cmd --version`.

## 10. Test Scenarios
- **P04-T1:** Pastikan `node --version` global tetap `v20.16.0` sedangkan `node26.cmd --version` menghasilkan `v26.12.1` (`>= 24.11.0`).
- **P04-T2:** Pastikan `vulnclaw-venv\Scripts\python.exe --version` menghasilkan `Python 3.14.9` terpisah dari venv Hermes (`3.11.16`).
- **P04-T3:** Pastikan kapasitas bebas `C:` (`>= 3 GB`) dan `D:` (`>= 2 GB`) mencukupi.

## 11. Expected Results
- Semua runtime terisolasi berjalan normal tanpa konflik terhadap instalasi global maupun Hermes.

## 12. Actual Results
- **P04-T1 (`PASS`):** Global `node` = `v20.16.0`; `node26.cmd` = `v26.12.1`; `npm26.cmd` = `12.2.2`; `pnpm12.cmd` = `12.15.0`.
- **P04-T2 (`PASS`):** `vulnclaw-venv` = `Python 3.14.9`; Hermes = `v0.23.2+1033.g31ce88f.dirty` (`Python 3.11.16`, tidak tersentuh).
- **P04-T3 (`PASS`):** `C:` bebas `14.03 GB`, `D:` bebas `7.33 GB`.

## 13. Evidence
- Log eksekusi `task-1675.log` (`exit code 0`).

## 14. Problems Found
- Tidak ada konflik dependency atau kegagalan inisialisasi runtime.

## 15. Corrective Actions
- Tidak diperlukan.

## 16. Acceptance Criteria
- [x] Runtime Paperclip kompatibel (`Node v26.12.1 >= 24.11.0`).
- [x] Runtime VulnClaw kompatibel (`Python 3.14.9 >= 3.10` dalam isolated venv).
- [x] Runtime Hermes tidak berubah tanpa kebutuhan.
- [x] Tidak ada dependency conflicts.
- [x] Storage mencukupi (`C: 14.03 GB`, `D: 7.33 GB`).
- [x] Resource limits terdefinisi (`config/resource-limits.json`).
- [x] Runtime diagnostic tests lulus.

## 17. Final Status
`PASS`
