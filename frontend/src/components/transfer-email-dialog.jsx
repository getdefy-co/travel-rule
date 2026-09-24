"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createTravelRuleEmailInvitation } from "@/lib/api";

const isRecipientEmail = (value) => value.length <= 254 && !/[\r\n]/.test(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);

export function TransferEmailDialog({ onComplete, onOpenChange, open, transferId }) {
  const { t } = useTranslation();
  const [recipient, setRecipient] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const recipientInput = useRef(null);
  const active = useRef(false);
  useEffect(() => {
    active.current = open;
    return () => { active.current = false; };
  }, [open]);

  const submit = async (event) => {
    event.preventDefault();

    if (submitting.current) {
      return;
    }

    const normalized = recipient.trim();
    if (!isRecipientEmail(normalized)) {
      setInvalid(true);
      recipientInput.current.focus();
      toast.error(t("common:mail.invitation.invalidEmail"));
      return;
    }

    submitting.current = true;
    setSaving(true);
    setInvalid(false);
    try {
      await createTravelRuleEmailInvitation(transferId, normalized);
      if (!active.current) return;
      onOpenChange(false);
      onComplete();
    } catch {
      submitting.current = false;
      if (active.current) toast.error(t("errors:api.createTravelRuleEmail"));
    } finally {
      if (active.current) setSaving(false);
    }
  };

  const changeOpen = (nextOpen) => {
    if (!saving) {
      onOpenChange(nextOpen);
    }
  };

  return (
    <Dialog onOpenChange={changeOpen} open={open}>
      <DialogContent showCloseButton={!saving}>
        <form aria-label={t("common:mail.invitation.formLabel")} noValidate onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>{t("common:mail.invitation.title")}</DialogTitle>
            <DialogDescription>{t("common:mail.invitation.description")}</DialogDescription>
          </DialogHeader>
          <FieldGroup className="py-6">
            <Field>
              <FieldLabel htmlFor="travel-rule-recipient-email">{t("common:mail.invitation.recipient")}</FieldLabel>
              <Input
                aria-invalid={invalid}
                ref={recipientInput}
                autoComplete="email"
                disabled={saving}
                id="travel-rule-recipient-email"
                maxLength={254}
                onChange={(event) => { setRecipient(event.target.value); setInvalid(false); }}
                placeholder={t("common:mail.invitation.placeholder")}
                type="email"
                value={recipient}
              />
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button disabled={saving} onClick={() => changeOpen(false)} type="button" variant="outline">{t("common:resources.actions.cancel")}</Button>
            <Button aria-busy={saving} disabled={saving} type="submit">{t("common:mail.invitation.submit")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
