"use client";

import { useState } from "react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import { Bell, Ellipsis, LogOut, Settings, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { SettingsModal } from "./settings-modal";
import { UpdateModal } from "@/components/update-modal";

export function NavUser() {
  const { t } = useTranslation();
  const { isMobile } = useSidebar();
  const { user, logout } = useAuth();
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  const [updateModalOpen, setUpdateModalOpen] = useState(false);

  const handleSettingsClick = () => {
    setSettingsModalOpen(true);
  };

  const roleLabel = user?.role ? t(`enums:roles.${user.role}`) : "";
  const initial = user?.email?.charAt(0).toUpperCase() || "?";

  return (
    <>
      <SettingsModal open={settingsModalOpen} onOpenChange={setSettingsModalOpen} />
      {updateModalOpen ? <UpdateModal open onOpenChange={setUpdateModalOpen} /> : null}
      <SidebarMenu>
        <SidebarMenuItem>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground cursor-pointer relative">
                <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{initial}</span>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{user?.email}</span>
                  <span className="text-muted-foreground truncate text-xs">{roleLabel}</span>
                </div>
                <Ellipsis />
              </SidebarMenuButton>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg" side={isMobile ? "bottom" : "right"} align="end" sideOffset={4}>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                  <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground">{initial}</span>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{user?.email}</span>
                    <span className="text-muted-foreground truncate text-xs">{roleLabel}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                {user?.role === "admin" || user?.role === "platform_admin" ? (
                  <DropdownMenuItem asChild>
                    <Link href="/configuration">
                      <SlidersHorizontal />
                      {t("common:navigation.configuration")}
                    </Link>
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem onClick={handleSettingsClick} className="cursor-pointer">
                  <Settings />
                  {t("common:navigation.settings")}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setUpdateModalOpen(true)} className="cursor-pointer">
                  <Bell />
                  {t("common:navigation.update")}
                </DropdownMenuItem>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} className="cursor-pointer">
                <LogOut />
                {t("common:navigation.logout")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </SidebarMenuItem>
      </SidebarMenu>
    </>
  );
}
