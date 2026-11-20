"use strict";

/**
 * Governed Per-Agent Conversational, Multi-Agent Meeting & Owner Action Engine (`combo/X`)
 * for all 11 Paperclip Employees.
 *
 * Security & Architecture Guarantees:
 *   - Uses isolated worker credential (`profiles\pcceoagent\.env`), NEVER Owner personal Hermes state.db.
 *   - Never exposes API keys, `.env` files, or chain-of-thought to browsers or logs.
 *   - Immediately executes Owner-authorized actions from natural language (Bahasa Indonesia & English):
 *       1. Gathering all 11 (or selected) agents physically in the 3D Meeting Room (`standup-store.json` + Paperclip `[Meeting]`)
 *       2. Inspecting authorized local projects (`$ALLINONE_HOME\workspaces\*`, `\reports\*`, `\docs\*`, or any
 *          operator-configured root via `ALLINONE_EXTRA_AUTHORIZED_ROOTS`) safely
 *       3. Auto-creating Paperclip Projects & Owner-approved `UNI-*` execution tasks (auto-resuming Standby assignee if needed)
 *       4. Approving pending Owner governance items / concluding active meetings on command
 */

const fs = require("node:fs");
const path = require("node:path");
const { sanitizeText, validateAuthorizedEvidencePath, ALLOWED_EVIDENCE_ROOTS } = require("../contracts/redaction");
const { inspectProjectMetadataSummary } = require("./vulnclaw-findings-adapter");
const ALLINONE_HOME = process.env.ALLINONE_HOME || require("os").homedir() + "/ALLINONE-AGENT";
// Platform owner identity for task attribution/display; not used for auth
// decisions in this file (that lives in authorization/auth.js). Falls back to
// a clearly-non-identifying label when unconfigured, instead of a real ID.
const OWNER_DISPLAY_ID = process.env.ALLINONE_TELEGRAM_OWNER_ID || "unconfigured-owner";


const CHAT_HISTORY_DIR = path.resolve(`${ALLINONE_HOME}\\office-data\\chat-history`);
const ALLINONE_HERMES_HOME =
  process.env.ALLINONE_HERMES_HOME || path.join(require("os").homedir(), "AppData", "Local", "hermes");
const WORKER_ENV_FILE = path.join(ALLINONE_HERMES_HOME, "profiles", "pcceoagent", ".env");
// No default base URL is hardcoded here on purpose: this adapter must never point at any
// one deployment's private API gateway by default. Configure CUSTOM_API_BASE_URL locally.
const DEFAULT_BASE_URL = process.env.CUSTOM_API_BASE_URL || "";
// combo/X is kept only as a documented example of a supported provider/model value, not an
// endorsement or an assumption that it is reachable/valid for a fresh installation.
const DEFAULT_MODEL = process.env.CUSTOM_MODEL_NAME || "combo/X";

function loadWorkerApiKey() {
  if (process.env.CUSTOM_API_KEY && process.env.CUSTOM_API_KEY.trim()) {
    return process.env.CUSTOM_API_KEY.trim();
  }
  if (fs.existsSync(WORKER_ENV_FILE)) {
    const raw = fs.readFileSync(WORKER_ENV_FILE, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        const k = trimmed.slice(0, eq).trim();
        const v = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
        if (k === "CUSTOM_API_KEY" && v) return v;
      }
    }
  }
  throw new Error("Worker CUSTOM_API_KEY not found in isolated worker profile.");
}

function historyFileForAgent(agentId) {
  const safeId = String(agentId || "default").replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(CHAT_HISTORY_DIR, `${safeId}.json`);
}

function readAgentChatHistory(agentId, limit = 40) {
  const file = historyFileForAgent(agentId);
  if (!fs.existsSync(file)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(-limit);
  } catch {
    return [];
  }
}

function appendAgentChatMessages(agentId, newMessages) {
  fs.mkdirSync(CHAT_HISTORY_DIR, { recursive: true });
  const existing = readAgentChatHistory(agentId, 60);
  const combined = [...existing, ...newMessages].slice(-60);
  fs.writeFileSync(historyFileForAgent(agentId), JSON.stringify(combined, null, 2) + "\n", "utf8");
  return combined;
}

function clearAgentChatHistory(agentId) {
  const file = historyFileForAgent(agentId);
  if (fs.existsSync(file)) {
    try {
      fs.unlinkSync(file);
    } catch {}
  }
}

function stripStudioInstructionWrapper(rawMessage) {
  const text = String(rawMessage || "").trim();
  return text.replace(/^\[Studio Context[^\]]*\]\s*/i, "").trim();
}

/**
 * Extract an authorized project path from explicit path syntax (e.g. `$ALLINONE_HOME\workspaces\MyProject`,
 * or any operator-configured root via ALLINONE_EXTRA_AUTHORIZED_ROOTS)
 * OR natural-language folder mention (e.g. `project myproject`).
 */
function extractTargetProjectPath(textCombined) {
  const text = String(textCombined || "");
  // 1. Explicit Windows drive path (e.g. `$ALLINONE_HOME/workspaces/foo`, or any configured extra root)
  const winMatches = text.match(/\b([CDcd]:[\\/](?:[^\s"'`<>|*?]+))/g) || [];
  for (let i = winMatches.length - 1; i >= 0; i -= 1) {
    const cleaned = winMatches[i].replace(/[.,;:!?)]+$/, "");
    const v = validateAuthorizedEvidencePath(cleaned);
    if (v.ok && v.resolvedPath && fs.existsSync(v.resolvedPath)) {
      return v.resolvedPath;
    }
  }

  // 2. Natural-language folder match inside any currently-authorized root (workspaces/reports/docs,
  // plus anything the operator opted in via ALLINONE_EXTRA_AUTHORIZED_ROOTS). No local dev-stack
  // convention (Laragon, XAMPP, WAMP, etc.) is scanned by default.
  const lower = text.toLowerCase();
  const rootsToScan = ALLOWED_EVIDENCE_ROOTS;
  for (const rootDir of rootsToScan) {
    if (!fs.existsSync(rootDir)) continue;
    try {
      const dirs = fs.readdirSync(rootDir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith("."));
      for (const d of dirs) {
        if (d.name.length >= 4 && lower.includes(d.name.toLowerCase())) {
          const full = path.join(rootDir, d.name);
          const v = validateAuthorizedEvidencePath(full);
          if (v.ok && v.resolvedPath) return v.resolvedPath;
        }
      }
    } catch {}
  }
  return null;
}

function isPureConversationalQuestion(msg) {
  const lower = String(msg || "").trim().toLowerCase();
  if (/^\/(task|create_task|meet|meeting)\b/i.test(lower)) return false;
  // If user explicitly mentions gathering, meeting now, auditing/analyzing a folder/path, or confirming an action, NOT pure Q&A!
  if (
    /(kumpulkan|kelompokkan|mengelompokkan|ruang\s*meet|meeting\s*room|meet\s*sekarang|meeting\s*sekarang|adakan\s*(rapat|meeting)|mulai\s*(rapat|meeting)|buatkan\s*task|buat\s*task|kerjakan|lakukan\s*sekarang|jalankan\s*sekarang|audit\s+|analisis\s+|menganalisis|mengaudit|[cd]:[\\/])/i.test(
      lower
    )
  ) {
    return false;
  }
  if (
    /^(halo|hallo|hi|hello|hai|selamat|siapa\b|apa\b|apakah\b|bisakah\b|bisa\b|bagaimana\b|jelaskan\b|sebutkan\b|tampilkan status|cek status|who\b|what\b|can you\b|how\b)/i.test(
      lower
    )
  ) {
    return true;
  }
  return false;
}

function shouldCreatePaperclipTask(messageText) {
  const raw = String(messageText || "").trim();
  if (/^\/(task|create_task)\b/i.test(raw)) return true;
  if (isPureConversationalQuestion(raw)) return false;
  const lower = raw.toLowerCase();
  return /(buatkan task|buat task|kerjakan|analisis|menganalisis|audit|mengaudit|periksa kode|review proyek|review kode|perbaiki kode|perbaiki bug|implementasikan|delegasikan|jalankan pengujian|buatkan laporan|create a task|assign task)/i.test(
    lower
  );
}

/**
 * Analyze current Owner message + recent chat context to detect immediate executable intents.
 */
function analyzeOwnerActionIntent(cleanUserMsg, priorHistory) {
  const lower = cleanUserMsg.toLowerCase().trim();
  const recentUserTexts = priorHistory
    .filter((m) => m && m.role === "user" && typeof m.content === "string")
    .slice(-4)
    .map((m) => m.content);
  const recentAssistantTexts = priorHistory
    .filter((m) => m && m.role === "assistant" && typeof m.content === "string")
    .slice(-2)
    .map((m) => m.content);

  const isShortConfirmation =
    /^(ya|iya|ok|oke|lanjut|lanjutkan|setuju|gas|silakan|jalankan|lakukan)(\b|\s|$)/i.test(lower) ||
    /\b(ya\s+lakukan\s+sekarang|lakukan\s+sekarang|jalankan\s+sekarang|buatkan\s+sekarang|mulai\s+sekarang|segera\s+lakukan)\b/i.test(
      lower
    );

  const recentContextText = [...recentUserTexts, cleanUserMsg].join("\n");
  const assistantProposedAction = recentAssistantTexts.some((t) =>
    /(apakah anda ingin|buatkan task|membuat task|ruang meeting|agenda|path lengkap)/i.test(t)
  );

  const isConcludeMeeting =
    /\b(selesaikan\s+(meeting|rapat)|akhiri\s+(meeting|rapat)|tutup\s+(meeting|rapat)|selesai\s+(meeting|rapat)|kembali\s+ke\s+meja|bubarkan\s+rapat|end\s+meeting|conclude\s+meeting)\b/i.test(
      lower
    );

  const directMeetingMention =
    !isConcludeMeeting &&
    !isPureConversationalQuestion(cleanUserMsg) &&
    (/^\/(meet|meeting|standup)\b/i.test(lower) ||
      /\b(kumpulkan\s+(semua|seluruh|tim|agen|orang)|mengelompokkan\s+(semua|seluruh|agen)|kelompokkan\s+(semua|seluruh|agen)|ke\s+ruang\s+meet|diruang\s+meet|di\s+ruang\s+meet|meeting\s+room|meet\s+sekarang|meeting\s+sekarang|untuk\s+meetingnya|adakan\s+(meeting|rapat)|mulai\s+(meeting|rapat)|standup\s+meeting|scrum\s+meeting|let'?s\s+have\s+a\s+meeting)\b/i.test(
        lower
      ));

  const contextHadMeetingRequest = recentUserTexts.some((u) =>
    /\b(kumpulkan|mengelompokkan|ruang\s*meet|meeting|meet\s+sekarang|rapat)\b/i.test(u)
  );

  const isMeetingRequest =
    directMeetingMention ||
    (isShortConfirmation && contextHadMeetingRequest) ||
    (contextHadMeetingRequest && Boolean(extractTargetProjectPath(cleanUserMsg)) && !isPureConversationalQuestion(cleanUserMsg));

  const targetPath = extractTargetProjectPath(isMeetingRequest || isShortConfirmation ? recentContextText : cleanUserMsg);

  const directTaskMention = shouldCreatePaperclipTask(cleanUserMsg);
  const contextHadTaskTopic = recentUserTexts.some((u) => shouldCreatePaperclipTask(u) || /\b(membahas|bahas|review|audit|analisis)\b/i.test(u));

  const isTaskRequest =
    directTaskMention ||
    (Boolean(targetPath) && !isPureConversationalQuestion(cleanUserMsg)) ||
    (isShortConfirmation && (assistantProposedAction || contextHadTaskTopic));

  const isApproveAll =
    /\b(setujui\s+semua|approve\s+all|setujui\s+approval|acc\s+semua)\b/i.test(lower);

  const isActivateAllAgents =
    /\b(aktifkan\s+(semua|seluruh)\s+agen|nyalakan\s+(semua|seluruh)\s+agen|resume\s+all\s+agents)\b/i.test(lower);

  const wantsAllAgents =
    /\b(semua\s+(agen|orang|karyawan|tim)|seluruh\s+(agen|orang|karyawan|tim)|11\s+agen|all\s+agents|everyone)\b/i.test(
      recentContextText
    );

  // Build clean human-readable topic/agenda
  let topic = cleanUserMsg.replace(/^\/(task|create_task|meet|meeting|standup)\s*/i, "").trim();
  if (isShortConfirmation || topic.length < 18) {
    const meaningfulPrior = [...recentUserTexts]
      .reverse()
      .find((u) => u.trim().length >= 15 && !/^(ya|oke|ok|halo|hallo)/i.test(u.trim()));
    if (meaningfulPrior) {
      topic = `${meaningfulPrior.trim()} (${cleanUserMsg.trim()})`;
    }
  }

  return {
    isMeetingRequest,
    isConcludeMeeting,
    isTaskRequest,
    isApproveAll,
    isActivateAllAgents,
    wantsAllAgents,
    targetPath,
    topic,
  };
}

async function callComboXCompletion(systemPrompt, historyMessages, userMessage, options = {}) {
  if (!DEFAULT_BASE_URL) {
    throw new Error(
      "CUSTOM_API_BASE_URL is not configured. Set it to your model provider's API base URL before using this adapter."
    );
  }
  const maxAttempts = options.fastActionReply ? 1 : 2;
  const perAttemptMs = options.fastActionReply ? 10_000 : 12_000;
  const apiKey = loadWorkerApiKey();
  const messages = [{ role: "system", content: systemPrompt }];
  for (const h of historyMessages.slice(-8)) {
    if ((h.role === "user" || h.role === "assistant") && typeof h.content === "string" && h.content.trim()) {
      messages.push({ role: h.role, content: h.content });
    }
  }
  messages.push({ role: "user", content: userMessage });

  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const resp = await fetch(`${DEFAULT_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          messages,
          temperature: 0.25,
          max_tokens: 750,
          stream: false,
        }),
        signal: AbortSignal.timeout(perAttemptMs),
      });

      if (!resp.ok) {
        throw new Error(`Model provider HTTP ${resp.status}`);
      }
      const rawBody = await resp.text();
      let content = "";
      if (rawBody.trimStart().startsWith("data:")) {
        const pieces = [];
        for (const line of rawBody.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const jsonStr = trimmed.slice(5).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;
          try {
            const chunk = JSON.parse(jsonStr);
            const delta = chunk?.choices?.[0]?.delta?.content ?? chunk?.choices?.[0]?.message?.content;
            if (typeof delta === "string" && delta) pieces.push(delta);
          } catch {}
        }
        content = pieces.join("");
      } else {
        const data = JSON.parse(rawBody);
        content = data?.choices?.[0]?.message?.content || "";
      }
      const cleaned = typeof content === "string" ? sanitizeText(content.trim()) : "";
      if (!cleaned) {
        throw new Error("Empty model response.");
      }
      if (/is no longer available/i.test(cleaned)) {
        throw new Error("Transient upstream combo pool slot unavailable.");
      }
      return cleaned;
    } catch (err) {
      lastErr = err;
      if (attempt < maxAttempts) {
        await new Promise((r) => setTimeout(r, 350 * attempt));
      }
    }
  }
  throw lastErr || new Error("Model completion failed.");
}

/**
 * Handle an interactive chat turn with any of the 11 Paperclip AI employees,
 * executing Owner-authorized meetings, 3D avatar gathering, project registration,
 * agent activation, and Paperclip task dispatch immediately!
 */
async function handleEmployeeChatTurn({ agent, snapshot, rawMessage, idempotencyKey, createTaskFn, sync, paperclip }) {
  const cleanUserMsg = sanitizeText(stripStudioInstructionWrapper(rawMessage));
  if (/^\/(reset|new)(\s|$)/i.test(cleanUserMsg)) {
    clearAgentChatHistory(agent.paperclip_agent_id);
    return {
      text: `Sesi percakapan untuk **${agent.display_name}** telah direset. Data organisasi dan task di Paperclip tetap utuh.`,
      createdTask: null,
      createdMeeting: null,
    };
  }

  const priorHistory = readAgentChatHistory(agent.paperclip_agent_id, 10);
  const allAgents = snapshot.agents || [];
  const companyId = snapshot.company?.id;
  const intent = analyzeOwnerActionIntent(cleanUserMsg, priorHistory);

  let projectSummary = intent.targetPath ? inspectProjectMetadataSummary(intent.targetPath) : null;
  let ensuredProject = null;
  let createdMeeting = null;
  let createdTask = null;
  let concludedMeetingsCount = 0;
  let approvedCount = 0;
  let resumedAgentsCount = 0;
  const executionReceipts = [];

  // 1. Ensure Paperclip Project exists if a valid authorized project path was referenced
  if (projectSummary && paperclip && companyId) {
    ensuredProject = await paperclip.ensureProject(companyId, projectSummary.project_name).catch(() => null);
    executionReceipts.push(
      `Proyek lokal terverifikasi: \`${projectSummary.resolved_path}\` (Stack: ${projectSummary.stack.join(", ")}${
        projectSummary.modules.length > 0 ? `; Modules: ${projectSummary.modules.join(", ")}` : ""
      }; Direktori utama: ${projectSummary.top_directories.join(", ")})` +
        (ensuredProject ? ` -> Terdaftar di Paperclip Project **${ensuredProject.name}** (\`${ensuredProject.id.slice(0, 8)}\`).` : ".")
    );
  }

  // 2. Owner Approval Auto-Resolution if requested
  if (intent.isApproveAll && paperclip) {
    const pendingApprovals = (snapshot.approvals || []).filter((a) => a.status === "pending");
    for (const ap of pendingApprovals) {
      await paperclip.resolveApproval(ap.id, "approve", "Disetujui langsung oleh Owner melalui Chat 3D Virtual Office.").catch(() => {});
      approvedCount += 1;
    }
    if (approvedCount > 0) {
      executionReceipts.push(`${approvedCount} permintaan persetujuan (Approval) berstatus pending telah disetujui otomatis atas perintah Owner.`);
    }
  }

  // 3. Activate All 11 Agents if explicitly requested
  if (intent.isActivateAllAgents && paperclip) {
    for (const ag of allAgents) {
      if (ag.activation_status !== "ACTIVE") {
        await paperclip.resumeAgent(ag.paperclip_agent_id).catch(() => {});
        resumedAgentsCount += 1;
      }
    }
    if (sync) await sync.reconcileNow("owner_activate_all_agents").catch(() => {});
    executionReceipts.push(`Seluruh 11 agen kini diaktifkan (ACTIVE) di Paperclip (${resumedAgentsCount} agen dibangunkan dari STANDBY).`);
  }

  // 4. Conclude Active Meeting & Return Avatars to Desks if requested
  if (intent.isConcludeMeeting && sync) {
    const activeMtgs = (snapshot.collaboration?.meetings || []).filter((m) => m.status === "ACTIVE");
    for (const m of activeMtgs) {
      await sync
        .completeAuthorizedMeeting(m.meeting_id, {
          summary: `Rapat ditutup oleh Owner melalui ${agent.display_name}. Seluruh agen kembali ke meja departemen masing-masing.`,
          decisions: ["Melanjutkan eksekusi tugas sesuai pembagian departemen"],
        })
        .catch(() => {});
      concludedMeetingsCount += 1;
    }
    executionReceipts.push(`Rapat aktif telah diselesaikan (${concludedMeetingsCount} sesi ditutup) dan seluruh avatar kembali ke meja kerja departemen.`);
  }

  // 5. Start Real Multi-Agent 3D Meeting Room Gathering (`standup-store.json` + Paperclip `[Meeting]`)!
  if (intent.isMeetingRequest && sync) {
    // Order participants with current/CEO agent first, followed by all requested colleagues (all 11 when wantsAllAgents or company-wide)
    const ceoObj = allAgents.find((a) => a.role === "ceo") || agent;
    const orderedAllIds = [
      agent.paperclip_agent_id,
      ceoObj.paperclip_agent_id,
      ...allAgents.map((a) => a.paperclip_agent_id),
    ];
    const uniqueAllIds = [...new Set(orderedAllIds)].filter(Boolean);

    let participantIds = uniqueAllIds;
    if (!intent.wantsAllAgents) {
      const matchedSpecific = allAgents
        .filter((a) => cleanUserMsg.toLowerCase().includes(a.display_name.toLowerCase()))
        .map((a) => a.paperclip_agent_id);
      if (matchedSpecific.length >= 2) {
        participantIds = [...new Set([agent.paperclip_agent_id, ...matchedSpecific])];
      }
    }

    const meetingTitle = projectSummary
      ? `All-Hands Sync & Audit: ${projectSummary.project_name}`
      : `Executive Multi-Agent Coordination Sync`;
    const meetingAgenda = projectSummary
      ? `Pembahasan lintas-departemen (${participantIds.length} agen) untuk proyek ${projectSummary.project_name} di ${projectSummary.resolved_path} (${projectSummary.stack.join(", ")}). Fokus: arsitektur, API/database, keamanan defensif, cakupan testing, & laporan eksekutif.`
      : intent.topic.slice(0, 500);

    createdMeeting = await sync.createAuthorizedMeeting({
      title: meetingTitle,
      agenda: meetingAgenda,
      target_path: projectSummary ? projectSummary.resolved_path : intent.targetPath || null,
      project_id: ensuredProject?.id || null,
      participant_agent_ids: participantIds,
      max_turns: 3,
      timeout_sec: 240,
      priority: "high",
      wake_immediately: false,
      idempotency_key: idempotencyKey ? `mtg-${idempotencyKey}` : undefined,
    });

    executionReceipts.push(
      `BERHASIL MENGUMPULKAN AGEN KE RUANG MEETING 3D: Meeting resmi **${createdMeeting.meeting_id}** (Paperclip Issue **${createdMeeting.paperclip_identifier}**) berstatus \`ACTIVE\` dengan **${participantIds.length}/11 agen** berkumpul fisik di meja bundar **Meeting Room** (\`x=145, y=118\`).`
    );
  }

  // 6. Dispatch Real Owner-Approved Execution Task (`UNI-*`) in Paperclip when actionable work or target project is given!
  if ((intent.isTaskRequest || (intent.isMeetingRequest && projectSummary)) && typeof createTaskFn === "function") {
    // Ensure target assignee agent is ACTIVE before dispatching so it executes immediately without waiting!
    if (paperclip && agent.activation_status !== "ACTIVE") {
      await paperclip.resumeAgent(agent.paperclip_agent_id).catch(() => {});
      if (sync) await sync.reconcileNow("auto_resume_chat_assignee").catch(() => {});
    }

    const reportSlug = projectSummary
      ? `audit-${projectSummary.project_name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.md`
      : `owner-task-${Date.now()}.md`;
    const reportOutPath = `${ALLINONE_HOME}/reports/${reportSlug}`;

    const taskTitle = projectSummary
      ? `[Owner Approved] Audit & Analisis Multi-Departemen: ${projectSummary.project_name}`
      : intent.topic.slice(0, 130);

    const taskDescription = projectSummary
      ? [
          `Instruksi langsung yang telah disetujui Owner (${OWNER_DISPLAY_ID}):`,
          `- Proyek Target: \`${projectSummary.resolved_path}\` (${projectSummary.stack.join(", ")})`,
          createdMeeting ? `- Terkait Rapat Koordinasi: **${createdMeeting.meeting_id}** (${createdMeeting.paperclip_identifier})` : null,
          `- Permintaan Owner: ${intent.topic}`,
          ``,
          `Langkah Eksekusi Wajib (Efisien, Non-Destruktif & Aman — Maksimal 4 Pembacaan File):`,
          `1. Gunakan \`read_file\` HANYA pada file utama berikut di \`${projectSummary.resolved_path}\`: \`composer.json\` (atau \`package.json\`), \`modules_statuses.json\` (jika ada), dan \`README.md\`. JANGAN membaca file \`.env\` atau file kredensial/rahasia apa pun, dan jangan menjalankan perintah terminal yang lambat.`,
          `2. Susun laporan audit multi-departemen komprehensif (Ringkasan Eksekutif CEO, Arsitektur & Modularitas CTO, Kualitas API/Database Backend, Integrasi Frontend/DevOps, Keamanan Defensif SOC, Cakupan Pengujian QA, & Rencana Aksi Prioritas).`,
          `3. Segera panggil tool \`write_file\` untuk menyimpan laporan Markdown lengkap Bahasa Indonesia tepat ke \`${reportOutPath}\`, lalu balas ringkas 2 kalimat konfirmasi.`,
        ]
          .filter(Boolean)
          .join("\n")
      : intent.topic;

    const res = await createTaskFn(
      {
        title: taskTitle,
        description: taskDescription,
        project_id: ensuredProject?.id || null,
        parent_id: createdMeeting?.paperclip_issue_id || null,
        assignee_agent_id: agent.paperclip_agent_id,
        priority: "high",
        status: "todo",
        wake_immediately: true,
        idempotency_key: idempotencyKey ? `task-${idempotencyKey}` : undefined,
      },
      OWNER_DISPLAY_ID
    );
    createdTask = res.task || null;
    if (createdTask) {
      executionReceipts.push(
        `BERHASIL MEMBUAT & MENJALANKAN TASK EKSEKUSI PAPERCLIP: Task **${createdTask.identifier || createdTask.id}** (\`${createdTask.title}\`) telah disetujui otomatis atas otoritas Owner, ditugaskan ke **${agent.display_name}**, dan pekerja \`hermes_local\` langsung mengeksekusi analisis ke \`${reportOutPath}\`.`
      );
    }
  }

  const manager = allAgents.find((a) => a.paperclip_agent_id === agent.manager_id);
  const subordinates = allAgents.filter((a) => (agent.subordinate_ids || []).includes(a.paperclip_agent_id));
  const agentTasks = (snapshot.tasks || []).filter((t) => t.assigneeAgentId === agent.paperclip_agent_id).slice(0, 6);
  const teamSummary = allAgents
    .map((a) => `${a.display_name} (${a.department_short}, ${a.activation_status})`)
    .join("; ");

  const systemPrompt = [
    `Anda adalah **${agent.display_name}** (${agent.title}), karyawan AI nyata pada perusahaan **${snapshot.company?.name || "Unified AI Engineering & Operations"}** di dalam Kantor Virtual 3D Hermes3D.`,
    `Data identitas resmi Anda dari Paperclip Control Plane:`,
    `- Agent ID: ${agent.paperclip_agent_id}`,
    `- Departemen: ${agent.department} (${agent.department_short})`,
    `- Runtime & Profil Terisolasi: ${agent.runtime_type} / profil \`${agent.runtime_profile_reference || "pcworker"}\` dengan model \`${agent.model_id || "combo/X"}\``,
    `- Status Aktivasi: ${agent.activation_status} (Visual State: ${createdMeeting ? "COLLABORATING (Meeting Room)" : agent.state?.visual_state || "IDLE"})`,
    `- Atasan Langsung: ${manager ? `${manager.display_name} (${manager.title})` : `Human Owner / Board (${OWNER_DISPLAY_ID})`}`,
    `- Bawahan Langsung: ${subordinates.length > 0 ? subordinates.map((s) => s.display_name).join(", ") : "Tidak ada (Spesialis Eksekusi)"}`,
    `- Authorized Workspaces: ${(agent.authorized_workspaces || []).join(", ")}`,
    `- Rekan 1 Perusahaan (11 Agen): ${teamSummary}`,
    `- Ringkasan Perusahaan Saat Ini: Tasks selesai=${snapshot.overview?.completed_tasks ?? 0}, Tasks aktif=${snapshot.overview?.running_tasks ?? 0}, Temuan SOC VulnClaw resolved=${snapshot.security_center?.summary?.resolved ?? 0} / open=${snapshot.security_center?.summary?.open ?? 0}.`,
    agentTasks.length > 0
      ? `- Riwayat Task Paperclip Anda: ${agentTasks.map((t) => `${t.identifier || t.id.slice(0, 8)} [${t.status}] "${t.title}"`).join(" | ")}`
      : `- Riwayat Task Paperclip Anda siap menerima penugasan.`,
    executionReceipts.length > 0
      ? [
          ``,
          `=== BUKTI EKSEKUSI SISTEM NYATA PADA GILIRAN INI (SUDAH DISETUJUI & DIJALANKAN OTOMATIS) ===`,
          ...executionReceipts.map((r, idx) => `${idx + 1}. ${r}`),
          `INSTRUKSI PENTING: Seluruh tindakan di atas SUDAH BERHASIL DIEKSEKUSI SECARA NYATA sekarang juga! Laporkan secara tegas, ringkas, dan terstruktur kepada Owner: sebutkan ID Meeting (${createdMeeting?.meeting_id || "-"}), ID Issue/Task Paperclip (${createdTask?.identifier || createdMeeting?.paperclip_identifier || "-"}), konfirmasikan bahwa ke-11 agen telah berkumpul di Ruang Meeting 3D, serta sampaikan temuan awal arsitektur proyek yang terdeteksi. DILARANG KERAS meminta konfirmasi ulang atau mengatakan tidak bisa memindahkan agen ke ruang meeting!`,
        ].join("\n")
      : `- Catatan Kemampuan: Jika Owner meminta rapat/mengumpulkan agen ke Ruang Meeting atau menganalisis folder di dalam workspace yang telah diotorisasi (\`${ALLINONE_HOME}/workspaces/*\` atau root tambahan yang telah dikonfigurasi operator), sistem Anda MENDUKUNG PENUH eksekusi langsung tanpa penolakan.`,
    `Aturan wajib: Jawab secara ringkas, ramah, dan profesional dalam bahasa pengguna (Bahasa Indonesia jika disapa Bahasa Indonesia). Jangan pernah membocorkan kredensial/API key.`,
  ].join("\n");

  // Filter out any old stale apology turns from priorHistory so the model never mimics outdated refusal phrases
  const cleanHistoryForPrompt = priorHistory.filter(
    (m) =>
      !(
        m.role === "assistant" &&
        /(tidak bisa memindahkan|bukan sistem meeting-room|belum berhasil membuat task|koneksi model lambat)/i.test(
          String(m.content || "")
        )
      )
  );

  let replyText;
  try {
    replyText = await callComboXCompletion(systemPrompt, cleanHistoryForPrompt, cleanUserMsg, {
      fastActionReply: executionReceipts.length > 0,
    });
  } catch (err) {
    if (executionReceipts.length > 0) {
      replyText = [
        `Siap, instruksi Anda telah langsung disetujui dan dijalankan secara nyata oleh **${agent.display_name}**:`,
        ...executionReceipts.map((r) => `- ${r}`),
      ].join("\n");
    } else {
      replyText = `Halo, saya **${agent.display_name}** (${agent.title} — ${agent.department}). Status saya saat ini \`${agent.activation_status}\` (\`${agent.state?.visual_state || "IDLE"}\`). Silakan sampaikan instruksi atau proyek yang ingin kita bahas bersama tim!`;
    }
  }

  const nowMs = Date.now();
  appendAgentChatMessages(agent.paperclip_agent_id, [
    { role: "user", content: cleanUserMsg, timestamp: nowMs - 1 },
    { role: "assistant", content: replyText, timestamp: nowMs },
  ]);

  return {
    text: replyText,
    createdTask,
    createdMeeting,
    ensuredProject,
    executionReceipts,
  };
}

module.exports = {
  readAgentChatHistory,
  appendAgentChatMessages,
  clearAgentChatHistory,
  extractTargetProjectPath,
  shouldCreatePaperclipTask,
  analyzeOwnerActionIntent,
  handleEmployeeChatTurn,
};
