"use client";

import { AppShell } from "@/components/app-shell";
import { ConfigurationPanel } from "@/components/configuration-panel";

export default function Page() {
  return <AppShell requiredRole="admin"><ConfigurationPanel /></AppShell>;
}
