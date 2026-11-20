// Clears Paperclip Windows PID-reuse & 'legacy_stop_unproven' holds on already-terminal runs.
// On Windows, Paperclip's POSIX `readProcessStartedAt` returns null, so if Windows recycles an old
// finished run's `process_pid` onto a system service (EPERM), `agentExecutionsHaveStopped` stays false.
// Clearing `process_pid` / `process_group_id` on already-finished terminal runs and acknowledging
// settled cancelled runs guarantees deterministic `pausing -> paused -> ready` lifecycle transitions.
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";
const pg = require(`${ALLINONE_HOME}\\runtime\\paperclip-app\\node_modules\\@paperclipai\\db\\node_modules\\pg`);

// Default matches the embedded, local-only Postgres instance's documented dev credentials
// (see INSTALLATION.md / docs/CONFIGURATION.md) — override via ALLINONE_POSTGRES_URL for any
// non-default install (different port, adopted instance, or a real password).
const POSTGRES_URL = process.env.ALLINONE_POSTGRES_URL || "postgres://paperclip:paperclip@127.0.0.1:54329/paperclip";

(async () => {
  const client = new pg.Client(POSTGRES_URL);
  await client.connect();
  try {
    // 1. Clear stale process_pid / process_group_id on already-finished terminal runs
    await client.query(
      `UPDATE heartbeat_runs
       SET process_pid = NULL,
           process_group_id = NULL
       WHERE status IN ('succeeded', 'failed', 'cancelled', 'timed_out', 'interrupted')
         AND finished_at IS NOT NULL
         AND (process_pid IS NOT NULL OR process_group_id IS NOT NULL)`
    );

    // 2. Acknowledge settled/finished cancelled legacy runs
    await client.query(
      `UPDATE heartbeat_runs
       SET execution_stage = COALESCE(execution_stage, 'settled'),
           result_json = coalesce(result_json, '{}'::jsonb)
             || jsonb_build_object(
                  'executionCancellation',
                  jsonb_build_object(
                    'state', 'acknowledged',
                    'acknowledgedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
                  )
                )
       WHERE status = 'cancelled'
         AND finished_at IS NOT NULL
         AND coalesce(result_json->'executionCancellation'->>'state', '') <> 'acknowledged'`
    );

    // 3. Clear retry backoff on any agent currently in 'pausing' so Paperclip settles immediately
    await client.query(
      `UPDATE agents
       SET lifecycle_operation = (lifecycle_operation - 'retryAt' - 'leaseOwner' - 'leaseUntil' - 'leaseHolder')
       WHERE lifecycle_state = 'pausing' AND lifecycle_operation IS NOT NULL`
    );

    // 4. Nudge Paperclip's delivery worker queue
    await client.query(`SELECT pg_notify('paperclip_delivery_work', 'agent_lifecycle')`).catch(() => {});
  } finally {
    await client.end();
  }
})().catch(() => process.exit(0));
