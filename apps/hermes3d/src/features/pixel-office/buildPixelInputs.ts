// Maps live Hermes office state (roster + animation holds) into the pixel
// simulation's input shape. Pure so it stays unit-testable.

import type { OfficeAgent } from "@/features/retro-office/core/types";
import type { OfficeAnimationState } from "@/lib/office/eventTriggers";
import type { StandupMeeting } from "@/lib/office/standup/types";
import type { PixelAgentInput } from "@/features/pixel-office/types";

export const buildPixelAgentInputs = (params: {
  agents: OfficeAgent[];
  animationState: OfficeAnimationState | null;
  standupMeeting?: StandupMeeting | null;
  nowMs: number;
}): PixelAgentInput[] => {
  const { agents, animationState, standupMeeting = null, nowMs } = params;
  const activeMeeting =
    standupMeeting &&
    (standupMeeting.phase === "gathering" || standupMeeting.phase === "in_progress")
      ? standupMeeting
      : null;

  return agents.map((agent) => {
    const id = agent.id;
    const inActiveMeeting = activeMeeting
      ? activeMeeting.participantOrder.length === 0 ||
        activeMeeting.participantOrder.includes(id)
      : false;
    const hold: PixelAgentInput["hold"] =
      inActiveMeeting || !animationState
        ? null
        : animationState.phoneBoothHoldByAgentId[id]
          ? "phone_booth"
          : animationState.smsBoothHoldByAgentId[id]
            ? "sms_booth"
            : animationState.gymHoldByAgentId[id] ||
                animationState.skillGymHoldByAgentId[id] ||
                (animationState.manualGymUntilByAgentId[id] ?? 0) > nowMs
              ? "gym"
              : animationState.qaHoldByAgentId[id]
                ? "qa_lab"
                : animationState.githubHoldByAgentId[id]
                  ? "github_desk"
                  : animationState.jukeboxHoldByAgentId[id]
                    ? "jukebox"
                    : null;
    // Mirror the 3D scene's desk latch: stay in "working" through desk
    // directives, active meetings, and for a short stretch after the last run
    // activity, so agents visibly reach their desk or meeting seat.
    const workingLatched =
      inActiveMeeting ||
      agent.status === "working" ||
      Boolean(animationState?.deskHoldByAgentId[id]) ||
      (animationState?.workingUntilByAgentId[id] ?? 0) > nowMs;
    const status =
      agent.status === "error" ? "error" : workingLatched ? "working" : agent.status;
    return {
      id,
      name: agent.name,
      status,
      color: agent.color,
      streaming: Boolean(animationState?.streamingByAgentId[id]),
      thinking: Boolean(animationState?.thinkingByAgentId[id]),
      awaitingApproval: Boolean(animationState?.awaitingApprovalByAgentId[id]),
      dancing: !inActiveMeeting && (animationState?.danceUntilByAgentId[id] ?? 0) > nowMs,
      hold,
      standup: Boolean(animationState?.pendingStandupRequest) || inActiveMeeting,
    };
  });
};

export const isCleaningActive = (
  animationState: OfficeAnimationState | null,
): boolean => Boolean(animationState && animationState.cleaningCues.length > 0);
