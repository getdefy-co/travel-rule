"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useTranslation } from "react-i18next";

const ProtectedRoute = ({ children, redirectTo = "/login", requiredRole, requiredRoles, unauthorizedRedirectTo = "/" }) => {
  const { isAuthenticated, isLoading, user } = useAuth();
  const router = useRouter();
  const { t } = useTranslation();
  const acceptedRoles = requiredRoles || (requiredRole ? [requiredRole] : null);
  const hasRequiredRole = !acceptedRoles || acceptedRoles.includes(user?.role) || (acceptedRoles.includes("admin") && user?.role === "platform_admin");

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push(redirectTo);
    } else if (!isLoading && !hasRequiredRole) {
      router.push(unauthorizedRedirectTo);
    }
  }, [isAuthenticated, isLoading, router, redirectTo, hasRequiredRole, unauthorizedRedirectTo]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div role="status" aria-label={t("common:state.loading")} className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
      </div>
    );
  }

  if (!isAuthenticated || !hasRequiredRole) {
    return null;
  }

  return children;
};

export default ProtectedRoute;
