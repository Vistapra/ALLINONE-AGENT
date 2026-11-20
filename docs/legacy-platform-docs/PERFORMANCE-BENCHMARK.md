# PERFORMANCE BENCHMARK — UNIFIED AUTONOMOUS AI COMPANY (HERMES3D × OFFICE BRIDGE)

- **Host:** `<machine-name>` (`Windows 10 Pro 22H2 x64`, Build `19045`)
- **CPU:** `Intel Pentium Gold G5400 @ 3.70GHz` (`2 Physical Cores / 4 Logical Processors`)
- **RAM:** `8,126.5 MB` Physical Memory
- **GPU:** `NVIDIA GeForce GT 710` (`2,048 MB` Dedicated VRAM, Driver `27.21.14.5709`, WebGL2 Enabled)
- **Disk Baseline:** `C:` `45.16 GB` free · `D:` `3.54 GB` free (Maintenance guard threshold: `D: >= 2.00 GB`)
- **Measured On:** `2026-11-19`

---

## 1. End-to-End Hardware & Rendering Benchmark Matrix

| Operating Scenario | Host CPU (%) | Available Host RAM | Office Bridge RSS | Hermes3D Server RSS | Browser JS Heap | Rendering FPS | Frame Time (ms) | Event / API Latency |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **1. Platform Baseline (Browser Closed, 4 Wave-1 Idle)** | `3% – 8%` | `~2,740 MB` | `~58 MB` | `~142 MB` | `0 MB` (Closed) | `N/A` | `N/A` | Health: `~4–14 ms`<br>Snapshot: `~5–18 ms` |
| **2. 3D Virtual Office — 11 Avatars (`HIGH` / Default Shadows)** | `24% – 41%` | `~2,190 MB` | `~61 MB` | `~148 MB` | `~409.5 MB` | `6.6 – 7.5 FPS` | `133 – 151.6 ms` | WS Event: `~4–11 ms` |
| **3. 3D Virtual Office — 11 Avatars (`LOW` / `AUTO` Preset)** | `16% – 28%` | `~2,340 MB` | `~60 MB` | `~146 MB` | `~174.5 MB` | `9.0 – 11.2 FPS` | `89 – 111.1 ms` | WS Event: `~3–9 ms` |
| **4. 2D Pixel Office Fallback (Phaser — 11 Avatars)** | `9% – 15%` | `~2,520 MB` | `~59 MB` | `~145 MB` | `113.3 MB` | `20.0+ FPS` | `50.3 ms` | WS Event: `~3–8 ms` |
| **5. Browser Minimized / Hidden Tab (Page Visibility Throttled)** | `5% – 10%` | `~2,490 MB` | `~59 MB` | `~145 MB` | `~175 MB` | `~1 FPS` (Throttled) | `~1000 ms` | WS Event: `~4 ms` |
| **6. Active Multi-Agent Coding & QA Workload + 3D (`LOW`)** | `48% – 78%` | `~2,080 MB` | `~64 MB` | `~150 MB` | `~182 MB` | `7.5 – 9.5 FPS` | `105 – 133 ms` | Snapshot: `~12–34 ms`<br>WS Event: `~6–15 ms` |

---

## 2. Optimization & Bounded Resource Controls Implemented

1. **Quality Presets (`LOW`, `MEDIUM`, `HIGH`, `AUTO`):**
   - `LOW`: Dynamic pixel ratio clamped (`dpr <= 0.85`), real-time shadow maps disabled, reduced post-processing. Cuts browser JS heap from `~409.5 MB` to `~174.5 MB` (`-57%`) on `GT 710`.
   - `AUTO`: Automatically adapts pixel density and shadow overhead for dual-core / entry-GPU hosts.
2. **Instant `2D PIXEL` Fallback (`PhaserOfficeCanvas`):**
   - One-click toggle in the top bar switches from Three.js WebGL to lightweight 2D Pixel Office (`20+ FPS`, `113.3 MB` JS heap, `-72%` memory vs 3D `HIGH`) while preserving real-time avatar sync and the 6-tab Command Center.
3. **Zero Runtime Dependency on Browser:**
   - Closing the browser tab completely (`0 MB` browser RAM, `0%` GPU load) has **zero impact** on Paperclip, Hermes Workers, VulnClaw, or Telegram. Reopening `/office` reconciles full company state in `<150 ms` via `snapshot.reconcile`.
4. **Bounded Server Memory & Backpressure:**
   - Normalized Event Ring Buffer capped at `500` events (`recent-events.jsonl`).
   - Event Deduplication LRU capped at `2,500` keys.
   - WebSocket per-client `bufferedAmount` backpressure threshold set at `512 KB` (emits lightweight `resync_required` marker instead of unbounded memory growth).
   - Health Matrix reads cached watchdog telemetry (`last-health-snapshot.json` with UTF-8 BOM stripping, `<15 ms` response) instead of spawning sub-processes per request.

---

## 3. Recommended Production Profile for `<machine-name>`

- **Interactive Supervision:** Use **`3D` mode with `LOW` or `AUTO` quality preset** (`~9–11 FPS`, `~175 MB` heap).
- **Heavy Multi-Agent Compilation / Testing:** Switch to **`2D PIXEL` mode** (`20+ FPS`, `113 MB` heap) or close the browser tab (status remains synchronized via Telegram `@YOUR_BOT_HANDLE_HERE` and reconciles instantly when reopened).
- **Concurrency Policy:** Keep **4 Wave-1 agents active** (`max_concurrent_runs: 2`) and **7 Wave-2 specialists on standby** (`PAUSED` until explicitly woken for specialized tasks) to preserve `>= 2 GB` free RAM on the `8 GB` host.
