"use client";

import { LoginForm } from "@/components/login-form";
import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";

function LoadingState() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div role="status" aria-label={t("common:state.loading")} className="animate-spin rounded-full h-8 w-8 border-b-2 border-slate-900 dark:border-slate-50"></div>
    </div>
  );
}

function LoginContent() {
  const { isAuthenticated, isLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const resetToken = searchParams.get("rpt");
  const isResetMode = !!resetToken;
  const { t } = useTranslation();
  const heading = isResetMode ? t("auth:reset.title") : t("auth:login.title");

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.push("/");
    }
  }, [isAuthenticated, isLoading, router]);

  if (isLoading && !isAuthenticated) {
    return <LoadingState />;
  }

  if (isAuthenticated) {
    return null;
  }

  return (
    <main aria-labelledby="login-heading" className="flex min-h-svh w-full items-center justify-center p-6 md:p-10 bg-slate-50 dark:bg-zinc-800">
      <h1 id="login-heading" className="sr-only">{heading}</h1>
      <div className="w-full max-w-sm">
        <LoginForm resetToken={resetToken} isResetMode={isResetMode} />
      </div>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense
      fallback={<LoadingState />}
    >
      <LoginContent />
    </Suspense>
  );
}
