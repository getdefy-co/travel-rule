"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { TbLock, TbEye, TbEyeOff } from "react-icons/tb";
import { useTranslation } from "react-i18next";
import { changePassword } from "@/lib/api";

export const ChangePasswordModal = ({ open, onOpenChange }) => {
  const { t } = useTranslation();
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showOldPassword, setShowOldPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [invalid, setInvalid] = useState({ current: false, next: false, confirmation: false });
  const currentPasswordRef = useRef(null);
  const newPasswordRef = useRef(null);
  const confirmPasswordRef = useRef(null);
  const mountedRef = useRef(false);
  const submitLock = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const resetFields = () => {
    setOldPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setShowOldPassword(false);
    setShowNewPassword(false);
    setShowConfirmPassword(false);
    setInvalid({ current: false, next: false, confirmation: false });
  };

  const handleClose = (isOpen) => {
    if (!isOpen && submitLock.current) {
      return;
    }

    if (!isOpen) {
      resetFields();
    }

    onOpenChange(isOpen);
  };

  const handleChangePassword = async (e) => {
    e?.preventDefault();
    if (submitLock.current) {
      return;
    }

    if (!oldPassword || !newPassword || !confirmNewPassword) {
      const missing = [
        { invalid: !oldPassword, key: "current", label: t("auth:changePassword.current"), ref: currentPasswordRef },
        { invalid: !newPassword, key: "next", label: t("auth:changePassword.new"), ref: newPasswordRef },
        { invalid: !confirmNewPassword, key: "confirmation", label: t("auth:changePassword.confirm"), ref: confirmPasswordRef },
      ].filter((field) => field.invalid);
      setInvalid({
        current: !oldPassword,
        next: !newPassword,
        confirmation: !confirmNewPassword,
      });
      if (missing.length > 1) {
        toast.error(t("common:toasts.validation", {
          count: missing.length,
          field: missing[0].label,
          message: t("auth:changePassword.missingDesc"),
        }));
      } else {
        toast.error(t("auth:changePassword.missing"), {
          description: t("auth:changePassword.missingDesc"),
        });
      }
      missing[0].ref.current?.focus();
      return;
    }

    if (newPassword.length < 8) {
      setInvalid({ current: false, next: true, confirmation: false });
      toast.error(t("auth:changePassword.tooShort"), {
        description: t("auth:changePassword.tooShortDesc"),
      });
      newPasswordRef.current?.focus();
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setInvalid({ current: false, next: false, confirmation: true });
      toast.error(t("auth:changePassword.mismatch"), {
        description: t("auth:changePassword.mismatchDesc"),
      });
      confirmPasswordRef.current?.focus();
      return;
    }

    if (oldPassword === newPassword) {
      setInvalid({ current: false, next: true, confirmation: false });
      toast.error(t("auth:changePassword.samePassword"), {
        description: t("auth:changePassword.samePasswordDesc"),
      });
      newPasswordRef.current?.focus();
      return;
    }

    setInvalid({ current: false, next: false, confirmation: false });
    submitLock.current = true;
    setIsLoading(true);

    try {
      await changePassword(oldPassword, newPassword);
      if (mountedRef.current) {
        submitLock.current = false;
        toast.success(t("auth:changePassword.success"));
        handleClose(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(t("auth:changePassword.error"), {
          description: error.message,
        });
      }
    } finally {
      submitLock.current = false;
      if (mountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <TbLock className="size-5" />
            <DialogTitle>{t("auth:changePassword.title")}</DialogTitle>
          </div>
          <DialogDescription>{t("auth:changePassword.description")}</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleChangePassword} className="space-y-4 py-2" noValidate>
          <div className="space-y-2">
            <Label htmlFor="old-password">{t("auth:changePassword.current")}</Label>
            <div className="relative">
              <Input
                aria-invalid={invalid.current}
                id="old-password"
                value={oldPassword}
                onChange={(e) => { setOldPassword(e.target.value); setInvalid((current) => ({ ...current, current: false })); }}
                className="pr-10"
                placeholder={t("auth:changePassword.currentPlaceholder")}
                type={showOldPassword ? "text" : "password"}
                autoComplete="current-password"
                disabled={isLoading}
                required
                ref={currentPasswordRef}
              />
              <button type="button" aria-label={t(showOldPassword ? "auth:changePassword.visibility.hide" : "auth:changePassword.visibility.show", { field: t("auth:changePassword.current") })} aria-pressed={showOldPassword} onClick={() => setShowOldPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-400 hover:text-foreground">
                {showOldPassword ? <TbEyeOff className="size-4" /> : <TbEye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="new-password">{t("auth:changePassword.new")}</Label>
            <div className="relative">
              <Input
                aria-invalid={invalid.next}
                id="new-password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setInvalid((current) => ({ ...current, next: false })); }}
                className="pr-10"
                placeholder={t("auth:changePassword.newPlaceholder")}
                type={showNewPassword ? "text" : "password"}
                autoComplete="new-password"
                disabled={isLoading}
                required
                ref={newPasswordRef}
              />
              <button type="button" aria-label={t(showNewPassword ? "auth:changePassword.visibility.hide" : "auth:changePassword.visibility.show", { field: t("auth:changePassword.new") })} aria-pressed={showNewPassword} onClick={() => setShowNewPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-400 hover:text-foreground">
                {showNewPassword ? <TbEyeOff className="size-4" /> : <TbEye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="confirm-password">{t("auth:changePassword.confirm")}</Label>
            <div className="relative">
              <Input
                aria-invalid={invalid.confirmation}
                id="confirm-password"
                value={confirmNewPassword}
                onChange={(e) => { setConfirmNewPassword(e.target.value); setInvalid((current) => ({ ...current, confirmation: false })); }}
                className="pr-10"
                placeholder={t("auth:changePassword.confirmPlaceholder")}
                type={showConfirmPassword ? "text" : "password"}
                autoComplete="new-password"
                disabled={isLoading}
                required
                ref={confirmPasswordRef}
              />
              <button type="button" aria-label={t(showConfirmPassword ? "auth:changePassword.visibility.hide" : "auth:changePassword.visibility.show", { field: t("auth:changePassword.confirm") })} aria-pressed={showConfirmPassword} onClick={() => setShowConfirmPassword((visible) => !visible)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors duration-400 hover:text-foreground">
                {showConfirmPassword ? <TbEyeOff className="size-4" /> : <TbEye className="size-4" />}
              </button>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button type="button" variant="outline" onClick={() => handleClose(false)} disabled={isLoading}>
              {t("auth:changePassword.cancel")}
            </Button>
            <Button type="submit" disabled={isLoading}>
              {isLoading ? t("auth:changePassword.submitting") : t("auth:changePassword.submit")}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
