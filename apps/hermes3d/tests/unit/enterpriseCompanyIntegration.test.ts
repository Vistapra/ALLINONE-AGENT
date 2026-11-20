// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { GET as getPathSuggestions } from "@/app/api/path-suggestions/route";
import { POST as postAgentState } from "@/app/api/gateway/agent-state/route";
import { POST as postSkillRemove } from "@/app/api/gateway/skills/remove/route";
import { POST as postCustomRuntime } from "@/app/api/runtime/custom/route";
import { POST as postCompanyProxy } from "@/app/api/company/[...slug]/route";

describe("Unified Company Governance & Security Hardening", () => {
  const prevGov = process.env.UNIFIED_COMPANY_GOVERNANCE;

  afterEach(() => {
    if (prevGov === undefined) delete process.env.UNIFIED_COMPANY_GOVERNANCE;
    else process.env.UNIFIED_COMPANY_GOVERNANCE = prevGov;
  });

  it("locks /api/gateway/agent-state with 403 when UNIFIED_COMPANY_GOVERNANCE=1", async () => {
    process.env.UNIFIED_COMPANY_GOVERNANCE = "1";
    const res = await postAgentState(
      new Request("http://127.0.0.1:3200/api/gateway/agent-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: "ceo" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("locks /api/gateway/skills/remove with 403 when UNIFIED_COMPANY_GOVERNANCE=1", async () => {
    process.env.UNIFIED_COMPANY_GOVERNANCE = "1";
    const res = await postSkillRemove(
      new Request("http://127.0.0.1:3200/api/gateway/skills/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ skillKey: "github" }),
      })
    );
    expect(res.status).toBe(403);
  });

  it("restricts /api/path-suggestions to workspaces root and blocks ../ traversal", async () => {
    process.env.UNIFIED_COMPANY_GOVERNANCE = "1";
    const resOk = await getPathSuggestions(new Request("http://127.0.0.1:3200/api/path-suggestions"));
    expect(resOk.status).toBe(200);
    const bodyOk = (await resOk.json()) as { directory: string };
    expect(bodyOk.directory.toLowerCase()).toContain("workspaces");

    const resTraversal = await getPathSuggestions(
      new Request("http://127.0.0.1:3200/api/path-suggestions?q=~/../config/secrets")
    );
    expect(resTraversal.status).toBe(400);
  });

  it("prevents loopback SSRF to Paperclip/PostgreSQL ports on /api/runtime/custom", async () => {
    process.env.UNIFIED_COMPANY_GOVERNANCE = "1";
    process.env.CUSTOM_RUNTIME_ALLOWLIST = "127.0.0.1,localhost";
    const res = await postCustomRuntime(
      new Request("http://127.0.0.1:3200/api/runtime/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runtimeUrl: "http://127.0.0.1:3100",
          pathname: "/api/companies",
          method: "GET",
        }),
      })
    );
    expect(res.status).toBe(400);
  });

  it("enforces CSRF same-origin validation on /api/company mutations", async () => {
    const res = await postCompanyProxy(
      new Request("http://127.0.0.1:3200/api/company/tasks", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://evil.attacker.example",
          Host: "127.0.0.1:3200",
        },
        body: JSON.stringify({ title: "CSRF attempt" }),
      }),
      { params: Promise.resolve({ slug: ["tasks"] }) }
    );
    expect(res.status).toBe(403);
  });
});
