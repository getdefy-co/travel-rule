"use client";

import { AppShell } from "@/components/app-shell";
import { TravelRuleDashboard } from "@/components/travel-rule-dashboard";

export default function Page() {
  return (
    <AppShell requiredRoles={["auditor", "integration_operator", "platform_admin"]} unauthorizedRedirectTo="/travel-rule/inquiries">
      <TravelRuleDashboard />
    </AppShell>
  );
}
