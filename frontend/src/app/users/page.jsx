"use client";

import { AppShell } from "@/components/app-shell";
import { UserManagement } from "@/components/user-management";

export default function Page() {
  return (
    <AppShell requiredRole="admin">
      <UserManagement />
    </AppShell>
  );
}
