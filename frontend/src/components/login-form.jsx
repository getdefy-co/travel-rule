"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useTheme } from "next-themes";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { forgotPassword, resetPassword } from "@/lib/api";

export function LoginForm({ className, isResetMode = false, resetToken = null, ...props }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const { login, isLoading: isAuthLoading, clearError } = useAuth();
  const [showForgotModal, setShowForgotModal] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [isForgotLoading, setIsForgotLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isResetLoading, setIsResetLoading] = useState(false);
  const [loginInvalid, setLoginInvalid] = useState({ email: false, password: false });
  const [forgotInvalid, setForgotInvalid] = useState(false);
  const [resetInvalid, setResetInvalid] = useState({ newPassword: false, confirmPassword: false });
  const emailRef = useRef(null);
  const passwordRef = useRef(null);
  const forgotEmailRef = useRef(null);
  const newPasswordRef = useRef(null);
  const confirmPasswordRef = useRef(null);
  const mountedRef = useRef(false);
  const loginPendingRef = useRef(false);
  const forgotPendingRef = useRef(false);
  const resetPendingRef = useRef(false);
  const forgotRequestRef = useRef(0);
  const resetRequestRef = useRef(0);
  const router = useRouter();
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      forgotPendingRef.current = false;
      resetPendingRef.current = false;
      forgotRequestRef.current += 1;
      resetRequestRef.current += 1;
    };
  }, []);

  const changeForgotOpen = (open) => {
    setShowForgotModal(open);
    if (!open) {
      forgotPendingRef.current = false;
      forgotRequestRef.current += 1;
      setIsForgotLoading(false);
      setForgotInvalid(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    clearError();
    if (loginPendingRef.current) {
      return;
    }

    if (!email || !password) {
      const invalidCount = Number(!email) + Number(!password);
      setLoginInvalid({ email: !email, password: !password });
      if (invalidCount > 1) {
        toast.error(t("common:toasts.validation", {
          count: invalidCount,
          field: t("auth:login.email"),
          message: t("auth:login.missingFieldsDesc"),
        }));
      } else {
        toast.error(t("auth:login.missingFields"), {
          description: t("auth:login.missingFieldsDesc"),
        });
      }
      (!email ? emailRef : passwordRef).current?.focus();
      return;
    }

    if (!email.includes("@")) {
      setLoginInvalid({ email: true, password: false });
      toast.error(t("auth:login.invalidEmail"), {
        description: t("auth:login.invalidEmailDesc"),
      });
      emailRef.current?.focus();
      return;
    }

    setLoginInvalid({ email: false, password: false });
    loginPendingRef.current = true;
    const result = await login({ email, password });
    loginPendingRef.current = false;

    if (!mountedRef.current) {
      return;
    }

    if (result.success) {
      router.push("/");
    } else {
      toast.error(result.error || t("errors:api.loginFailed"), { id: "auth-login-error" });
    }
  };

  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    if (forgotPendingRef.current) {
      return;
    }

    if (!forgotEmail) {
      setForgotInvalid(true);
      toast.error(t("auth:forgot.missingEmail"), {
        description: t("auth:forgot.missingEmailDesc"),
      });
      forgotEmailRef.current?.focus();
      return;
    }

    if (!forgotEmail.includes("@")) {
      setForgotInvalid(true);
      toast.error(t("auth:forgot.invalidEmail"), {
        description: t("auth:forgot.invalidEmailDesc"),
      });
      forgotEmailRef.current?.focus();
      return;
    }

    setForgotInvalid(false);
    forgotPendingRef.current = true;
    setIsForgotLoading(true);
    const requestId = forgotRequestRef.current + 1;
    forgotRequestRef.current = requestId;
    try {
      await forgotPassword(forgotEmail);
      if (!mountedRef.current || forgotRequestRef.current !== requestId) {
        return;
      }
      toast.success(t("auth:forgot.checkInbox"), {
        description: t("auth:forgot.checkInboxDesc"),
      });
      changeForgotOpen(false);
      setForgotEmail("");
    } catch (error) {
      if (!mountedRef.current || forgotRequestRef.current !== requestId) {
        return;
      }
      toast.error(t("auth:forgot.error"), {
        description: error.message,
      });
    } finally {
      if (mountedRef.current && forgotRequestRef.current === requestId) {
        forgotPendingRef.current = false;
        setIsForgotLoading(false);
      }
    }
  };

  const handleResetSubmit = async (e) => {
    e.preventDefault();
    if (resetPendingRef.current) {
      return;
    }

    if (!newPassword || !confirmPassword) {
      const invalidCount = Number(!newPassword) + Number(!confirmPassword);
      setResetInvalid({ newPassword: !newPassword, confirmPassword: !confirmPassword });
      if (invalidCount > 1) {
        toast.error(t("common:toasts.validation", {
          count: invalidCount,
          field: t("auth:reset.newPassword"),
          message: t("auth:reset.missingFieldsDesc"),
        }));
      } else {
        toast.error(t("auth:reset.missingFields"), {
          description: t("auth:reset.missingFieldsDesc"),
        });
      }
      (!newPassword ? newPasswordRef : confirmPasswordRef).current?.focus();
      return;
    }

    if (newPassword !== confirmPassword) {
      setResetInvalid({ newPassword: false, confirmPassword: true });
      toast.error(t("auth:reset.passwordsDoNotMatch"));
      confirmPasswordRef.current?.focus();
      return;
    }

    if (newPassword.length < 8) {
      setResetInvalid({ newPassword: true, confirmPassword: false });
      toast.error(t("auth:reset.passwordTooShort"));
      newPasswordRef.current?.focus();
      return;
    }

    setResetInvalid({ newPassword: false, confirmPassword: false });
    resetPendingRef.current = true;
    setIsResetLoading(true);
    const requestId = resetRequestRef.current + 1;
    resetRequestRef.current = requestId;
    try {
      await resetPassword(resetToken, newPassword);
      if (!mountedRef.current || resetRequestRef.current !== requestId) {
        return;
      }

      toast.success(t("auth:reset.success"), {
        description: t("auth:reset.successDesc"),
      });

      router.push("/login");
    } catch (error) {
      if (!mountedRef.current || resetRequestRef.current !== requestId) {
        return;
      }
      toast.error(t("auth:reset.error"), {
        description: error.message,
      });
    } finally {
      if (mountedRef.current && resetRequestRef.current === requestId) {
        resetPendingRef.current = false;
        setIsResetLoading(false);
      }
    }
  };

  if (isResetMode) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle>{t("auth:reset.title")}</CardTitle>
            <CardDescription>{t("auth:reset.description")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleResetSubmit}>
              <div className="flex flex-col gap-6">
                <div className="grid gap-3">
                  <Label htmlFor="new-password">{t("auth:reset.newPassword")}</Label>
                  <Input aria-invalid={resetInvalid.newPassword} id="new-password" ref={newPasswordRef} type="password" autoComplete="new-password" placeholder={t("auth:reset.newPasswordPlaceholder")} value={newPassword} onChange={(e) => { setNewPassword(e.target.value); setResetInvalid((current) => ({ ...current, newPassword: false })); }} disabled={isResetLoading} />
                </div>
                <div className="grid gap-3">
                  <Label htmlFor="confirm-password">{t("auth:reset.confirmPassword")}</Label>
                  <Input aria-invalid={resetInvalid.confirmPassword} id="confirm-password" ref={confirmPasswordRef} type="password" autoComplete="new-password" placeholder={t("auth:reset.confirmPasswordPlaceholder")} value={confirmPassword} onChange={(e) => { setConfirmPassword(e.target.value); setResetInvalid((current) => ({ ...current, confirmPassword: false })); }} disabled={isResetLoading} />
                </div>
                <Button type="submit" className="w-full" disabled={isResetLoading}>
                  {isResetLoading ? t("auth:reset.submitting") : t("auth:reset.submit")}
                </Button>
              </div>
            </form>
            <Image src={resolvedTheme === "light" ? "/logo_text.png" : "/logo_text_dark.png"} alt={t("common:app.logoAlt")} width={48} height={24} className="mx-auto mt-4" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle>{t("auth:login.title")}</CardTitle>
          <CardDescription>{t("auth:login.description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleLoginSubmit} noValidate>
            <div className="flex flex-col gap-6">
              <div className="grid gap-3">
                <Label htmlFor="email">{t("auth:login.email")}</Label>
                <Input aria-invalid={loginInvalid.email} id="email" ref={emailRef} type="email" autoComplete="email" placeholder={t("auth:login.emailPlaceholder")} value={email} onChange={(e) => { setEmail(e.target.value); setLoginInvalid((current) => ({ ...current, email: false })); }} disabled={isAuthLoading} />
              </div>
              <div className="grid gap-3">
                <Label htmlFor="password">{t("auth:login.password")}</Label>
                <Input aria-invalid={loginInvalid.password} id="password" ref={passwordRef} type="password" autoComplete="current-password" value={password} placeholder={t("auth:login.passwordPlaceholder")} onChange={(e) => { setPassword(e.target.value); setLoginInvalid((current) => ({ ...current, password: false })); }} disabled={isAuthLoading} />
                <div className="flex justify-end">
                  <button type="button" onClick={() => setShowForgotModal(true)} className="text-sm text-primary underline-offset-4 transition-all duration-400">
                    {t("auth:login.forgotPassword")}
                  </button>
                </div>
              </div>
              <div className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={isAuthLoading}>
                  {isAuthLoading ? <span role="status" aria-label={t("auth:login.submitting")}>{t("auth:login.submitting")}</span> : t("auth:login.submit")}
                </Button>
              </div>
            </div>
          </form>
          <Image src={resolvedTheme === "light" ? "/logo_text.png" : "/logo_text_dark.png"} alt={t("common:app.logoAlt")} width={48} height={24} className="mx-auto mt-4" />
        </CardContent>
      </Card>

      <Dialog open={showForgotModal} onOpenChange={changeForgotOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("auth:forgot.title")}</DialogTitle>
            <DialogDescription>{t("auth:forgot.description")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleForgotSubmit} className="space-y-4" noValidate>
            <div className="grid gap-2">
              <Label htmlFor="forgot-email">{t("auth:forgot.email")}</Label>
              <Input aria-invalid={forgotInvalid} id="forgot-email" ref={forgotEmailRef} type="email" autoComplete="email" placeholder={t("auth:forgot.emailPlaceholder")} value={forgotEmail} onChange={(e) => { setForgotEmail(e.target.value); setForgotInvalid(false); }} disabled={isForgotLoading} />
            </div>
            <div className="flex justify-end gap-4">
              <Button type="button" variant="outline" onClick={() => changeForgotOpen(false)} disabled={isForgotLoading}>
                {t("auth:forgot.cancel")}
              </Button>
              <Button type="submit" disabled={isForgotLoading}>
                {isForgotLoading ? t("auth:forgot.sending") : t("auth:forgot.sendLink")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
