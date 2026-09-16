"use client";

import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useAuth } from "@/contexts/AuthContext";
import Image from "next/image";
import Link from "next/link";
import { BookOpen, Braces, CalendarClock, CircleHelp, LayoutDashboard, Layers3, Mail, MessageSquare, ShieldCheck, Users } from "lucide-react";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useTranslation } from "react-i18next";

export function AppSidebar({ ...props }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const isAdmin = user?.role === "admin" || user?.role === "platform_admin";
  const canViewCases = ["admin", "auditor", "compliance_approver", "compliance_reviewer", "platform_admin", "user"].includes(user?.role);
  const canReviewInquiries = ["admin", "compliance_approver", "compliance_reviewer", "platform_admin", "user"].includes(user?.role);
  const travelRuleItems = [
    { href: "/travel-rule/transfers", icon: Layers3, label: t("common:navigation.transfers") },
    ...(canReviewInquiries ? [{ href: "/travel-rule/inquiries", icon: CircleHelp, label: t("common:navigation.inquiries") }] : []),
    { href: "/travel-rule/messages", icon: MessageSquare, label: t("common:navigation.messages") },
    { href: "/travel-rule/tokens", icon: LayoutDashboard, label: t("common:navigation.tokens") },
    { href: "/travel-rule/events", icon: CalendarClock, label: t("common:navigation.events") },
  ];

  const item = ({ exact = false, href, icon: Icon, label }) => {
    const isActive = pathname === href || (!exact && href !== "/" && pathname.startsWith(`${href}/`));
    return (
      <SidebarMenuItem key={href}>
        <SidebarMenuButton
          asChild
          className="cursor-pointer data-[active=true]:bg-primary data-[active=true]:text-primary-foreground"
          isActive={isActive}
          tooltip={label}
        >
          <Link aria-current={isActive ? "page" : undefined} href={href}>
            <Icon />
            <span className="font-medium">{label}</span>
          </Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  };

  return (
    <Sidebar collapsible="offcanvas" {...props} className="p-0">
      <nav aria-label={t("common:navigation.primaryLabel")} className="flex h-full flex-col">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <Link href="/">
                <Image src={resolvedTheme === "light" ? "/logo_text.png" : "/logo_text_dark.png"} alt={t("common:app.logoAlt")} width={48} height={24} />
              </Link>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarSeparator className="mx-0" />

        <SidebarContent>
          <SidebarGroup>
            <SidebarMenu>{item({ href: "/", icon: LayoutDashboard, label: t("common:navigation.home") })}</SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t("common:navigation.travelRuleGroup")}</SidebarGroupLabel>
            <SidebarMenu>{travelRuleItems.map(item)}</SidebarMenu>
          </SidebarGroup>
          <SidebarGroup>
            <SidebarGroupLabel>{t("common:navigation.apiDocsGroup")}</SidebarGroupLabel>
            <SidebarMenu>
              {item({ exact: true, href: "/api-docs", icon: BookOpen, label: t("common:navigation.integrationGuide") })}
              {item({ href: "/api-docs/reference", icon: Braces, label: t("common:navigation.apiReference") })}
            </SidebarMenu>
          </SidebarGroup>
          {canViewCases ? (
            <SidebarGroup>
              <SidebarGroupLabel>{t("common:navigation.complianceGroup")}</SidebarGroupLabel>
              <SidebarMenu>{item({ href: "/compliance/cases", icon: ShieldCheck, label: t("common:navigation.complianceCases") })}</SidebarMenu>
            </SidebarGroup>
          ) : null}
          {isAdmin ? (
            <SidebarGroup>
              <SidebarGroupLabel>{t("common:navigation.mailGroup")}</SidebarGroupLabel>
              <SidebarMenu>{item({ href: "/mail", icon: Mail, label: t("common:navigation.emailDeliveries") })}</SidebarMenu>
            </SidebarGroup>
          ) : null}
          {isAdmin ? (
            <SidebarGroup>
              <SidebarGroupLabel>{t("common:navigation.managementGroup")}</SidebarGroupLabel>
              <SidebarMenu>{item({ href: "/users", icon: Users, label: t("common:navigation.users") })}</SidebarMenu>
            </SidebarGroup>
          ) : null}
        </SidebarContent>

        <SidebarSeparator className="mx-0" />

        <SidebarFooter>
          <NavUser />
        </SidebarFooter>
      </nav>
    </Sidebar>
  );
}
