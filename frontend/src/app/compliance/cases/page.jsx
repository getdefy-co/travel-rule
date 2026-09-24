"use client";

import { AppShell } from "@/components/app-shell";
import { ComplianceCaseDashboard } from "@/components/compliance-case-dashboard";

export default function Page() {
  return <AppShell requiredRoles={["auditor", "compliance_approver", "compliance_reviewer", "platform_admin"]}><ComplianceCaseDashboard /></AppShell>;
}
