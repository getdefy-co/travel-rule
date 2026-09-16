"use client";

import { AppShell } from "@/components/app-shell";
import { InquiryDashboard } from "@/components/inquiry-dashboard";

export default function Page() {
  return (
    <AppShell requiredRoles={["admin", "compliance_approver", "compliance_reviewer", "platform_admin", "user"]}>
      <InquiryDashboard />
    </AppShell>
  );
}
