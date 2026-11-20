import { describe, expect, it } from "vitest";

import { materializeDefaults } from "@/features/retro-office/core/furnitureDefaults";
import {
  astar,
  buildNavGrid,
  getMeetingSeatLocations,
  MEETING_OVERFLOW_LOCATIONS,
} from "@/features/retro-office/core/navigation";
import { applyAgentCollisionBumps } from "@/features/retro-office/systems/NavigationSystem";
import type { RenderAgent } from "@/features/retro-office/core/types";

describe("3D Meeting Room 11-Agent Gathering & Navigation", () => {
  it("provides >= 14 reachable meeting seats outside the Art Room from the main office floor", () => {
    const items = materializeDefaults("office");
    const grid = buildNavGrid(items);
    const seats = [...getMeetingSeatLocations(items), ...MEETING_OVERFLOW_LOCATIONS];
    expect(seats.length).toBeGreaterThanOrEqual(14);

    // Every single one of the first 11+ corporate seats must be reachable via A*
    // from the central office floor (600, 400) without entering the Art Room (x >= 260, y <= 262).
    for (let i = 0; i < seats.length; i += 1) {
      const seat = seats[i];
      expect(seat.x, `seat[${i}].x`).toBeLessThan(255);
      const path = astar(600, 400, seat.x, seat.y, grid);
      expect(
        path.length,
        `seat[${i}] (${seat.x.toFixed(1)}, ${seat.y.toFixed(1)}) must have a valid A* route`,
      ).toBeGreaterThan(0);
      expect(path[path.length - 1]).toEqual({ x: seat.x, y: seat.y });
    }
  });

  it("exempts meeting_room participants from collision bump escape-reroutes", () => {
    const agents: RenderAgent[] = [
      {
        id: "ceo",
        name: "CEO Agent",
        status: "working",
        color: "#22d3ee",
        x: 200,
        y: 250,
        targetX: 145,
        targetY: 242,
        path: [{ x: 145, y: 242 }],
        frame: 1,
        facing: 0,
        state: "walking",
        interactionTarget: "meeting_room",
      } as RenderAgent,
      {
        id: "cto",
        name: "CTO Agent",
        status: "working",
        color: "#38bdf8",
        x: 202,
        y: 251,
        targetX: 192,
        targetY: 236,
        path: [{ x: 192, y: 236 }],
        frame: 1,
        facing: 0,
        state: "walking",
        interactionTarget: "meeting_room",
      } as RenderAgent,
    ];

    const after = applyAgentCollisionBumps({ agents, now: 10_000 });
    expect(after[0].targetX).toBe(145);
    expect(after[0].targetY).toBe(242);
    expect(after[0].path).toEqual([{ x: 145, y: 242 }]);
    expect(after[1].targetX).toBe(192);
    expect(after[1].targetY).toBe(236);
    expect(after[1].path).toEqual([{ x: 192, y: 236 }]);
  });
});
