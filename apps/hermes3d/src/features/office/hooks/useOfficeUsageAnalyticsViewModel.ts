"use client";

import { useCallback, useEffect, useState } from "react";
import type { AgentState } from "@/features/agents/state/store";
import type { StudioSettingsCoordinator } from "@/lib/studio/coordinator";
import {
  defaultStudioAnalyticsPreference,
  resolveAnalyticsPreference,
  type StudioAnalyticsBudgetSettings,
} from "@/lib/studio/settings";
import type { GatewayClient, GatewayStatus } from "@/lib/gateway/GatewayClient";
import { useUsageAnalytics } from "@/features/office/hooks/useUsageAnalytics";
import { getDefaultUsageAnalyticsRange } from "@/lib/office/usageAnalyticsPresentation";

export type OfficeUsageAnalyticsParams = {
  client: GatewayClient;
  status: GatewayStatus;
  agents: AgentState[];
  gatewayUrl: string;
  settingsCoordinator: StudioSettingsCoordinator;
};

export const useOfficeUsageAnalyticsViewModel = ({
  client,
  status,
  agents,
  gatewayUrl,
  settingsCoordinator,
}: OfficeUsageAnalyticsParams) => {
  const defaultRange = getDefaultUsageAnalyticsRange();
  const [startDate, setStartDate] = useState(defaultRange.startDate);
  const [endDate, setEndDate] = useState(defaultRange.endDate);
  const [budgets, setBudgets] = useState<StudioAnalyticsBudgetSettings>(
    defaultStudioAnalyticsPreference().budgets
  );
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const gatewayKey = gatewayUrl.trim();
    if (!gatewayKey) {
      setBudgets(defaultStudioAnalyticsPreference().budgets);
      setSettingsLoaded(true);
      return;
    }
    void (async () => {
      try {
        const settings = await settingsCoordinator.loadSettings({ maxAgeMs: 30_000 });
        if (cancelled) return;
        const analyticsPreference = settings
          ? resolveAnalyticsPreference(settings, gatewayKey)
          : defaultStudioAnalyticsPreference();
        let nextBudgets = analyticsPreference.budgets;
        const allUnset =
          nextBudgets.dailySpendLimitUsd === null &&
          nextBudgets.monthlySpendLimitUsd === null &&
          nextBudgets.perAgentSoftLimitUsd === null;
        if (allUnset && status === "connected") {
          try {
            const res = await client.call<{
              budgets?: Partial<StudioAnalyticsBudgetSettings>;
            }>("budgets.get", {});
            if (res?.budgets) {
              nextBudgets = {
                dailySpendLimitUsd:
                  typeof res.budgets.dailySpendLimitUsd === "number"
                    ? res.budgets.dailySpendLimitUsd
                    : nextBudgets.dailySpendLimitUsd,
                monthlySpendLimitUsd:
                  typeof res.budgets.monthlySpendLimitUsd === "number"
                    ? res.budgets.monthlySpendLimitUsd
                    : nextBudgets.monthlySpendLimitUsd,
                perAgentSoftLimitUsd:
                  typeof res.budgets.perAgentSoftLimitUsd === "number"
                    ? res.budgets.perAgentSoftLimitUsd
                    : nextBudgets.perAgentSoftLimitUsd,
                alertThresholdPct:
                  typeof res.budgets.alertThresholdPct === "number"
                    ? res.budgets.alertThresholdPct
                    : nextBudgets.alertThresholdPct,
              };
            }
          } catch {
            // keep local preference if gateway does not expose budgets.get
          }
        }
        if (!cancelled) {
          setBudgets(nextBudgets);
        }
      } finally {
        if (!cancelled) {
          setSettingsLoaded(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [client, gatewayUrl, settingsCoordinator, status]);

  const usage = useUsageAnalytics({
    client,
    status,
    agents,
    startDate,
    endDate,
    budgets,
  });

  const saveBudgets = useCallback(
    (nextBudgets: StudioAnalyticsBudgetSettings) => {
      const key = gatewayUrl.trim();
      if (!key) return;
      settingsCoordinator.schedulePatch(
        {
          analytics: {
            [key]: {
              budgets: nextBudgets,
            },
          },
        },
        150
      );
      if (status === "connected") {
        void client.call("budgets.set", { budgets: nextBudgets }).catch(() => {});
      }
    },
    [client, gatewayUrl, settingsCoordinator, status]
  );

  const updateBudget = useCallback(
    (key: keyof StudioAnalyticsBudgetSettings, value: number | null) => {
      setBudgets((current) => {
        const next = { ...current, [key]: value };
        saveBudgets(next);
        return next;
      });
    },
    [saveBudgets]
  );

  return {
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    budgets,
    settingsLoaded,
    usage,
    updateBudget,
  };
};
