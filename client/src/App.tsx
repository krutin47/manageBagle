import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useEffect } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ErrorNote, Logo } from "./components/ui";
import { AppShell } from "./features/shell/AppShell";
import { TodayPage } from "./features/today/TodayPage";
import { keys, useMe } from "./lib/queries";
import { setTimeZone } from "./lib/time";

// Only Today is in the first download: it is where people land. Every other page loads when opened
// (handbook §5.4; before/after sizes in docs/performance.md).
const auth = () => import("./features/auth/AuthPages");
const LoginPage = lazy(() => auth().then((m) => ({ default: m.LoginPage })));
const VerifyPage = lazy(() => auth().then((m) => ({ default: m.VerifyPage })));
const RegisterPage = lazy(() => auth().then((m) => ({ default: m.RegisterPage })));
const ForgotPasswordPage = lazy(() => auth().then((m) => ({ default: m.ForgotPasswordPage })));
const ResetPasswordPage = lazy(() => auth().then((m) => ({ default: m.ResetPasswordPage })));
const ConfirmEmailPage = lazy(() => auth().then((m) => ({ default: m.ConfirmEmailPage })));
const MfaRecoveryLinkPage = lazy(() => auth().then((m) => ({ default: m.MfaRecoveryLinkPage })));
const PlannerPage = lazy(() => import("./features/planner/PlannerPage").then((m) => ({ default: m.PlannerPage })));
const BacklogPage = lazy(() => import("./features/backlog/BacklogPage").then((m) => ({ default: m.BacklogPage })));
const WeekPage = lazy(() => import("./features/week/WeekPage").then((m) => ({ default: m.WeekPage })));
// Settings carries the QR-code generator; load it only when someone opens that page.
const SettingsPage = lazy(() => import("./features/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
// Visited rarely, so not part of the first download (handbook §5.4).
const GuidePage = lazy(() => import("./features/guide/GuidePage").then((m) => ({ default: m.GuidePage })));
const RoutinesPage = lazy(() => import("./features/routines/RoutinesPage").then((m) => ({ default: m.RoutinesPage })));
const ReviewPage = lazy(() => import("./features/review/ReviewPage").then((m) => ({ default: m.ReviewPage })));

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
          <Route
            path="/login"
            element={
              <Suspense fallback={null}>
                <LoginPage />
              </Suspense>
            }
          />
          <Route
            path="/login/verify"
            element={
              <Suspense fallback={null}>
                <VerifyPage />
              </Suspense>
            }
          />
          <Route
            path="/register"
            element={
              <Suspense fallback={null}>
                <RegisterPage />
              </Suspense>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <Suspense fallback={null}>
                <ForgotPasswordPage />
              </Suspense>
            }
          />
          <Route
            path="/reset-password"
            element={
              <Suspense fallback={null}>
                <ResetPasswordPage />
              </Suspense>
            }
          />
        </Route>
        {/* Reachable signed in or out: the link may be opened in a browser that already has a session. */}
        <Route
          path="/confirm-email"
          element={
            <Suspense fallback={null}>
              <ConfirmEmailPage />
            </Suspense>
          }
        />
        <Route
          path="/mfa-recovery"
          element={
            <Suspense fallback={null}>
              <MfaRecoveryLinkPage />
            </Suspense>
          }
        />
        <Route element={<RequireAuth />}>
          <Route index element={<TodayPage />} />
          <Route
            path="/week"
            element={
              <Suspense fallback={null}>
                <WeekPage />
              </Suspense>
            }
          />
          <Route
            path="/planner"
            element={
              <Suspense fallback={null}>
                <PlannerPage />
              </Suspense>
            }
          />
          <Route
            path="/backlog"
            element={
              <Suspense fallback={null}>
                <BacklogPage />
              </Suspense>
            }
          />
          <Route
            path="/routines"
            element={
              <Suspense fallback={null}>
                <RoutinesPage />
              </Suspense>
            }
          />
          <Route
            path="/review"
            element={
              <Suspense fallback={null}>
                <ReviewPage />
              </Suspense>
            }
          />
          <Route
            path="/guide"
            element={
              <Suspense fallback={null}>
                <GuidePage />
              </Suspense>
            }
          />
          <Route
            path="/settings"
            element={
              <Suspense fallback={null}>
                <SettingsPage />
              </Suspense>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </ErrorBoundary>
  );
}
