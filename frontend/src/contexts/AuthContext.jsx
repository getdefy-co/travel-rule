"use client";

import { createContext, useContext, useEffect, useReducer, useRef } from "react";
import { toast } from "sonner";
import { getUserInfo, loginUser, logoutUser } from "@/lib/api";
import i18n from "@/i18n/config";

const initialState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,
};

const AUTH_ACTIONS = {
  LOGIN_START: "LOGIN_START",
  LOGIN_SUCCESS: "LOGIN_SUCCESS",
  LOGIN_FAILURE: "LOGIN_FAILURE",
  LOGOUT: "LOGOUT",
  CLEAR_ERROR: "CLEAR_ERROR",
  SET_LOADING: "SET_LOADING",
};

const authReducer = (state, action) => {
  switch (action.type) {
    case AUTH_ACTIONS.LOGIN_START:
      return { ...state, isLoading: true, error: null };
    case AUTH_ACTIONS.LOGIN_SUCCESS:
      return { ...state, user: action.payload.user, isAuthenticated: true, isLoading: false, error: null };
    case AUTH_ACTIONS.LOGIN_FAILURE:
      return { ...state, user: null, isAuthenticated: false, isLoading: false, error: action.payload.error };
    case AUTH_ACTIONS.LOGOUT:
      return { ...state, user: null, isAuthenticated: false, isLoading: false, error: null };
    case AUTH_ACTIONS.CLEAR_ERROR:
      return { ...state, error: null };
    case AUTH_ACTIONS.SET_LOADING:
      return { ...state, isLoading: action.payload };
    /* istanbul ignore next -- only internal action constants reach this reducer. */
    default:
      return state;
  }
};

const AuthContext = createContext();
const USER_ROLES = new Set(["admin", "auditor", "compliance_approver", "compliance_reviewer", "integration_operator", "platform_admin", "user"]);

const isValidUser = (user) => (
  user &&
  !Array.isArray(user) &&
  typeof user === "object" &&
  typeof user.email === "string" &&
  user.email.trim() !== "" &&
  USER_ROLES.has(user.role) &&
  typeof user.created_at === "string" &&
  user.created_at.trim() !== ""
);

export const AuthProvider = ({ children }) => {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const mountedRef = useRef(false);
  const restoreFailureReportedRef = useRef(false);
  const logoutPromiseRef = useRef(null);

  useEffect(() => {
    let current = true;
    mountedRef.current = true;
    const restoreSession = async () => {
      localStorage.removeItem("authToken");

      try {
        const user = await getUserInfo();

        if (!isValidUser(user)) {
          throw new Error(i18n.t("errors:auth.invalidUser"));
        }

        if (current) {
          dispatch({ type: AUTH_ACTIONS.LOGIN_SUCCESS, payload: { user } });
        }
      } catch (error) {
        if (!current) {
          return;
        }

        dispatch({ type: AUTH_ACTIONS.SET_LOADING, payload: false });
        if (error?.status !== 401 && !restoreFailureReportedRef.current) {
          restoreFailureReportedRef.current = true;
          toast.error(error.message, { id: "auth-session-restore-error" });
        }
      }
    };

    restoreSession();
    return () => {
      current = false;
      mountedRef.current = false;
    };
  }, []);

  const login = async ({ email, password }) => {
    dispatch({ type: AUTH_ACTIONS.LOGIN_START });

    try {
      const sessionEstablished = await loginUser(email, password);

      if (sessionEstablished !== true) {
        throw new Error(i18n.t("errors:auth.noToken"));
      }

      const user = await getUserInfo();

      if (!isValidUser(user)) {
        throw new Error(i18n.t("errors:auth.invalidUser"));
      }

      if (mountedRef.current) {
        dispatch({ type: AUTH_ACTIONS.LOGIN_SUCCESS, payload: { user } });
      }
      return { success: true, user };
    } catch (error) {
      if (mountedRef.current) {
        dispatch({ type: AUTH_ACTIONS.LOGIN_FAILURE, payload: { error: error.message } });
      }
      return { success: false, error: error.message };
    }
  };

  const logout = () => {
    if (logoutPromiseRef.current) {
      return logoutPromiseRef.current;
    }

    localStorage.removeItem("authToken");
    dispatch({ type: AUTH_ACTIONS.LOGOUT });

    const request = (async () => {
      try {
        await logoutUser();
        if (mountedRef.current) {
          toast.success(i18n.t("modals:settings.signOut.successToast"), { id: "auth-logout-result" });
        }
        return { success: true };
      } catch (error) {
        if (mountedRef.current) {
          dispatch({ type: AUTH_ACTIONS.LOGIN_FAILURE, payload: { error: error.message } });
          toast.error(error.message, { id: "auth-logout-result" });
        }
        return { success: false, error: error.message };
      } finally {
        logoutPromiseRef.current = null;
      }
    })();
    logoutPromiseRef.current = request;
    return request;
  };

  const clearError = () => dispatch({ type: AUTH_ACTIONS.CLEAR_ERROR });

  return <AuthContext.Provider value={{ ...state, login, logout, clearError }}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(i18n.t("errors:auth.useAuthContext"));
  }

  return context;
};
