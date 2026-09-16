"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Pencil, UserPlus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_LOCKED_DESCRIPTION_ID = "managed-user-email-locked";
const USER_ROLES = ["user", "compliance_reviewer", "compliance_approver", "integration_operator", "auditor", "platform_admin", "admin"];

function UserFormDialogContent({ mode, onOpenChange, onSubmit, onSuccess, pendingRef, user }) {
  const { t } = useTranslation();
  const editing = mode === "edit";
  const [email, setEmail] = useState(editing ? user?.email || "" : "");
  const [role, setRole] = useState(
    editing && USER_ROLES.includes(user?.role) ? user.role : "user",
  );
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submitLock = useRef(false);
  const emailRef = useRef(null);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const submit = async (event) => {
    event.preventDefault();
    if (submitLock.current) {
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      const message = t("modals:userForm.emailRequired");
      setValidationError(message);
      toast.error(message);
      emailRef.current?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(normalizedEmail)) {
      const message = t("modals:userForm.emailInvalid");
      setValidationError(message);
      toast.error(message);
      emailRef.current?.focus();
      return;
    }
    setValidationError("");
    submitLock.current = true;
    pendingRef.current = true;
    setSubmitting(true);
    try {
      await onSubmit({ email: normalizedEmail, role });
      if (mountedRef.current) {
        pendingRef.current = false;
        onSuccess();
        onOpenChange(false);
      }
    } catch (error) {
      if (mountedRef.current) {
        toast.error(error.message || t("errors:api.userMutationFailed"));
      }
    } finally {
      submitLock.current = false;
      pendingRef.current = false;
      if (mountedRef.current) {
        setSubmitting(false);
      }
    }
  };

  const title = t(editing ? "modals:userForm.editTitle" : "modals:userForm.createTitle");
  const emailDescription = editing ? EMAIL_LOCKED_DESCRIPTION_ID : undefined;

  return (
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className="border-b px-5 py-5">
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              {editing ? <Pencil className="size-4" /> : <UserPlus className="size-4" />}
            </div>
            <div className="min-w-0">
              <DialogTitle>{title}</DialogTitle>
              <DialogDescription className="mt-1">
                {t(editing ? "modals:userForm.editDescription" : "modals:userForm.createDescription")}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form aria-label={t("modals:userForm.formLabel")} noValidate onSubmit={submit}>
          <div className="space-y-5 px-5 py-5">
            <div className="space-y-2">
              <Label htmlFor="managed-user-email">{t("modals:userForm.email")}</Label>
              <Input
                aria-describedby={emailDescription}
                aria-invalid={Boolean(validationError)}
                autoComplete="email"
                disabled={editing || submitting}
                id="managed-user-email"
                ref={emailRef}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setValidationError("");
                }}
                placeholder={t("modals:userForm.emailPlaceholder")}
                type="email"
                value={email}
              />
              {editing ? (
                <p className="text-xs text-muted-foreground" id={EMAIL_LOCKED_DESCRIPTION_ID}>
                  {t("modals:userForm.emailLocked")}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="managed-user-role">{t("modals:userForm.role")}</Label>
              <Select disabled={submitting} onValueChange={setRole} value={role}>
                <SelectTrigger aria-label={t("modals:userForm.role")} className="w-full" id="managed-user-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {USER_ROLES.map(item => (
                    <SelectItem key={item} value={item}>{t(`enums:roles.${item}`)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

          </div>

          <DialogFooter className="border-t bg-muted/20 px-5 py-4">
            <Button disabled={submitting} onClick={() => onOpenChange(false)} type="button" variant="outline">
              {t("modals:userForm.cancel")}
            </Button>
            <Button
              aria-label={submitting
                ? t(editing ? "modals:userForm.saving" : "modals:userForm.creating")
                : t(editing ? "modals:userForm.save" : "modals:userForm.create")}
              disabled={submitting}
              type="submit"
            >
              {submitting ? <Loader2 className="animate-spin" /> : null}
              {t(submitting
                ? (editing ? "modals:userForm.saving" : "modals:userForm.creating")
                : (editing ? "modals:userForm.save" : "modals:userForm.create"))}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
  );
}

export function UserFormDialog({ mode, onOpenChange, onSubmit, onSuccess, open, user }) {
  const pendingRef = useRef(false);
  const changeOpen = (nextOpen) => {
    if (!nextOpen && pendingRef.current) {
      return;
    }

    onOpenChange(nextOpen);
  };

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      {open ? (
        <UserFormDialogContent
          key={`${mode}-${user?.email || "new"}`}
          mode={mode}
          onOpenChange={changeOpen}
          onSubmit={onSubmit}
          onSuccess={onSuccess}
          pendingRef={pendingRef}
          user={user}
        />
      ) : null}
    </Dialog>
  );
}
