"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Pencil, Plus, RefreshCw, UserCheck, UserX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";

import { UserFormDialog } from "@/components/user-form-dialog";
import { UserStatusDialog } from "@/components/user-status-dialog";
import { Badge, statusBadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/contexts/AuthContext";
import {
  activateManagedUser,
  createManagedUser,
  deactivateManagedUser,
  editManagedUser,
  listManagedUsers,
} from "@/lib/api";

const PAGE_SIZES = [10, 25, 50];

const formatDate = (value, fallback) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return fallback;
  }

  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
};

export function UserManagement() {
  const { t } = useTranslation();
  const { user: currentUser } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [list, setList] = useState({ data: [], pageCount: 0 });
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState(false);
  const [formState, setFormState] = useState({ open: false, mode: "create", user: null });
  const [statusState, setStatusState] = useState({ open: false, action: "activate", user: null });
  const listRequest = useRef(0);

  useEffect(() => {
    const normalizedSearch = search.trim();
    if (normalizedSearch === debouncedSearch) {
      return undefined;
    }

    const timer = setTimeout(() => {
      setPage(1);
      setDebouncedSearch(normalizedSearch);
    }, 400);

    return () => clearTimeout(timer);
  }, [debouncedSearch, search]);

  const loadUsers = useCallback(() => {
    const requestId = listRequest.current + 1;
    listRequest.current = requestId;
    setLoading(true);
    setListError(false);

    listManagedUsers({ page, limit, search: debouncedSearch }).then((response) => {
      if (listRequest.current === requestId) {
        setList(response);
        setLoading(false);
      }
    }).catch(() => {
      if (listRequest.current === requestId) {
        setListError(true);
        setLoading(false);
        toast.error(t("errors:api.managedUserListFailed"));
      }
    });
  }, [debouncedSearch, limit, page, t]);

  useEffect(() => {
    let current = true;
    Promise.resolve().then(() => {
      if (current) {
        loadUsers();
      }
    });
    return () => {
      current = false;
      listRequest.current += 1;
    };
  }, [loadUsers]);

  const mutationSucceeded = useCallback(() => {
    if (page === 1) {
      loadUsers();
    } else {
      setPage(1);
    }
  }, [loadUsers, page]);

  const openCreate = () => setFormState({ open: true, mode: "create", user: null });
  const openEdit = (managedUser) => setFormState({ open: true, mode: "edit", user: managedUser });
  const openStatus = (action, managedUser) => setStatusState({ open: true, action, user: managedUser });
  const totalPages = Math.max(1, list.pageCount);
  const fallback = t("common:state.na");

  return (
    <section aria-label={t("common:users.contentLabel")} className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t("common:users.title")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t("common:users.description")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            aria-label={t("common:users.refresh")}
            disabled={loading}
            onClick={loadUsers}
            type="button"
            variant="outline"
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
            {t("common:users.refreshLabel")}
          </Button>
          <Button onClick={openCreate} type="button">
            <Plus />
            {t("common:users.newUser")}
          </Button>
        </div>
      </div>

      <Card className="gap-0 py-0">
        <CardHeader className="flex flex-col gap-4 border-b py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>{t("common:users.directoryTitle")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{t("common:users.directoryDescription")}</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              aria-label={t("common:users.search")}
              className="w-full sm:w-64"
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("common:users.searchPlaceholder")}
              role="searchbox"
              type="search"
              value={search}
            />
            <Select
              onValueChange={(nextLimit) => {
                setLimit(Number(nextLimit));
                setPage(1);
              }}
              value={String(limit)}
            >
              <SelectTrigger aria-label={t("common:users.rowsPerPage")} className="w-full sm:w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_SIZES.map((pageSize) => (
                  <SelectItem key={pageSize} value={String(pageSize)}>{pageSize}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardHeader>

        <CardContent className="px-0">
          <div className="overflow-x-auto">
            <Table aria-label={t("common:users.tableLabel")}>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common:users.columns.email")}</TableHead>
                  <TableHead>{t("common:users.columns.role")}</TableHead>
                  <TableHead>{t("common:users.columns.status")}</TableHead>
                  <TableHead>{t("common:users.columns.created")}</TableHead>
                  <TableHead className="text-right">{t("common:users.columns.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? [0, 1, 2].map((row) => (
                  <TableRow aria-label={row === 0 ? t("common:users.loading") : undefined} key={row}>
                    {[0, 1, 2, 3, 4].map((cell) => (
                      <TableCell key={cell}><Skeleton className="h-6 w-full" /></TableCell>
                    ))}
                  </TableRow>
                )) : null}
                {!loading && listError ? (
                  <TableRow>
                    <TableCell className="h-40 text-center" colSpan={5}>
                      <Button className="mt-3" onClick={loadUsers} size="sm" type="button" variant="outline">
                        {t("common:users.retry")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && !listError && list.data.length === 0 ? (
                  <TableRow>
                    <TableCell className="h-40 text-center text-muted-foreground" colSpan={5}>
                      {t("common:users.empty")}
                    </TableCell>
                  </TableRow>
                ) : null}
                {!loading && !listError ? list.data.map((managedUser) => {
                  const isCurrent = managedUser.email === currentUser?.email;
                  return (
                    <TableRow key={managedUser.email}>
                      <TableCell className="max-w-80">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-medium">{managedUser.email}</span>
                          {isCurrent ? <Badge variant="info">{t("common:users.currentAccount")}</Badge> : null}
                        </div>
                      </TableCell>
                      <TableCell><Badge variant={["admin", "platform_admin"].includes(managedUser.role) ? "accent" : "neutral"}>{t(`enums:roles.${managedUser.role}`)}</Badge></TableCell>
                      <TableCell>
                        <Badge variant={statusBadgeVariant(managedUser.active ? "active" : "inactive")}>
                          {t(`enums:userStatus.${managedUser.active ? "active" : "inactive"}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{formatDate(managedUser.created_at, fallback)}</TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Button
                            aria-label={t("common:users.edit", { email: managedUser.email })}
                            disabled={isCurrent}
                            onClick={() => openEdit(managedUser)}
                            size="icon"
                            type="button"
                            variant="ghost"
                          >
                            <Pencil />
                          </Button>
                          {managedUser.active ? (
                            <Button
                              aria-label={t("common:users.deactivate", { email: managedUser.email })}
                              className="text-destructive hover:text-destructive"
                              disabled={isCurrent}
                              onClick={() => openStatus("deactivate", managedUser)}
                              size="icon"
                              type="button"
                              variant="ghost"
                            >
                              <UserX />
                            </Button>
                          ) : (
                            <Button
                              aria-label={t("common:users.activate", { email: managedUser.email })}
                              className="text-emerald-700 hover:text-emerald-700 dark:text-emerald-300"
                              onClick={() => openStatus("activate", managedUser)}
                              size="icon"
                              type="button"
                              variant="ghost"
                            >
                              <UserCheck />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                }) : null}
              </TableBody>
            </Table>
          </div>

          <div className="flex flex-col items-center justify-between gap-3 border-t px-4 py-4 sm:flex-row">
            <p className="text-sm text-muted-foreground">
              {t("common:users.page", { page, totalPages })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                aria-label={t("common:users.previous")}
                disabled={page <= 1 || loading}
                onClick={() => setPage((current) => current - 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("common:users.previousLabel")}
              </Button>
              <Button
                aria-label={t("common:users.next")}
                disabled={page >= totalPages || loading}
                onClick={() => setPage((current) => current + 1)}
                size="sm"
                type="button"
                variant="outline"
              >
                {t("common:users.nextLabel")}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <UserFormDialog
        mode={formState.mode}
        onOpenChange={(open) => setFormState((current) => ({ ...current, open }))}
        onSubmit={formState.mode === "edit" ? editManagedUser : createManagedUser}
        onSuccess={mutationSucceeded}
        open={formState.open}
        user={formState.user}
      />
      <UserStatusDialog
        action={statusState.action}
        onConfirm={statusState.action === "deactivate" ? deactivateManagedUser : activateManagedUser}
        onOpenChange={(open) => setStatusState((current) => ({ ...current, open }))}
        onSuccess={mutationSucceeded}
        open={statusState.open}
        user={statusState.user}
      />
    </section>
  );
}
