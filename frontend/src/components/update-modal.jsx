"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { submitUpdateRequest } from "@/lib/api";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UpdateModal({ open, onOpenChange }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const emailInput = useRef(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = open;
    return () => { active.current = false; };
  }, [open]);

  const changeOpen = (nextOpen) => {
    if (!submitting.current) onOpenChange(nextOpen);
  };
  const submit = async (event) => {
    event.preventDefault();
    if (submitting.current) return;
    const address = email.trim();
    setEmail(address);
    if (address.length > 254 || !EMAIL_PATTERN.test(address)) {
      setInvalid(true);
      emailInput.current.focus();
      toast.error(t("modals:updates.emailInvalid"));
      return;
    }
    submitting.current = true;
    setSaving(true);
    setInvalid(false);
    try {
      await submitUpdateRequest(address);
      if (!active.current) return;
      toast.success(t("modals:updates.success"));
      onOpenChange(false);
    } catch (failure) {
      if (active.current) toast.error(failure?.message || t("errors:updates.failed"));
    } finally {
      submitting.current = false;
      if (active.current) setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{t("modals:updates.title")}</DialogTitle>
          <DialogDescription>{t("modals:updates.description")}</DialogDescription>
        </DialogHeader>
        <form aria-label={t("modals:updates.formLabel")} noValidate onSubmit={submit}>
          <FieldGroup className="pb-6">
            <Field>
              <FieldLabel htmlFor="update-email">{t("modals:updates.email")}</FieldLabel>
              <Input
                aria-invalid={invalid}
                ref={emailInput}
                autoComplete="email"
                disabled={saving}
                id="update-email"
                maxLength={254}
                onChange={(event) => { setEmail(event.target.value); setInvalid(false); }}
                placeholder={t("modals:updates.emailPlaceholder")}
                required
                type="email"
                value={email}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={saving} onClick={() => changeOpen(false)} type="button" variant="outline">{t("modals:updates.cancel")}</Button>
            <Button aria-busy={saving} disabled={saving} type="submit">{t(saving ? "modals:updates.sending" : "modals:updates.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
