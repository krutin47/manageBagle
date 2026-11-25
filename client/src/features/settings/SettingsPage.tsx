import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, KeyRound, Link2, Plus, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ColorPicker } from "../../components/ColorPicker";
import { useToast } from "../../components/toast";
import {
  Button,
  ConfirmDialog,
  cx,
  Dialog,
  ErrorNote,
  Field,
  IconButton,
  Input,
  PageHeader,
  Segmented,
  Select,
  Skeleton,
} from "../../components/ui";
import { api, ApiError, errorMessage, type Area, type AreaColor, type User } from "../../lib/api";
import { useDocumentTitle, useTheme } from "../../lib/hooks";
import { colorLabel } from "../../lib/labels";
import { CalendarsCard } from "./CalendarsCard";
import { keys, useAreaMutations, useAreas, useProviders, useUser } from "../../lib/queries";
import { browserTimeZone } from "../../lib/time";

export function SettingsPage() {
  useDocumentTitle("Settings");
  const user = useUser();
  return (
    <>
      <PageHeader eyebrow="Your personal system" title="Settings" />
      <div className="settings">
        <ProfileCard user={user} />
        <CalendarsCard />
        <AreasCard />
        <SecurityCard user={user} />
        <ActivityCard />
        <AppearanceCard />
        <DataCard />
        <DangerCard user={user} />
      </div>
    </>
  );
}

function useRefreshUser() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: keys.me });
}

// ---- Profile ---------------------------------------------------------------------------------

function ProfileCard({ user }: { user: User }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(user.displayName);
  const [zone, setZone] = useState(user.timeZone ?? browserTimeZone());
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    const all = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
    return [...new Set([zone, browserTimeZone(), ...all])].sort();
  }, [zone]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      qc.setQueryData(
        keys.me,
        await api<User>("/auth/profile", { method: "PUT", body: { displayName: name, timeZone: zone } }),
      );
      qc.invalidateQueries({ queryKey: keys.blocks.all });
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="profile">
      <header className="card-head">
        <div>
          <h2 id="profile">Profile</h2>
        </div>
      </header>
      <form className="form settings-form" onSubmit={submit}>
        <Field label="Name">
          {(p) => (
            <Input
              {...p}
              required
              maxLength={80}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <Field label="Email" hint="Your sign-in address.">
          {(p) => <Input {...p} value={user.email} readOnly />}
        </Field>
        <Field
          label="Time zone"
          hint="Decides what “today” and “now” mean. Blocks you have already planned stay anchored to the zone they were planned in."
        >
          {(p) => (
            <Select {...p} value={zone} onChange={(e) => setZone(e.target.value)}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={!name.trim() || (name.trim() === user.displayName && zone === user.timeZone)}
          >
            Save profile
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---- Focus areas -----------------------------------------------------------------------------

function AreasCard() {
  const toast = useToast();
  const areas = useAreas();
  const { create, remove } = useAreaMutations();
  const [name, setName] = useState("");
  const [color, setColor] = useState<AreaColor>("teal");
  const [deleting, setDeleting] = useState<Area | null>(null);
  const [error, setError] = useState<string | null>(null);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await create.mutateAsync({ name, color });
      setName("");
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card" aria-labelledby="areas">
      <header className="card-head">
        <div>
          <h2 id="areas">Focus areas</h2>
          <p>
            The parts of your life you plan time for. They colour your blocks and group your week. Recovery breaks per
            area are set on the <Link to="/routines">Routines</Link> page.
          </p>
        </div>
      </header>
      {areas.isPending ? (
        <Skeleton height={200} radius={10} />
      ) : (
        <ul className="area-list">
          <AnimatePresence initial={false}>
            {(areas.data ?? []).map((a) => (
              <motion.li
                key={a.id}
                layout="position"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, height: 0 }}
              >
                <AreaRow area={a} onDelete={() => setDeleting(a)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <form className="area-add" onSubmit={add}>
        <Field label="New focus area" error={error ?? undefined}>
          {(p) => (
            <Input
              {...p}
              maxLength={60}
              placeholder="e.g. Learning / Reading"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          )}
        </Field>
        <ColorPicker value={color} onChange={setColor} label="Colour for the new area" />
        <Button type="submit" icon={<Plus size={16} aria-hidden />} loading={create.isPending} disabled={!name.trim()}>
          Add area
        </Button>
      </form>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        body="Blocks, tasks and outcomes in this area are kept, but will no longer belong to a focus area."
        confirmLabel="Delete area"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </section>
  );
}

function AreaRow({ area, onDelete }: { area: Area; onDelete: () => void }) {
  const toast = useToast();
  const { update } = useAreaMutations();
  const [name, setName] = useState(area.name);
  const [picking, setPicking] = useState(false);
  const save = (next: { name?: string; color?: AreaColor }) => {
    const body = {
      id: area.id,
      name: (next.name ?? area.name).trim(),
      color: next.color ?? area.color,
      breakMinutes: area.breakMinutes,
      breakPlacement: area.breakPlacement,
    };
    if (!body.name) return setName(area.name);
    if (body.name === area.name && body.color === area.color) return;
    update.mutate(body, {
      onError: (e) => {
        setName(area.name);
        toast.error(errorMessage(e));
      },
    });
  };
  return (
    <div className="area-row" data-area={area.color}>
      <button
        type="button"
        className="swatch"
        data-area={area.color}
        aria-label={`Colour: ${colorLabel[area.color]}. Change colour of ${area.name}`}
        aria-expanded={picking}
        onClick={() => setPicking(!picking)}
      />
      <input
        className="cell-input"
        aria-label={`Name of ${area.name}`}
        maxLength={60}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => save({ name })}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
      <IconButton size="sm" label={`Delete ${area.name}`} onClick={onDelete}>
        <Trash2 size={15} />
      </IconButton>
      {picking && (
        <motion.div
          className="area-row-picker"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
        >
          <ColorPicker
            value={area.color}
            label={`Colour for ${area.name}`}
            onChange={(c) => {
              save({ color: c });
              setPicking(false);
            }}
          />
        </motion.div>
      )}
    </div>
  );
}

const PROVIDER_ROWS = [
  { key: "google", name: "Google", flag: "googleLinked" },
  { key: "microsoft", name: "Microsoft", flag: "microsoftLinked" },
] as const;

const LINK_ERRORS: Record<string, string> = {
  link_expired: "That took too long, so nothing was connected. Start again.",
  link_in_use: "That account is already connected to a different manageBagle account.",
  link_failed: "That account could not be connected.",
};

// ---- Security --------------------------------------------------------------------------------

function SecurityCard({ user }: { user: User }) {
  const [dialog, setDialog] = useState<"password" | "enable" | "disable" | "codes" | null>(null);
  const providers = useProviders();
  const [linking, setLinking] = useState<((typeof PROVIDER_ROWS)[number] & { mode: "link" | "unlink" }) | null>(null);
  const [params, setParams] = useSearchParams();
  const toast = useToast();

  // The provider round trip lands back here with its result in the address.
  useEffect(() => {
    const linked = params.get("linked");
    const error = params.get("error");
    if (!linked && !error) return;
    if (linked) toast.success(`${PROVIDER_ROWS.find((p) => p.key === linked)?.name ?? "Account"} connected`);
    else toast.error(LINK_ERRORS[error!] ?? "That account could not be connected.");
    setParams({}, { replace: true });
  }, [params, setParams, toast]);
  return (
    <section className="card" aria-labelledby="security">
      <header className="card-head">
        <div>
          <h2 id="security">Sign-in &amp; security</h2>
        </div>
      </header>
      <ul className="sec-list">
        <li>
          <span className="sec-icon">
            <KeyRound size={18} aria-hidden />
          </span>
          <div>
            <h3>Password</h3>
            <p>
              {user.hasPassword
                ? "You sign in with your email and a password."
                : "No password set — you sign in with another account. Add one to also sign in by email."}
            </p>
          </div>
          <Button onClick={() => setDialog("password")}>
            {user.hasPassword ? "Change password" : "Set a password"}
          </Button>
        </li>
        <li>
          <span className={cx("sec-icon", user.mfaEnabled && "is-on")}>
            {user.mfaEnabled ? <ShieldCheck size={18} aria-hidden /> : <ShieldOff size={18} aria-hidden />}
          </span>
          <div>
            <h3>
              Two-step verification{" "}
              <span className={cx("badge", user.mfaEnabled ? "badge-good" : "badge-neutral")}>
                {user.mfaEnabled ? "On" : "Off"}
              </span>
            </h3>
            <p>
              {user.mfaEnabled
                ? `A code from your authenticator app is required at sign-in. ${user.recoveryCodesLeft} recovery code${user.recoveryCodesLeft === 1 ? "" : "s"} left.`
                : "Ask for a code from an authenticator app whenever you sign in. Strongly recommended."}
            </p>
          </div>
          {user.mfaEnabled ? (
            <div className="sec-actions">
              <Button onClick={() => setDialog("codes")}>New recovery codes</Button>
              <Button variant="ghost" className="danger-text" onClick={() => setDialog("disable")}>
                Turn off
              </Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setDialog("enable")}>
              Turn on
            </Button>
          )}
        </li>
        {PROVIDER_ROWS.filter((p) => user[p.flag] || providers.data?.[p.key]).map((p) => {
          const linked = user[p.flag];
          return (
            <li key={p.key}>
              <span className={cx("sec-icon", linked && "is-on")}>
                <Link2 size={18} aria-hidden />
              </span>
              <div>
                <h3>
                  {p.name}{" "}
                  <span className={cx("badge", linked ? "badge-good" : "badge-neutral")}>
                    {linked ? "Connected" : "Not connected"}
                  </span>
                </h3>
                <p>
                  {linked
                    ? `You can sign in with your ${p.name} account.`
                    : `Connect your ${p.name} account to sign in with it. We will ask you to confirm it is you first.`}
                </p>
              </div>
              {linked ? (
                <Button variant="ghost" className="danger-text" onClick={() => setLinking({ ...p, mode: "unlink" })}>
                  Disconnect
                </Button>
              ) : (
                <Button onClick={() => setLinking({ ...p, mode: "link" })}>Connect</Button>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog
        open={!!linking}
        onClose={() => setLinking(null)}
        width="sm"
        title={linking?.mode === "unlink" ? `Disconnect ${linking.name}?` : `Connect ${linking?.name ?? ""}`}
        description={
          linking?.mode === "unlink"
            ? `You will no longer be able to sign in with ${linking.name}.`
            : "Confirm it is you, then choose the account to connect."
        }
      >
        {linking &&
          (user.hasPassword || user.mfaEnabled || linking.mode === "unlink" ? (
            <ConfirmIdentity<{ url?: string }>
              user={user}
              action={`/auth/external/${linking.key}/${linking.mode}`}
              submitLabel={linking.mode === "unlink" ? "Disconnect" : "Continue"}
              danger={linking.mode === "unlink"}
              onResult={(r) => {
                if (r?.url) window.location.assign(r.url);
              }}
              onDone={() => {
                if (linking.mode === "unlink") setLinking(null);
              }}
            />
          ) : (
            <div className="dialog-body">
              <ErrorNote>
                Set a password first, so we can confirm it is you before connecting another account.
              </ErrorNote>
            </div>
          ))}
      </Dialog>
      <Dialog
        open={dialog === "password"}
        onClose={() => setDialog(null)}
        title={user.hasPassword ? "Change password" : "Set a password"}
        width="sm"
      >
        <PasswordForm user={user} onClose={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "enable"} onClose={() => setDialog(null)} title="Turn on two-step verification">
        <EnableMfa onClose={() => setDialog(null)} />
      </Dialog>
      <Dialog
        open={dialog === "disable"}
        onClose={() => setDialog(null)}
        title="Turn off two-step verification?"
        description="Your account will be protected by your password alone."
        width="sm"
      >
        <ConfirmIdentity
          user={user}
          action="/auth/mfa/disable"
          submitLabel="Turn off"
          danger
          onDone={() => setDialog(null)}
        />
      </Dialog>
      <Dialog
        open={dialog === "codes"}
        onClose={() => setDialog(null)}
        title="New recovery codes"
        description="This replaces your existing codes. The old ones stop working."
      >
        <RegenerateCodes user={user} onClose={() => setDialog(null)} />
      </Dialog>
    </section>
  );
}

function PasswordForm({ user, onClose }: { user: User; onClose: () => void }) {
  const toast = useToast();
  const refresh = useRefreshUser();
  const [currentPassword, setCurrent] = useState("");
  const [newPassword, setNew] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/auth/password", {
        method: "POST",
        body: { currentPassword: user.hasPassword ? currentPassword : null, newPassword },
      });
      await refresh();
      toast.success("Password saved");
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
      setBusy(false);
    }
  };

  const message = error?.field("password");
  const wrongCurrent = message?.toLowerCase().includes("incorrect");
  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && !message && <ErrorNote>{error.message}</ErrorNote>}
        {user.hasPassword && (
          <Field label="Current password" error={wrongCurrent ? "That is not your current password." : undefined}>
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={currentPassword}
                onChange={(e) => setCurrent(e.target.value)}
              />
            )}
          </Field>
        )}
        <Field label="New password" hint="At least 10 characters." error={wrongCurrent ? undefined : message}>
          {(p) => (
            <Input
              {...p}
              type="password"
              autoComplete="new-password"
              required
              minLength={10}
              value={newPassword}
              onChange={(e) => setNew(e.target.value)}
            />
          )}
        </Field>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={newPassword.length < 10}>
          Save password
        </Button>
      </footer>
    </form>
  );
}

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      /* clipboard blocked: the codes are still on screen to write down */
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
      new Blob([`manageBagle recovery codes\nEach code works once.\n\n${text}\n`], { type: "text/plain" }),
    );
    const a = Object.assign(document.createElement("a"), { href: url, download: "managebagle-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="dialog-body form">
        <div className="notice notice-warn" role="status">
          <p>
            <strong>Save these recovery codes now.</strong> They are the only way in if you lose your phone, and we will
            not show them again.
          </p>
        </div>
        <ul className="codes" aria-label="Recovery codes">
          {codes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <div className="codes-actions">
          <Button icon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={copy}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button icon={<Download size={16} aria-hidden />} onClick={download}>
            Download
          </Button>
        </div>
      </div>
      <footer className="dialog-foot">
        <Button variant="primary" onClick={onDone}>
          I have saved them
        </Button>
      </footer>
    </>
  );
}

function EnableMfa({ onClose }: { onClose: () => void }) {
  const refresh = useRefreshUser();
  const [setup, setSetup] = useState<{ sharedKey: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    api<{ sharedKey: string; otpauthUri: string }>("/auth/mfa/setup")
      .then((s) => live && setSetup(s))
      .catch((e) => live && setError(errorMessage(e)));
    return () => {
      live = false;
    };
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ recoveryCodes: string[] }>("/auth/mfa/enable", { method: "POST", body: { code } });
      setCodes(result.recoveryCodes);
      await refresh();
    } catch (err) {
      setError(errorMessage(err));
      setCode("");
    } finally {
      setBusy(false);
    }
  };

  if (codes) return <RecoveryCodes codes={codes} onDone={onClose} />;
  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && <ErrorNote>{error}</ErrorNote>}
        <ol className="mfa-steps">
          <li>
            <h3>Scan this code with your authenticator app</h3>
            <p>Google Authenticator, 1Password, Authy and Microsoft Authenticator all work.</p>
            <div className="qr">
              {setup ? (
                <QRCodeSVG
                  value={setup.otpauthUri}
                  size={168}
                  marginSize={2}
                  bgColor="#ffffff"
                  fgColor="#1b1c20"
                  title="QR code to add manageBagle to your authenticator app"
                />
              ) : (
                <Skeleton height={168} width={168} radius={8} />
              )}
              <div>
                <span className="field-label">Can’t scan? Enter this key</span>
                <code className="mfa-key">{setup ? setup.sharedKey.replace(/(.{4})/g, "$1 ").trim() : "…"}</code>
              </div>
            </div>
          </li>
          <li>
            <h3>Enter the 6-digit code it shows</h3>
            <Field label="Authentication code">
              {(p) => (
                <Input
                  {...p}
                  className="input-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={7}
                  placeholder="000 000"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))}
                />
              )}
            </Field>
          </li>
        </ol>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          loading={busy}
          disabled={!setup || code.replace(/\s/g, "").length !== 6}
        >
          Verify and turn on
        </Button>
      </footer>
    </form>
  );
}

/** Asks for the password (or an authenticator code) before a sensitive action. */
function ConfirmIdentity<T = void>({
  user,
  action,
  submitLabel,
  danger,
  onDone,
  onResult,
}: {
  user: User;
  action: string;
  submitLabel: string;
  danger?: boolean;
  onDone?: () => void;
  onResult?: (r: T) => void;
}) {
  const refresh = useRefreshUser();
  const mode = user.hasPassword ? "password" : user.mfaEnabled ? "code" : "none";
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await api<T>(action, {
        method: "POST",
        body: mode === "password" ? { password: value } : { code: value },
      });
      onResult?.(result);
      await refresh();
      onDone?.();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && <ErrorNote>{error}</ErrorNote>}
        {mode === "password" && (
          <Field label="Confirm with your password">
            {(p) => (
              <Input
                {...p}
                type="password"
                autoComplete="current-password"
                autoFocus
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
        )}
        {mode === "code" && (
          <Field label="Confirm with an authenticator code">
            {(p) => (
              <Input
                {...p}
                className="input-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
      <footer className="dialog-foot">
        <Button
          type="submit"
          variant={danger ? "danger" : "primary"}
          loading={busy}
          disabled={mode !== "none" && !value}
        >
          {submitLabel}
        </Button>
      </footer>
    </form>
  );
}

function RegenerateCodes({ user, onClose }: { user: User; onClose: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} onDone={onClose} />;
  return (
    <ConfirmIdentity<{ recoveryCodes: string[] }>
      user={user}
      action="/auth/mfa/recovery-codes"
      submitLabel="Generate new codes"
      onResult={(r) => setCodes(r.recoveryCodes)}
    />
  );
}

// ---- Appearance & account --------------------------------------------------------------------

function AppearanceCard() {
  const [theme, setTheme] = useTheme();
  return (
    <section className="card" aria-labelledby="appearance">
      <header className="card-head">
        <div>
          <h2 id="appearance">Appearance</h2>
          <p>Both themes meet WCAG 2.2 AA contrast.</p>
        </div>
        <Segmented
          label="Theme"
          value={theme}
          onChange={setTheme}
          options={[
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </header>
    </section>
  );
}

const EVENT_LABELS: Record<string, string> = {
  account_created: "Account created",
  email_confirmed: "Email confirmed",
  sign_in: "Signed in with password",
  sign_in_mfa: "Signed in with authenticator",
  sign_in_recovery_code: "Signed in with a recovery code",
  sign_in_needs_mfa: "Password accepted, waiting for second step",
  sign_in_failed: "Failed sign-in attempt",
  sign_in_mfa_failed: "Wrong authenticator code",
  sign_out: "Signed out",
  password_changed: "Password changed",
  password_reset: "Password reset by email",
  mfa_enabled: "Two-step verification turned on",
  mfa_disabled: "Two-step verification turned off",
  mfa_reset_requested: "Recovery requested: lost second factor",
  mfa_reset_confirmed: "Recovery confirmed by email",
  mfa_reset_cancelled: "Recovery cancelled",
  mfa_reset_completed: "Two-step verification turned off by recovery",
  external_login_linked: "Account connected",
  external_login_unlinked: "Account disconnected",
};
const WARNING_EVENTS = new Set([
  "sign_in_failed",
  "sign_in_mfa_failed",
  "mfa_reset_requested",
  "mfa_reset_confirmed",
  "mfa_reset_completed",
  "mfa_disabled",
]);

/** The account's recent security events, so the owner can spot something they did not do. */
function ActivityCard() {
  const activity = useQuery({
    queryKey: ["account-activity"],
    queryFn: ({ signal }) => api<{ event: string; detail: string; at: string }[]>("/auth/activity", { signal }),
    staleTime: 60_000,
  });
  return (
    <section className="card" aria-labelledby="activity">
      <header className="card-head">
        <div>
          <h2 id="activity">Account activity</h2>
          <p>Recent sign-ins and security changes. If you see something you did not do, change your password.</p>
        </div>
      </header>
      {activity.isError ? (
        <ErrorNote onRetry={() => activity.refetch()}>We could not load your account activity.</ErrorNote>
      ) : activity.isPending ? (
        <Skeleton height={120} radius={10} />
      ) : (
        <ul className="activity">
          {activity.data.map((e, i) => (
            <li key={i} className={cx(WARNING_EVENTS.has(e.event) && "is-warning")}>
              <span>
                {EVENT_LABELS[e.event] ?? e.event.replace(/_/g, " ")}
                {e.detail && !e.detail.includes("_") ? ` · ${e.detail[0]!.toUpperCase()}${e.detail.slice(1)}` : ""}
              </span>
              <time dateTime={e.at}>
                {new Date(e.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Handbook §17.3: everything the account holds, as one file. A plain link: the browser downloads it with the session cookie. */
function DataCard() {
  return (
    <section className="card" aria-labelledby="your-data">
      <header className="card-head">
        <div>
          <h2 id="your-data">Your data</h2>
          <p>
            Download everything your account holds — tasks, blocks, top threes, reviews, routines, settings and account
            activity — as one JSON file. Passwords, security keys and private calendar addresses are never included.
          </p>
        </div>
        <a className="btn btn-secondary btn-md" href="/api/account/export" download>
          <Download size={16} aria-hidden /> Download my data
        </a>
      </header>
    </section>
  );
}

function DangerCard({ user }: { user: User }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const navigate = useNavigate();
  return (
    <section className="card card-danger" aria-labelledby="danger">
      <header className="card-head">
        <div>
          <h2 id="danger">Delete account</h2>
          <p>Permanently removes your account and every block, task and review. This cannot be undone.</p>
        </div>
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete account
        </Button>
      </header>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="Delete your account?"
        description="Everything you have planned and logged will be erased immediately."
        width="sm"
      >
        <ConfirmIdentity
          user={user}
          action="/auth/account/delete"
          submitLabel="Delete everything"
          danger
          onDone={() => {
            qc.clear();
            qc.setQueryData(keys.me, null);
            navigate("/login", { replace: true });
          }}
        />
      </Dialog>
    </section>
  );
}
