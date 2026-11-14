import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorNote, Logo } from "./components/ui";
import { ConfirmEmailPage, ForgotPasswordPage, LoginPage, RegisterPage, ResetPasswordPage, VerifyPage } from "./features/auth/AuthPages";
import { BacklogPage } from "./features/backlog/BacklogPage";
import { GuidePage } from "./features/guide/GuidePage";
import { PlannerPage } from "./features/planner/PlannerPage";
import { ReviewPage } from "./features/review/ReviewPage";
import { AppShell } from "./features/shell/AppShell";
import { TodayPage } from "./features/today/TodayPage";
import { WeekPage } from "./features/week/WeekPage";
import { keys, useMe } from "./lib/queries";
import { setTimeZone } from "./lib/time";

// Settings carries the QR-code generator; load it only when someone opens that page.
const SettingsPage = lazy(() => import("./features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));

function Splash() {
  return (
    <div className="splash" role="status" aria-label="Loading manageBagle">
      <Logo size={40} wordmark={false} />
    </div>
  );
}

function RequireAuth() {
  const me = useMe();
  const location = useLocation();
  const qc = useQueryClient();

  // Any API call that discovers the session has ended sends the user back to sign in.
  useEffect(() => {
    const onSignedOut = () => {
      // Nothing of the previous account may linger on screen or in memory.
      qc.clear();
      qc.setQueryData(keys.me, null);
    };
    window.addEventListener("mb:signed-out", onSignedOut);
    return () => window.removeEventListener("mb:signed-out", onSignedOut);
  }, [qc]);

  if (me.isPending) return <Splash />;
  if (me.isError) {
    return (
      <div className="splash">
        <ErrorNote onRetry={() => me.refetch()}>We could not reach manageBagle. Check your connection.</ErrorNote>
      </div>
    );
  }
  if (!me.data) {
    const from = location.pathname + location.search;
    return <Navigate to={from === "/" ? "/login" : `/login?next=${encodeURIComponent(from)}`} replace />;
  }
  // "Today" and "now" follow the zone the account plans in.
  setTimeZone(me.data.timeZone);
  return <AppShell />;
}

function GuestOnly() {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Splash />;
  if (me.data) {
    // Signed in (just now, or already): continue to where the visitor was heading, same-site paths only.
    const next = new URLSearchParams(location.search).get("next");
    return <Navigate to={next && next.startsWith("/") && !next.startsWith("//") ? next : "/"} replace />;
  }
  return <Outlet />;
}

export function App() {
  return (
    <ErrorBoundary area="manageBagle">
    <Routes>
      <Route element={<GuestOnly />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/login/verify" element={<VerifyPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/reset-password" element={<ResetPasswordPage />} />
      </Route>
      {/* Reachable signed in or out: the link may be opened in a browser that already has a session. */}
      <Route path="/confirm-email" element={<ConfirmEmailPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<TodayPage />} />
        <Route path="/week" element={<WeekPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/backlog" element={<BacklogPage />} />
        <Route path="/review" element={<ReviewPage />} />
        <Route path="/guide" element={<GuidePage />} />
        <Route path="/settings" element={<Suspense fallback={null}><SettingsPage /></Suspense>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
    </ErrorBoundary>
  );
}
