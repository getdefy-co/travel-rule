"use client";

import { AppShell } from "@/components/app-shell";
import { EmailDeliveryDashboard } from "@/components/email-delivery-dashboard";

export default function Page() {
  return <AppShell requiredRoles={["admin", "platform_admin"]}><EmailDeliveryDashboard /></AppShell>;
}
