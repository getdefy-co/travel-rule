"use client";

import { AppShell } from "@/components/app-shell";
import { ResourceDashboard } from "@/components/resource-dashboard";

export default function Page() {
  return <AppShell><ResourceDashboard resource="transfers" /></AppShell>;
}
