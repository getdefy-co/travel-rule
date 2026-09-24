"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { decideTrpInquiry, getTrpInquiry } from "@/lib/api";

const formatDate = (value, fallback) => {
  if (!value) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

const getPersonName = (person, fallback) => {
  const naturalIdentifier = person.naturalPerson?.name?.nameIdentifier?.[0];
  if (naturalIdentifier) {
    return [naturalIdentifier.primaryIdentifier, naturalIdentifier.secondaryIdentifier].filter(Boolean).join(" ");
  }

  return person.legalPerson?.name?.nameIdentifier?.[0]?.legalPersonName || fallback;
};

const getIdentification = (person, fallback) => {
  const identification = person.naturalPerson?.nationalIdentification || person.legalPerson?.nationalIdentification;
  if (!identification?.nationalIdentifier) {
    return fallback;
  }

  return identification.nationalIdentifierType ? `${identification.nationalIdentifier} (${identification.nationalIdentifierType})` : identification.nationalIdentifier;
};

const getAddresses = (person) => {
  return person.naturalPerson?.geographicAddress || person.legalPerson?.geographicAddress || [];
};

function MetadataItem({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border bg-muted/30 p-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function PersonSummary({ people, title }) {
  const { t } = useTranslation();
  const fallback = t("common:state.na");

  return (
    <section aria-label={title} className="space-y-3">
      <h3 className="text-sm font-semibold">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-muted-foreground">{fallback}</p>
      ) : (
        people.map((person, index) => {
          const naturalPerson = person.naturalPerson;
          const customerId = naturalPerson?.customerIdentification || person.legalPerson?.customerIdentification || fallback;
          const residence = naturalPerson?.countryOfResidence || person.legalPerson?.countryOfRegistration || fallback;

          return (
            <article className="rounded-lg border p-4" key={`${title}-${index}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h4 className="font-medium">{getPersonName(person, fallback)}</h4>
                <Badge variant="neutral">{naturalPerson ? t("enums:personType.natural") : t("enums:personType.legal")}</Badge>
              </div>
              <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-muted-foreground">{t("common:inquiryDetail.accounts")}</dt>
                  <dd className="break-all">{person.accountNumber?.join(", ") || fallback}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("common:inquiryDetail.identification")}</dt>
                  <dd>{getIdentification(person, fallback)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("common:inquiryDetail.customerId")}</dt>
                  <dd className="break-all">{customerId}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">{t("common:inquiryDetail.residence")}</dt>
                  <dd>{residence}</dd>
                </div>
              </dl>
              <div className="mt-3 space-y-1 text-sm">
                <p className="text-muted-foreground">{t("common:inquiryDetail.addresses")}</p>
                {getAddresses(person).length === 0 ? (
                  <p>{fallback}</p>
                ) : (
                  getAddresses(person).map((address, addressIndex) => {
                    const formattedAddress = [...(address.addressLine || []), address.townName, address.country].filter(Boolean).join(", ");
                    return <p key={`${formattedAddress}-${addressIndex}`}>{formattedAddress || fallback}</p>;
                  })
                )}
              </div>
            </article>
          );
        })
      )}
    </section>
  );
}

function DetailLoading() {
  return (
    <div aria-label="Loading inquiry details" className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((item) => (
          <Skeleton className="h-20" key={item} />
        ))}
      </div>
      <Skeleton className="h-40" />
      <Skeleton className="h-40" />
    </div>
  );
}

export function InquiryDetailDialog({ inquiryId, onDecisionComplete, onOpenChange, open }) {
  const { t } = useTranslation();
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState("detail");
  const [paymentAddress, setPaymentAddress] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [validationError, setValidationError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const detailRequest = useRef(0);
  const submitLock = useRef(false);
  const decisionInput = useRef(null);

  const loadDetail = useCallback(
    async (reset = false) => {
      const requestId = detailRequest.current + 1;
      detailRequest.current = requestId;
      if (reset) {
        setDetail(null);
        setStage("detail");
        setPaymentAddress("");
        setRejectionReason("");
        setValidationError("");
        submitLock.current = false;
        setSubmitting(false);
      }
      setLoading(true);
      setError(false);

      try {
        const response = await getTrpInquiry(inquiryId);
        if (detailRequest.current === requestId) {
          setDetail(response);
          setLoading(false);
        }
      } catch {
        if (detailRequest.current === requestId) {
          setError(true);
          toast.error(t("errors:api.inquiryDetailFailed"));
          setLoading(false);
        }
      }
    },
    [inquiryId, t],
  );

  useEffect(() => {
    if (!open || !inquiryId) {
      detailRequest.current += 1;
      return;
    }

    let current = true;
    Promise.resolve().then(() => { if (current) loadDetail(true); });
    return () => {
      current = false;
      detailRequest.current += 1;
    };
  }, [inquiryId, loadDetail, open]);

  const beginDecision = (decision) => {
    setValidationError("");
    setStage(decision);
  };

  const reviewDecision = (decision) => {
    const value = decision === "approved" ? paymentAddress.trim() : rejectionReason.trim();
    if (!value) {
      const message = t(decision === "approved" ? "modals:inquiryReview.paymentAddressRequired" : "modals:inquiryReview.rejectionReasonRequired");
      setValidationError(message);
      decisionInput.current?.focus();
      toast.error(message);
      return;
    }

    setValidationError("");
    setStage(`confirm-${decision}`);
  };

  const submitDecision = async (decision) => {
    /* istanbul ignore next -- the disabled button is primary; this ref closes the same-tick race. */
    if (submitLock.current) {
      return;
    }

    const requestId = detailRequest.current;
    submitLock.current = true;
    setSubmitting(true);
    const payload = decision === "approved" ? { decision, payment_address: paymentAddress.trim() } : { decision, reason: rejectionReason.trim() };

    try {
      const response = await decideTrpInquiry(inquiryId, payload);
      if (detailRequest.current !== requestId) return;
      if (response.retryable) {
        toast.warning(t("modals:inquiryReview.deliveryPending"));
      } else {
        toast.success(t(`modals:inquiryReview.${decision}Success`));
      }
      onDecisionComplete();
      onOpenChange(false);
    } catch (requestError) {
      if (detailRequest.current !== requestId) return;
      if (requestError.status === 409) {
        toast.error(t("modals:inquiryReview.conflict"));
        setStage("detail");
        setSubmitting(false);
        await loadDetail();
        if (detailRequest.current === requestId + 1) onDecisionComplete();
      } else {
        toast.error(t("errors:api.inquiryDecisionFailed"));
      }
    } finally {
      submitLock.current = false;
      if (detailRequest.current === requestId) setSubmitting(false);
    }
  };

  const closeDialog = (nextOpen) => {
    if (!nextOpen) {
      detailRequest.current += 1;
    }
    onOpenChange(nextOpen);
  };

  const fallback = t("common:state.na");
  const canDecide = detail?.state === "pending" && detail.ivms101;
  const originators = detail?.ivms101?.originator?.originatorPerson || [];
  const beneficiaries = detail?.ivms101?.beneficiary?.beneficiaryPerson || [];

  return (
    <Dialog open={open} onOpenChange={closeDialog}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-3xl lg:max-w-5xl">
        <DialogHeader>
          <DialogTitle>{t("modals:inquiryReview.title")}</DialogTitle>
          <DialogDescription>{t("modals:inquiryReview.description")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <DetailLoading />
        ) : error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
            <Button className="mt-3" onClick={() => loadDetail()} size="sm" type="button" variant="outline">
              {t("modals:inquiryReview.retryDetails")}
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-6">
            <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetadataItem label={t("common:inquiryDetail.status")} value={<Badge variant={statusBadgeVariant(detail.state)}>{t(`enums:inquiryStatus.${detail.state}`)}</Badge>} />
              <MetadataItem label={t("common:inquiryDetail.direction")} value={detail.direction} />
              <MetadataItem label={t("common:inquiryDetail.assetDti")} value={detail.asset?.dti || fallback} />
              <MetadataItem label={t("common:inquiryDetail.amount")} value={detail.amount || fallback} />
              <MetadataItem label={t("common:inquiryDetail.created")} value={formatDate(detail.created_at, fallback)} />
              <MetadataItem label={t("common:inquiryDetail.updated")} value={formatDate(detail.updated_at, fallback)} />
              <MetadataItem label={t("common:inquiryDetail.expires")} value={formatDate(detail.expires_at, fallback)} />
              <MetadataItem label={t("common:inquiryDetail.protocol")} value={detail.protocol} />
            </dl>

            {!detail.ivms101 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <h3 className="font-medium">{t("common:inquiryDetail.awaitingTitle")}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{t("common:inquiryDetail.awaitingDescription")}</p>
              </div>
            ) : (
              <>
                <div className="grid gap-6 lg:grid-cols-2">
                  <PersonSummary people={originators} title={t("common:inquiryDetail.originators")} />
                  <PersonSummary people={beneficiaries} title={t("common:inquiryDetail.beneficiaries")} />
                </div>
                <section aria-label={t("common:inquiryDetail.rawJson")} className="space-y-2">
                  <h3 className="text-sm font-semibold">{t("common:inquiryDetail.rawJson")}</h3>
                  <pre className="max-h-80 overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">{JSON.stringify(detail.ivms101, null, 2)}</pre>
                </section>
              </>
            )}

            {canDecide && stage === "detail" ? (
              <DialogFooter>
                <Button onClick={() => beginDecision("rejected")} type="button" variant="destructive">
                  {t("modals:inquiryReview.reject")}
                </Button>
                <Button onClick={() => beginDecision("approved")} type="button">
                  {t("modals:inquiryReview.approve")}
                </Button>
              </DialogFooter>
            ) : null}

            {stage === "approved" ? (
              <form
                className="rounded-lg border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  reviewDecision("approved");
                }}
              >
                <Label htmlFor="payment-address" className="mb-4">
                  {t("modals:inquiryReview.paymentAddress")}
                </Label>
                <Input ref={decisionInput} aria-invalid={Boolean(validationError)} id="payment-address" placeholder={t("modals:inquiryReview.paymentAddressPlaceholder")} onChange={(event) => { setValidationError(""); setPaymentAddress(event.target.value); }} value={paymentAddress} />
                <DialogFooter className="mt-4">
                  <Button onClick={() => setStage("detail")} type="button" variant="outline">
                    {t("modals:inquiryReview.cancel")}
                  </Button>
                  <Button type="submit">{t("modals:inquiryReview.reviewApproval")}</Button>
                </DialogFooter>
              </form>
            ) : null}

            {stage === "rejected" ? (
              <form
                className="rounded-lg border p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  reviewDecision("rejected");
                }}
              >
                <Label htmlFor="rejection-reason" className="mb-4">
                  {t("modals:inquiryReview.rejectionReason")}
                </Label>
                <Input ref={decisionInput} aria-invalid={Boolean(validationError)} id="rejection-reason" placeholder={t("modals:inquiryReview.rejectionReasonPlaceholder")} onChange={(event) => { setValidationError(""); setRejectionReason(event.target.value); }} value={rejectionReason} />
                <DialogFooter className="mt-4">
                  <Button onClick={() => setStage("detail")} type="button" variant="outline">
                    {t("modals:inquiryReview.cancel")}
                  </Button>
                  <Button type="submit" variant="destructive">
                    {t("modals:inquiryReview.reviewRejection")}
                  </Button>
                </DialogFooter>
              </form>
            ) : null}

            {stage === "confirm-approved" ? (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <p className="text-sm">{t("modals:inquiryReview.approvalConfirmation", { paymentAddress: paymentAddress.trim() })}</p>
                <DialogFooter className="mt-4">
                  <Button disabled={submitting} onClick={() => setStage("approved")} type="button" variant="outline">
                    {t("modals:inquiryReview.back")}
                  </Button>
                  <Button disabled={submitting} onClick={() => submitDecision("approved")} type="button">
                    {t("modals:inquiryReview.confirmApproval")}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}

            {stage === "confirm-rejected" ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                <p className="text-sm">{t("modals:inquiryReview.rejectionConfirmation", { reason: rejectionReason.trim() })}</p>
                <DialogFooter className="mt-4">
                  <Button disabled={submitting} onClick={() => setStage("rejected")} type="button" variant="outline">
                    {t("modals:inquiryReview.back")}
                  </Button>
                  <Button disabled={submitting} onClick={() => submitDecision("rejected")} type="button" variant="destructive">
                    {t("modals:inquiryReview.confirmRejection")}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
