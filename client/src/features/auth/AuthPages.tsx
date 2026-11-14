import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, MailCheck, ShieldCheck } from "lucide-react";
import { motion } from "motion/react";
import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { Button, ErrorNote, Field, Input, Logo } from "../../components/ui";
import { api, ApiError, errorMessage, type ProviderKey } from "../../lib/api";
import { useDocumentTitle } from "../../lib/hooks";
import { useProviders } from "../../lib/queries";

const safeNext = (next: string | null) => (next && next.startsWith("/") && !next.startsWith("//") ? next : "/");

const URL_ERRORS: Record<string, string> = {
  external_failed: "That sign-in did not complete. Try again.",
  external_unverified: "That account's email address is not verified, so we cannot use it to sign you in.",
  external_no_email: "That account did not share an email address, so we cannot sign you in with it.",
  external_account_exists: "An account with that email already exists. Sign in the way you usually do.",
  locked: "Too many attempts. Try again in a few minutes.",
};

/** A day drawn as a dial: the brand's ring, filled with the kinds of blocks the app plans. */
function DayDial() {
  const segments = [
    { from: 7, to: 8, area: "green" },
    { from: 9, to: 11.5, area: "teal" },
    { from: 12, to: 12.75, area: "slate" },
    { from: 13.5, to: 15, area: "blue" },
    { from: 15.5, to: 16.5, area: "violet" },
    { from: 18, to: 19, area: "rose" },
    { from: 20, to: 21.5, area: "amber" },
  ];
  const r = 120;
  const c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 320 320" className="dial" role="img" aria-label="A day planned as seven time blocks around a 24-hour dial">
      <circle cx="160" cy="160" r={r} className="dial-track" />
      {segments.map((s, i) => {
        const length = ((s.to - s.from) / 24) * c;
        return (
          <motion.circle
            key={s.from}
            cx="160"
            cy="160"
            r={r}
            className="dial-seg"
            data-area={s.area}
            strokeDasharray={`${length - 4} ${c}`}
            transform={`rotate(${(s.from / 24) * 360 - 90} 160 160)`}
            initial={{ strokeDashoffset: length, opacity: 0 }}
            animate={{ strokeDashoffset: 0, opacity: 1 }}
            transition={{ delay: 0.25 + i * 0.09, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          />
        );
      })}
      {[0, 6, 12, 18].map((h) => {
        const a = ((h / 24) * 360 - 90) * (Math.PI / 180);
        return (
          <text key={h} x={160 + Math.cos(a) * 84} y={160 + Math.sin(a) * 84} className="dial-hour" textAnchor="middle" dominantBaseline="central">
            {String(h).padStart(2, "0")}
          </text>
        );
      })}
      <text x="160" y="152" className="dial-num" textAnchor="middle">
        7.5h
      </text>
      <text x="160" y="178" className="dial-cap" textAnchor="middle">
        planned on purpose
      </text>
    </svg>
  );
}

function AuthLayout({ title, lead, children, footer }: { title: string; lead: string; children: ReactNode; footer?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="auth">
      <main className="auth-main">
        <div className="auth-card">
          <Logo size={32} />
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
            <h1>{title}</h1>
            <p className="auth-lead">{lead}</p>
            {children}
          </motion.div>
          {footer && <p className="auth-foot">{footer}</p>}
        </div>
      </main>
      <aside className="auth-aside" aria-hidden={false}>
        <DayDial />
        <blockquote>
          <p>Schedule the result, not just the topic.</p>
          <footer>“Draft 400 words” is a better block than “work on content”.</footer>
        </blockquote>
      </aside>
    </div>
  );
}

const PROVIDERS: { key: ProviderKey; name: string; logo: ReactNode }[] = [
  {
    key: "google",
    name: "Google",
    logo: (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
      </svg>
    ),
  },
  {
    key: "microsoft",
    name: "Microsoft",
    logo: (
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <path fill="#F25022" d="M1 1h7.5v7.5H1z" />
        <path fill="#7FBA00" d="M9.5 1H17v7.5H9.5z" />
        <path fill="#00A4EF" d="M1 9.5h7.5V17H1z" />
        <path fill="#FFB900" d="M9.5 9.5H17V17H9.5z" />
      </svg>
    ),
  },
];

/** One button per sign-in provider the server has credentials for; nothing at all when there are none. */
function ProviderButtons({ next, verb }: { next: string; verb: string }) {
  const providers = useProviders();
  const enabled = PROVIDERS.filter((p) => providers.data?.[p.key]);
  if (enabled.length === 0) return null;
  return (
    <>
      <div className="provider-buttons">
        {enabled.map((p) => (
          <a key={p.key} className="btn btn-secondary btn-lg btn-block" href={`/api/auth/external/${p.key}?returnUrl=${encodeURIComponent(next)}`}>
            {p.logo}
            {verb} with {p.name}
          </a>
        ))}
      </div>
      <div className="auth-divider">
        <span>or with email</span>
      </div>
    </>
  );
}

export function LoginPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [error, setError] = useState<string | null>(URL_ERRORS[params.get("error") ?? ""] ?? null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ status: "ok" | "mfaRequired" }>("/auth/login", { method: "POST", body: { email, password, rememberMe } });
      if (result.status === "mfaRequired") {
        navigate(`/login/verify?next=${encodeURIComponent(next)}`);
      } else {
        await qc.invalidateQueries({ queryKey: ["me"] });
        navigate(next, { replace: true });
      }
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Welcome back" lead="Sign in to pick up your day where you left it." footer={<>New here? <Link to="/register">Create an account</Link></>}>
      <ProviderButtons next={next} verb="Continue" />
      <form onSubmit={submit} className="form" noValidate>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Password">{(p) => <Input {...p} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        <div className="form-row-between">
          <label className="check">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> Keep me signed in
          </label>
          <Link to="/forgot-password">Forgot password?</Link>
        </div>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  );
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [code, setCode] = useState("");
  const [rememberDevice, setRememberDevice] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/login/mfa", { method: "POST", body: { code, useRecoveryCode, rememberDevice } });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate(next, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.code === "mfa_session_expired") {
        navigate("/login", { replace: true });
        return;
      }
      setError(errorMessage(err));
      setCode("");
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Two-step verification"
      lead={useRecoveryCode ? "Enter one of the recovery codes you saved when you turned this on. Each code works once." : "Enter the 6-digit code from your authenticator app."}
      footer={<Link to="/login"><ArrowLeft size={14} aria-hidden /> Back to sign in</Link>}
    >
      <form onSubmit={submit} className="form" noValidate>
        {error && <ErrorNote>{error}</ErrorNote>}
        {useRecoveryCode ? (
          <Field label="Recovery code">{(p) => <Input {...p} key="recovery" className="input-code" autoComplete="off" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} placeholder="XXXXX-XXXXX" />}</Field>
        ) : (
          <Field label="Authentication code">
            {(p) => <Input {...p} key="totp" className="input-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]*" maxLength={7} autoFocus required value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} placeholder="000 000" />}
          </Field>
        )}
        {!useRecoveryCode && (
          <label className="check">
            <input type="checkbox" checked={rememberDevice} onChange={(e) => setRememberDevice(e.target.checked)} /> Don’t ask again on this device
          </label>
        )}
        <Button type="submit" variant="primary" size="lg" block loading={busy} icon={<ShieldCheck size={18} aria-hidden />}>
          Verify
        </Button>
        <button type="button" className="link-btn" onClick={() => { setUseRecoveryCode(!useRecoveryCode); setCode(""); setError(null); }}>
          {useRecoveryCode ? "Use my authenticator app instead" : "Lost your phone? Use a recovery code"}
        </button>
      </form>
    </AuthLayout>
  );
}

export function RegisterPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ displayName: "", email: "", password: "" });
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/register", { method: "POST", body: form });
      await qc.invalidateQueries({ queryKey: ["me"] });
      navigate("/guide?welcome=1", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
      setBusy(false);
    }
  };

  const hasFieldErrors = error && Object.keys(error.fieldErrors).length > 0;
  return (
    <AuthLayout title="Own your time" lead="Ten minutes to plan, five to review. Create your account to start." footer={<>Already have an account? <Link to="/login">Sign in</Link></>}>
      <ProviderButtons next="/guide?welcome=1" verb="Sign up" />
      <form onSubmit={submit} className="form" noValidate>
        {error && !hasFieldErrors && <ErrorNote>{error.message}</ErrorNote>}
        {error?.field("form") && <ErrorNote>{error.field("form")}</ErrorNote>}
        <Field label="Your name" error={error?.field("displayName")}>{(p) => <Input {...p} autoComplete="name" required autoFocus maxLength={80} value={form.displayName} onChange={set("displayName")} />}</Field>
        <Field label="Email" error={error?.field("email")}>{(p) => <Input {...p} type="email" autoComplete="username" required value={form.email} onChange={set("email")} />}</Field>
        <Field label="Password" hint="At least 10 characters. A short sentence works well." error={error?.field("password")}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" required minLength={10} value={form.password} onChange={set("password")} />}
        </Field>
        <Button type="submit" variant="primary" size="lg" block loading={busy}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password/forgot", { method: "POST", body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Reset your password" lead="Tell us your email and we will send you a link to choose a new one." footer={<Link to="/login"><ArrowLeft size={14} aria-hidden /> Back to sign in</Link>}>
      {sent ? (
        <div className="notice" role="status">
          <MailCheck size={20} aria-hidden />
          <p>
            If an account exists for <strong>{email}</strong>, a reset link is on its way. It expires in 2 hours.
          </p>
        </div>
      ) : (
        <form onSubmit={submit} className="form" noValidate>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Field label="Email">{(p) => <Input {...p} type="email" autoComplete="username" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const email = params.get("email") ?? "";
  const token = params.get("token") ?? "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password/reset", { method: "POST", body: { email, token, newPassword } });
      navigate("/login", { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
      setBusy(false);
    }
  };

  const linkBroken = !email || !token;
  return (
    <AuthLayout title="Choose a new password" lead={linkBroken ? "This reset link is incomplete." : `For ${email}`} footer={<Link to="/login"><ArrowLeft size={14} aria-hidden /> Back to sign in</Link>}>
      {linkBroken ? (
        <ErrorNote>Open the link from your email again, or <Link to="/forgot-password">request a new one</Link>.</ErrorNote>
      ) : (
        <form onSubmit={submit} className="form" noValidate>
          {error && !error.field("password") && <ErrorNote>{error.message}</ErrorNote>}
          <Field label="New password" hint="At least 10 characters." error={error?.field("password")}>
            {(p) => <Input {...p} type="password" autoComplete="new-password" required minLength={10} autoFocus value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />}
          </Field>
          <Button type="submit" variant="primary" size="lg" block loading={busy}>
            Save and sign in
          </Button>
        </form>
      )}
    </AuthLayout>
  );
}
