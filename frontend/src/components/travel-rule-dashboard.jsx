"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeftRight, CircleCheckBig, MessageCircleWarning } from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { getTrpAnalytics } from "@/lib/api";

const RANGES = ["7d", "30d", "90d"];
const PHASES = ["inquiry", "resolution", "confirmation"];
const DELIVERY_STATES = ["delivered", "pending", "received", "failed"];

const percentage = (value) => new Intl.NumberFormat("en", { maximumFractionDigits: 1, style: "percent" }).format(value);

function ChartEmpty({ description, title }) {
  return (
    <Empty className="min-h-64 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon"><Activity /></EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

export function TravelRuleDashboard() {
  const { t } = useTranslation();
  const [range, setRange] = useState("30d");
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let current = true;
    getTrpAnalytics(range).then((result) => {
      if (current) {
        setAnalytics(result);
        setLoading(false);
      }
    }).catch(() => {
      if (current) {
        toast.error(t("errors:api.fetchTrpAnalytics"));
        setFailed(true);
        setLoading(false);
      }
    });
    return () => {
      current = false;
    };
  }, [range, revision, t]);

  const retry = useCallback(() => {
    setLoading(true);
    setFailed(false);
    setRevision((current) => current + 1);
  }, []);
  const changeRange = (value) => {
    if (value) {
      setLoading(true);
      setFailed(false);
      setRange(value);
    }
  };
  const derived = useMemo(() => {
    if (!analytics) {
      return null;
    }
    const activity = Array.from(analytics.trends.reduce((days, row) => {
      const item = days.get(row.day) || { day: row.day, inbound: 0, outbound: 0 };
      item[row.direction] = row.count;
      days.set(row.day, item);
      return days;
    }, new Map()).values());
    const messageDelivery = PHASES.map((phase) => {
      const counts = Object.fromEntries(DELIVERY_STATES.map((state) => [state, 0]));
      analytics.message_states.filter((row) => row.phase === phase).forEach((row) => {
        counts[row.delivery_state] = row.count;
      });
      const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
      return {
        phase: t(`enums:messagePhase.${phase}`),
        ...Object.fromEntries(DELIVERY_STATES.map((state) => [state, total ? (counts[state] / total) * 100 : 0])),
      };
    });
    const failedMessages = analytics.message_states.filter((row) => row.delivery_state === "failed").reduce((sum, row) => sum + row.count, 0);
    return { activity, failedMessages, messageDelivery };
  }, [analytics, t]);

  if (loading) {
    return (
      <section aria-label={t("common:analytics.loading")} className="grid flex-1 gap-4 p-4 md:grid-cols-2 md:p-8" role="status">
        {[0, 1, 2, 3, 4, 5].map((item) => <Skeleton className={item < 4 ? "h-28" : "h-80"} key={item} />)}
      </section>
    );
  }

  if (failed || !analytics || !derived) {
    return (
      <section className="flex flex-1 items-center justify-center p-4 md:p-8">
        <Button onClick={retry} size="sm" type="button" variant="outline">{t("common:analytics.retry")}</Button>
      </section>
    );
  }

  const activityConfig = {
    inbound: { color: "var(--chart-1)", label: t("enums:direction.inbound") },
    outbound: { color: "var(--chart-2)", label: t("enums:direction.outbound") },
  };
  const stateConfig = { count: { color: "var(--chart-1)", label: t("common:analytics.transfers") } };
  const messageConfig = Object.fromEntries(DELIVERY_STATES.map((state, index) => [state, { color: `var(--chart-${index + 1})`, label: t(`enums:deliveryState.${state}`) }]));
  const progressRows = [
    { label: t("common:analytics.confirmationRate"), value: analytics.summary.confirmed_rate },
    { label: t("common:analytics.deliveryRate"), value: analytics.summary.delivery_rate },
    { label: t("common:analytics.approvalRate"), value: analytics.summary.transfers ? analytics.transfer_states.filter((row) => ["approved", "confirmed"].includes(row.state)).reduce((sum, row) => sum + row.count, 0) / analytics.summary.transfers : 0 },
  ];
  const kpis = [
    { icon: ArrowLeftRight, label: t("common:analytics.totalTransfers"), value: analytics.summary.transfers },
    { icon: Activity, label: t("common:analytics.pendingInquiries"), value: analytics.summary.pending_inquiries },
    { icon: CircleCheckBig, label: t("common:analytics.confirmedRate"), value: percentage(analytics.summary.confirmed_rate) },
    { icon: MessageCircleWarning, label: t("common:analytics.failedMessages"), value: derived.failedMessages },
  ];

  return (
    <section aria-label={t("common:analytics.contentLabel")} className="flex flex-1 flex-col gap-6 p-4 md:p-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("common:analytics.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("common:analytics.description")}</p>
        </div>
        <ToggleGroup aria-label={t("common:analytics.rangeLabel")} onValueChange={changeRange} type="single" value={range} variant="outline">
          {RANGES.map((item) => <ToggleGroupItem aria-label={item.toUpperCase()} key={item} value={item}>{item.toUpperCase()}</ToggleGroupItem>)}
        </ToggleGroup>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map(({ icon: Icon, label, value }) => (
          <Card key={label}>
            <CardHeader className="flex flex-row items-center justify-between gap-3 pb-2">
              <CardDescription>{label}</CardDescription>
              <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon /></span>
            </CardHeader>
            <CardContent><CardTitle className="text-3xl">{value}</CardTitle></CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2" data-testid="analytics-chart-grid">
        <Card>
          <CardHeader><CardTitle>{t("common:analytics.activityTitle")}</CardTitle><CardDescription>{t("common:analytics.activityDescription")}</CardDescription></CardHeader>
          <CardContent>
            {derived.activity.length ? (
              <ChartContainer className="h-64 w-full" config={activityConfig} data-testid="activity-chart-container">
                <AreaChart accessibilityLayer data={derived.activity} margin={{ left: 8, right: 8 }}>
                  <CartesianGrid vertical={false} /><XAxis dataKey="day" tickLine={false} /><YAxis allowDecimals={false} tickLine={false} />
                  <ChartTooltip content={<ChartTooltipContent />} /><ChartLegend content={<ChartLegendContent />} />
                  <Area dataKey="inbound" fill="var(--color-inbound)" fillOpacity={0.2} stroke="var(--color-inbound)" type="monotone" />
                  <Area dataKey="outbound" fill="var(--color-outbound)" fillOpacity={0.15} stroke="var(--color-outbound)" type="monotone" />
                </AreaChart>
              </ChartContainer>
            ) : <ChartEmpty description={t("common:analytics.empty")} title={t("common:analytics.activityTitle")} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("common:analytics.stateTitle")}</CardTitle><CardDescription>{t("common:analytics.stateDescription")}</CardDescription></CardHeader>
          <CardContent>
            {analytics.transfer_states.length ? (
              <ChartContainer className="h-64 w-full" config={stateConfig} data-testid="state-chart-container">
                <BarChart accessibilityLayer data={analytics.transfer_states.map((row) => ({ ...row, state: t(`enums:inquiryStatus.${row.state}`) }))} layout="vertical">
                  <CartesianGrid horizontal={false} /><XAxis allowDecimals={false} type="number" /><YAxis dataKey="state" tickLine={false} type="category" width={88} />
                  <ChartTooltip content={<ChartTooltipContent />} /><Bar dataKey="count" fill="var(--color-count)" radius={4} />
                </BarChart>
              </ChartContainer>
            ) : <ChartEmpty description={t("common:analytics.empty")} title={t("common:analytics.stateTitle")} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("common:analytics.deliveryTitle")}</CardTitle><CardDescription>{t("common:analytics.deliveryDescription")}</CardDescription></CardHeader>
          <CardContent>
            {analytics.message_states.length ? (
              <ChartContainer className="h-64 w-full" config={messageConfig} data-testid="delivery-chart-container">
                <BarChart accessibilityLayer data={derived.messageDelivery}>
                  <CartesianGrid vertical={false} /><XAxis dataKey="phase" tickLine={false} /><YAxis domain={[0, 100]} tickFormatter={(value) => `${value}%`} />
                  <ChartTooltip content={<ChartTooltipContent />} /><ChartLegend content={<ChartLegendContent />} />
                  {DELIVERY_STATES.map((state) => <Bar dataKey={state} fill={`var(--color-${state})`} key={state} radius={state === "failed" ? 4 : 0} stackId="delivery" />)}
                </BarChart>
              </ChartContainer>
            ) : <ChartEmpty description={t("common:analytics.empty")} title={t("common:analytics.deliveryTitle")} />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>{t("common:analytics.progressTitle")}</CardTitle><CardDescription>{t("common:analytics.progressDescription")}</CardDescription></CardHeader>
          <CardContent className="space-y-8 pt-3">
            {progressRows.map((row) => {
              const label = `${row.label} ${percentage(row.value)}`;
              return (
                <div className="space-y-2" key={row.label}>
                  <div className="flex justify-between gap-4 text-sm"><span>{row.label}</span><span className="font-medium">{percentage(row.value)}</span></div>
                  <Progress aria-label={label} value={row.value * 100} />
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
