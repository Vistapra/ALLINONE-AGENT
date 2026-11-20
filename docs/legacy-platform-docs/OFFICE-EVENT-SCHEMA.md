# OFFICE REAL-TIME EVENT SCHEMA SPECIFICATION (`OFFICE-EVENT-SCHEMA.md`)

- **Schema Version:** `1.0`
- **Validator & Ring Buffer Implementation:** [event-schema.js](file:///${ALLINONE_HOME}/office-bridge/contracts/event-schema.js)
- **Live Synchronizer Implementation:** [realtime-synchronizer.js](file:///${ALLINONE_HOME}/office-bridge/events/realtime-synchronizer.js)
- **WebSocket Transport:**
  - Studio Browser Proxy: `ws://127.0.0.1:3200/api/company/events/ws?sinceSeq=<N>` (authenticated via `HttpOnly` `studio_access` cookie)
  - Direct Office Bridge Endpoint: `ws://127.0.0.1:3210/api/events/ws?sinceSeq=<N>` (authenticated via server-side `Bearer` token)

---

## 1. Canonical Envelope (`schema_version: "1.0"`)

```json
{
  "schema_version": "1.0",
  "event_id": "evt-9f8d12a4-33a1-4b2c-98a2-17a6b244e119",
  "event_type": "task.started",
  "source": "paperclip",
  "company_id": "0000000b-0000-4000-8000-00000000000b",
  "agent_id": "00000001-0000-4000-8000-000000000001",
  "task_id": "ad29a4ab-8a1e-4480-9e3c-4f2d3310fa21",
  "run_id": "43c9bfdc-4a32-4f42-8441-4dccbecfa836",
  "correlation_id": "corr-UNI-43",
  "sequence": 42,
  "timestamp": "2026-11-19T08:12:00.000Z",
  "payload": {
    "identifier": "UNI-45",
    "title": "Remediate invoice engine validation on isolated branch",
    "from_status": "todo",
    "to_status": "in_progress"
  }
}
```

---

## 2. Verified Event Categories & Upstream Sources

Tidak ada event yang dikarang tanpa bukti sumber data aktual:

| Category | Event Types | Verified Upstream Source |
|---|---|---|
| **Agent Lifecycle** | `agent.discovered`, `agent.updated`, `agent.activated`, `agent.paused`, `agent.health_changed` | Paperclip `GET /api/companies/:id/agents` & native WS `/events/ws` |
| **Task Lifecycle** | `task.created`, `task.assigned`, `task.started`, `task.updated`, `task.delegated`, `task.blocked`, `task.completed`, `task.failed`, `task.cancelled` | Paperclip `issues` + SQLite `workflow-ledger.db` (`task_ledger`) |
| **Worker Execution** | `run.started`, `run.heartbeat`, `run.completed`, `run.failed`, `run.cancelled` | Paperclip `live-runs` & `heartbeat-runs` (`hermes_local`) |
| **Verified Tool / Build / Test** | `tool.started`, `tool.completed`, `tool.failed`, `build.started`, `build.completed`, `test.started`, `test.completed` | **Hanya** dipancarkan ketika log/event aktual `/api/heartbeat-runs/:id/events` & `/log` membuktikan eksekusi tool kode, build, atau test runner |
| **Governance & Approval** | `approval.requested`, `approval.resolved` | Paperclip `/api/companies/:id/approvals` & stage `PENDING_APPROVAL` |
| **Defensive Security** | `finding.imported`, `finding.confirmed`, `finding.resolved` | SQLite `data\findings\findings.db` (`findings` & `finding_events`) |
| **Collaboration** | `meeting.started`, `meeting.updated`, `meeting.completed` | Workflow rapat terotorisasi di Paperclip + `office-data\event-history\meetings.json` |
| **Operations & Connectivity** | `maintenance.started`, `maintenance.completed`, `runtime.connected`, `runtime.disconnected` | `maintenance.lock`, `maintenance\state.json`, dan liveness koneksi Paperclip |

---

## 3. Reliability, Ordering, Stale Detection & Backpressure

1. **Monotonic Sequence & Replay (`?sinceSeq=N`):** Setiap event memperoleh integer `sequence` monotonik (`1, 2, 3...`). Saat klien WebSocket tersambung kembali dengan `?sinceSeq=N`, server langsung mengirim paket `snapshot.reconcile` berisi state terkini ditambah seluruh event yang terlewat (`sequence > N`).
2. **Idempotent Deduplication:** `NormalizedEventBus` menyimpan jendela geser `2,500` kunci deduplikasi (`dedupe_key`) sehingga pengulangan polling atau notifikasi ganda dari upstream tidak pernah memancarkan event duplikat (`stats.deduplicated`).
3. **Stale Event Detection:** Apabila `timestamp` event berusia lebih dari `60.000 ms` saat diterima, payload diberi penanda `"stale": true` sehingga engine visual tidak memicu animasi baru yang menyesatkan dari riwayat lama.
4. **Bounded Retention & Disk Rotation:** Buffer memori dibatasi maksimal `500` event dan dipersistensikan ke `${ALLINONE_HOME}\office-data\event-history\recent-events.jsonl` dengan pemadatan (*compaction*) otomatis setiap 250 event.
5. **WebSocket Backpressure Protection:** Apabila `ws.bufferedAmount > 512 KB` pada klien lambat, server menahan pengiriman delta dan mengirim sinyal ringan `{"type":"resync_required","latest_sequence":N}` untuk mencegah pembengkakan memori.
6. **Mandatory Recursive Secret Redaction:** Seluruh string dan objek di dalam `payload` melewati `sanitizePayload()` sebelum masuk ke ring buffer, disk, maupun soket WebSocket (`sk-*`, `pcp_*`, token bot Telegram, header `Bearer`, dan direktif prompt-injection dinetralkan otomatis).
