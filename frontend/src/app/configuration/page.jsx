"use client";

import { AppShell } from "@/components/app-shell";
import { ConfigurationPanel } from "@/components/configuration-panel";

export default function Page() {
  return <AppShell requiredRole="platform_admin"><ConfigurationPanel /></AppShell>;
}
