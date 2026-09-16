"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import dayjs from "dayjs";
import { TbSettings, TbLogout, TbMail, TbBadge, TbCalendar, TbLock } from "react-icons/tb";
import { ChangePasswordModal } from "./change-password-modal";

export const SettingsModal = ({ open, onOpenChange }) => {
  const { t, i18n } = useTranslation();
  const { user, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const [isChangePasswordOpen, setIsChangePasswordOpen] = useState(false);

  const handleLogout = () => {
    onOpenChange(false);
    logout();
  };

  const handleThemeChange = (newTheme) => {
    setTheme(newTheme);
    const themeLabel = t(`modals:settings.theme.${newTheme}`);
    toast.success(t("modals:settings.theme.toast", { theme: themeLabel.toLowerCase() }));
  };

  const handleLanguageChange = async (newLanguage) => {
    await i18n.changeLanguage(newLanguage);
    toast.success(t("modals:settings.language.toast", { language: t(`common:languages.${newLanguage}`) }));
  };

  const formatDate = (dateString) => {
    if (!dateString) {
      return t("common:state.na");
    }

    return dayjs(dateString).format("MMMM D, YYYY");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-semibold">
            <TbSettings className="size-5" />
            {t("modals:settings.title")}
          </DialogTitle>
          <DialogDescription>{t("modals:settings.description")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-4 flex items-center justify-between">
            <div>
              <h3 className="text-md font-medium">{t("modals:settings.theme.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("modals:settings.theme.description")}</p>
            </div>

            <Select value={theme} onValueChange={handleThemeChange}>
              <SelectTrigger>
                <SelectValue placeholder={t("modals:settings.theme.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="light">{t("modals:settings.theme.light")}</SelectItem>
                <SelectItem value="dark">{t("modals:settings.theme.dark")}</SelectItem>
                <SelectItem value="system">{t("modals:settings.theme.system")}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-4 flex items-center justify-between">
            <div>
              <h3 className="text-md font-medium">{t("modals:settings.language.title")}</h3>
              <p className="text-sm text-muted-foreground">{t("modals:settings.language.description")}</p>
            </div>

            <Select value={i18n.language} onValueChange={handleLanguageChange}>
              <SelectTrigger>
                <SelectValue placeholder={t("modals:settings.language.placeholder")} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="en">{t("common:languages.en")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="rounded-lg border p-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TbMail className="size-4 text-muted-foreground" />
                <span className="text-sm">{t("modals:settings.info.email")}</span>
              </div>
              <span className="text-sm font-medium">{user?.email || t("common:state.na")}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TbBadge className="size-4 text-muted-foreground" />
                <span className="text-sm">{t("modals:settings.info.role")}</span>
              </div>
              <span className="text-sm font-medium">{user?.role ? t(`enums:roles.${user.role}`) : t("common:state.na")}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <TbCalendar className="size-4 text-muted-foreground" />
                <span className="text-sm">{t("modals:settings.info.memberSince")}</span>
              </div>
              <span className="text-sm font-medium">{formatDate(user?.created_at)}</span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-primary/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">{t("modals:settings.password.title")}</h4>
              <p className="text-sm text-muted-foreground">{t("modals:settings.password.description")}</p>
            </div>
            <Button variant="outline" onClick={() => setIsChangePasswordOpen(true)} className="flex items-center gap-2 border-primary/40 hover:bg-primary/5 hover:text-primary hover:border-primary">
              <TbLock className="size-4" />
              {t("modals:settings.password.button")}
            </Button>
          </div>
        </div>

        <ChangePasswordModal open={isChangePasswordOpen} onOpenChange={setIsChangePasswordOpen} />

        <div className="rounded-lg border border-destructive/20 p-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="font-medium">{t("modals:settings.signOut.title")}</h4>
              <p className="text-sm text-muted-foreground">{t("modals:settings.signOut.description")}</p>
            </div>
            <Button variant="destructive" onClick={handleLogout} className="flex items-center gap-2">
              <TbLogout className="size-4" />
              {t("modals:settings.signOut.button")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
