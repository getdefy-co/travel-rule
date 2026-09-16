"use client";

import { AppShell } from "@/components/app-shell";
import { ComplianceCaseDashboard } from "@/components/compliance-case-dashboard";

export default function Page() {
  return <AppShell requiredRoles={["admin", "auditor", "compliance_approver", "compliance_reviewer", "platform_admin", "user"]}><ComplianceCaseDashboard /></AppShell>;
}
