"use client";

import { AppShell } from "@/components/app-shell";
import { InquiryDashboard } from "@/components/inquiry-dashboard";

export default function Page() {
  return (
    <AppShell requiredRoles={["compliance_approver", "compliance_reviewer", "platform_admin"]}>
      <InquiryDashboard />
    </AppShell>
  );
}
