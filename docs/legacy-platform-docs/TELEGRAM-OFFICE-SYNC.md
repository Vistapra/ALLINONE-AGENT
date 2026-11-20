# TELEGRAM & 3D VIRTUAL OFFICE BIDIRECTIONAL SYNCHRONIZATION

## 1. Shared Single-Control-Plane Architecture
Telegram (`@YOUR_BOT_HANDLE_HERE`, Owner ID `YOUR_TELEGRAM_OWNER_ID_HERE`) and Hermes3D (`http://127.0.0.1:3200/office`) operate as **two synchronized Owner views over the exact same Paperclip + Hermes platform**:

- **Single Poller Invariant:** `\Hermes_Gateway` remains the **only** Telegram long-polling consumer (`getUpdates`). Neither Office Bridge nor Hermes3D ever polls Telegram or loads `TELEGRAM_BOT_TOKEN` into memory.
- **Owner-Only Authorization:** Both interfaces enforce Owner ID `YOUR_TELEGRAM_OWNER_ID_HERE` and isolate Owner personal Hermes memory (`state.db`) from the 11 `pc*` worker profiles.

---

## 2. Three Synchronized Operational Flows

### Flow A: Telegram -> Paperclip -> 3D Virtual Office
1. Owner sends `/create_task ...` or natural-language engineering instruction to `@YOUR_BOT_HANDLE_HERE`.
2. `integration/platform_cli.py` + `WorkflowEngine` records the `idempotency_key` in `workflow-ledger.db` (`task_ledger`) and creates the Paperclip issue.
3. Office Bridge receives Paperclip's live event + reconciles `task_ledger`, immediately broadcasting `task.created` / `run.started` to Hermes3D so the assigned avatar transitions to `WORKING` / `CODING` / `TESTING`.
4. Upon completion, Owner receives the sanitized Telegram summary while Hermes3D shows `COMPLETED`.

### Flow B: 3D Virtual Office -> Paperclip -> Telegram
1. Owner creates a task in Hermes3D (`Inspector` / Command Center -> `POST /api/company/tasks` -> Office Bridge `POST /api/office-bridge/tasks`).
2. Office Bridge validates `idempotency_key` (`commandIdempotencyCache`), creates the Paperclip issue, and optionally wakes the assigned Wave-1 agent.
3. Avatar executes in real time in the 3D Office; completion or explicit notification (`notify_telegram: true` / `POST /api/office-bridge/telegram/notify`) invokes `workflow_engine.send_owner_telegram_notification` out-of-process with secret redaction and deduplication.

### Flow C: Cross-Interface Cancellation & Status Updates
- Cancelling or pausing a task/agent from either Telegram (`/cancel_task`, `/pause_task`) or Hermes3D (`Cancel` / `Pause`) updates Paperclip immediately and reconciles across both interfaces within `1–3 seconds`.
