import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Download, KeyRound, Link2, Plus, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useToast } from "../../components/toast";
import { Button, ConfirmDialog, cx, Dialog, ErrorNote, Field, IconButton, Input, PageHeader, Segmented, Skeleton } from "../../components/ui";
import { api, ApiError, errorMessage, type Area, type AreaColor, type User } from "../../lib/api";
import { useDocumentTitle, useTheme } from "../../lib/hooks";
import { AREA_COLORS, colorLabel } from "../../lib/labels";
import { useAreaMutations, useAreas, useProviders, useUser } from "../../lib/queries";

export function SettingsPage() {
  useDocumentTitle("Settings");
  const user = useUser();
  return (
    <>
      <PageHeader eyebrow="Your personal system" title="Settings" />
      <div className="settings">
        <ProfileCard user={user} />
        <AreasCard />
        <SecurityCard user={user} />
        <AppearanceCard />
        <DangerCard user={user} />
      </div>
    </>
  );
}

function useRefreshUser() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ["me"] });
}

// ---- Profile ---------------------------------------------------------------------------------

function ProfileCard({ user }: { user: User }) {
  const toast = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState(user.displayName);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      qc.setQueryData(["me"], await api<User>("/auth/profile", { method: "PUT", body: { displayName: name } }));
      toast.success("Profile saved");
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card" aria-labelledby="profile">
      <header className="card-head"><div><h2 id="profile">Profile</h2></div></header>
      <form className="form settings-form" onSubmit={submit}>
        <Field label="Name">{(p) => <Input {...p} required maxLength={80} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Email" hint="Your sign-in address.">{(p) => <Input {...p} value={user.email} readOnly />}</Field>
        <div><Button type="submit" variant="primary" loading={busy} disabled={!name.trim() || name.trim() === user.displayName}>Save profile</Button></div>
      </form>
    </section>
  );
}

// ---- Focus areas -----------------------------------------------------------------------------

function ColorPicker({ value, onChange, label }: { value: AreaColor; onChange: (c: AreaColor) => void; label: string }) {
  return (
    <div className="swatches" role="radiogroup" aria-label={label}>
      {AREA_COLORS.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={c === value} aria-label={colorLabel[c]} title={colorLabel[c]} className="swatch" data-area={c} onClick={() => onChange(c)}>
          {c === value && <Check size={12} strokeWidth={3.5} aria-hidden />}
        </button>
      ))}
    </div>
  );
}

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
          <p>The parts of your life you plan time for. They colour your blocks and group your week.</p>
        </div>
      </header>
      {areas.isPending ? <Skeleton height={200} radius={10} /> : (
        <ul className="area-list">
          <AnimatePresence initial={false}>
            {(areas.data ?? []).map((a) => (
              <motion.li key={a.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }}>
                <AreaRow area={a} onDelete={() => setDeleting(a)} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
      <form className="area-add" onSubmit={add}>
        <Field label="New focus area" error={error ?? undefined}>{(p) => <Input {...p} maxLength={60} placeholder="e.g. Learning / Reading" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <ColorPicker value={color} onChange={setColor} label="Colour for the new area" />
        <Button type="submit" icon={<Plus size={16} aria-hidden />} loading={create.isPending} disabled={!name.trim()}>Add area</Button>
      </form>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.name}”?`}
        body="Blocks, tasks and outcomes in this area are kept, but will no longer belong to a focus area."
        confirmLabel="Delete area"
        loading={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null), onError: (e) => toast.error(errorMessage(e)) })}
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
    const body = { id: area.id, name: (next.name ?? area.name).trim(), color: next.color ?? area.color };
    if (!body.name) return setName(area.name);
    if (body.name === area.name && body.color === area.color) return;
    update.mutate(body, { onError: (e) => { setName(area.name); toast.error(errorMessage(e)); } });
  };
  return (
    <div className="area-row" data-area={area.color}>
      <button type="button" className="swatch" data-area={area.color} aria-label={`Colour: ${colorLabel[area.color]}. Change colour of ${area.name}`} aria-expanded={picking} onClick={() => setPicking(!picking)} />
      <input className="cell-input" aria-label={`Name of ${area.name}`} maxLength={60} value={name} onChange={(e) => setName(e.target.value)} onBlur={() => save({ name })} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <IconButton size="sm" label={`Delete ${area.name}`} onClick={onDelete}><Trash2 size={15} /></IconButton>
      {picking && (
        <motion.div className="area-row-picker" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }}>
          <ColorPicker value={area.color} label={`Colour for ${area.name}`} onChange={(c) => { save({ color: c }); setPicking(false); }} />
        </motion.div>
      )}
    </div>
  );
}

// ---- Security --------------------------------------------------------------------------------

function SecurityCard({ user }: { user: User }) {
  const [dialog, setDialog] = useState<"password" | "enable" | "disable" | "codes" | null>(null);
  const providers = useProviders();
  return (
    <section className="card" aria-labelledby="security">
      <header className="card-head"><div><h2 id="security">Sign-in &amp; security</h2></div></header>
      <ul className="sec-list">
        <li>
          <span className="sec-icon"><KeyRound size={18} aria-hidden /></span>
          <div>
            <h3>Password</h3>
            <p>{user.hasPassword ? "You sign in with your email and a password." : "No password set — you sign in with another account. Add one to also sign in by email."}</p>
          </div>
          <Button onClick={() => setDialog("password")}>{user.hasPassword ? "Change password" : "Set a password"}</Button>
        </li>
        <li>
          <span className={cx("sec-icon", user.mfaEnabled && "is-on")}>{user.mfaEnabled ? <ShieldCheck size={18} aria-hidden /> : <ShieldOff size={18} aria-hidden />}</span>
          <div>
            <h3>Two-step verification <span className={cx("badge", user.mfaEnabled ? "badge-good" : "badge-neutral")}>{user.mfaEnabled ? "On" : "Off"}</span></h3>
            <p>
              {user.mfaEnabled
                ? `A code from your authenticator app is required at sign-in. ${user.recoveryCodesLeft} recovery code${user.recoveryCodesLeft === 1 ? "" : "s"} left.`
                : "Ask for a code from an authenticator app whenever you sign in. Strongly recommended."}
            </p>
          </div>
          {user.mfaEnabled ? (
            <div className="sec-actions">
              <Button onClick={() => setDialog("codes")}>New recovery codes</Button>
              <Button variant="ghost" className="danger-text" onClick={() => setDialog("disable")}>Turn off</Button>
            </div>
          ) : (
            <Button variant="primary" onClick={() => setDialog("enable")}>Turn on</Button>
          )}
        </li>
        {([["google", "Google", user.googleLinked], ["microsoft", "Microsoft", user.microsoftLinked]] as const)
          .filter(([key, , linked]) => linked || providers.data?.[key])
          .map(([key, name, linked]) => (
            <li key={key}>
              <span className={cx("sec-icon", linked && "is-on")}><Link2 size={18} aria-hidden /></span>
              <div>
                <h3>{name} <span className={cx("badge", linked ? "badge-good" : "badge-neutral")}>{linked ? "Connected" : "Not connected"}</span></h3>
                <p>{linked ? `You can sign in with your ${name} account.` : key === "google" ? `Choose “Continue with Google” at sign-in using ${user.email} to connect it.` : `Not connected. For your safety a ${name} account can only start a new manageBagle account, not attach to this one.`}</p>
              </div>
            </li>
          ))}
      </ul>

      <Dialog open={dialog === "password"} onClose={() => setDialog(null)} title={user.hasPassword ? "Change password" : "Set a password"} width="sm">
        <PasswordForm user={user} onClose={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "enable"} onClose={() => setDialog(null)} title="Turn on two-step verification">
        <EnableMfa onClose={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "disable"} onClose={() => setDialog(null)} title="Turn off two-step verification?" description="Your account will be protected by your password alone." width="sm">
        <ConfirmIdentity user={user} action="/auth/mfa/disable" submitLabel="Turn off" danger onDone={() => setDialog(null)} />
      </Dialog>
      <Dialog open={dialog === "codes"} onClose={() => setDialog(null)} title="New recovery codes" description="This replaces your existing codes. The old ones stop working.">
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
      await api("/auth/password", { method: "POST", body: { currentPassword: user.hasPassword ? currentPassword : null, newPassword } });
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
            {(p) => <Input {...p} type="password" autoComplete="current-password" autoFocus required value={currentPassword} onChange={(e) => setCurrent(e.target.value)} />}
          </Field>
        )}
        <Field label="New password" hint="At least 10 characters." error={wrongCurrent ? undefined : message}>
          {(p) => <Input {...p} type="password" autoComplete="new-password" required minLength={10} value={newPassword} onChange={(e) => setNew(e.target.value)} />}
        </Field>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={newPassword.length < 10}>Save password</Button>
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
    const url = URL.createObjectURL(new Blob([`manageBagle recovery codes\nEach code works once.\n\n${text}\n`], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "managebagle-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <>
      <div className="dialog-body form">
        <div className="notice notice-warn" role="status">
          <p><strong>Save these recovery codes now.</strong> They are the only way in if you lose your phone, and we will not show them again.</p>
        </div>
        <ul className="codes" aria-label="Recovery codes">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
        <div className="codes-actions">
          <Button icon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
          <Button icon={<Download size={16} aria-hidden />} onClick={download}>Download</Button>
        </div>
      </div>
      <footer className="dialog-foot"><Button variant="primary" onClick={onDone}>I have saved them</Button></footer>
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
    api<{ sharedKey: string; otpauthUri: string }>("/auth/mfa/setup").then((s) => live && setSetup(s)).catch((e) => live && setError(errorMessage(e)));
    return () => { live = false; };
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
              {setup ? <QRCodeSVG value={setup.otpauthUri} size={168} marginSize={2} bgColor="#ffffff" fgColor="#1b1c20" title="QR code to add manageBagle to your authenticator app" /> : <Skeleton height={168} width={168} radius={8} />}
              <div>
                <span className="field-label">Can’t scan? Enter this key</span>
                <code className="mfa-key">{setup ? setup.sharedKey.replace(/(.{4})/g, "$1 ").trim() : "…"}</code>
              </div>
            </div>
          </li>
          <li>
            <h3>Enter the 6-digit code it shows</h3>
            <Field label="Authentication code">
              {(p) => <Input {...p} className="input-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} placeholder="000 000" required value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} />}
            </Field>
          </li>
        </ol>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={busy} disabled={!setup || code.replace(/\s/g, "").length !== 6}>Verify and turn on</Button>
      </footer>
    </form>
  );
}

/** Asks for the password (or an authenticator code) before a sensitive action. */
function ConfirmIdentity<T = void>({ user, action, submitLabel, danger, onDone, onResult }: { user: User; action: string; submitLabel: string; danger?: boolean; onDone?: () => void; onResult?: (r: T) => void }) {
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
      const result = await api<T>(action, { method: "POST", body: mode === "password" ? { password: value } : { code: value } });
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
        {mode === "password" && <Field label="Confirm with your password">{(p) => <Input {...p} type="password" autoComplete="current-password" autoFocus required value={value} onChange={(e) => setValue(e.target.value)} />}</Field>}
        {mode === "code" && <Field label="Confirm with an authenticator code">{(p) => <Input {...p} className="input-code" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={value} onChange={(e) => setValue(e.target.value)} />}</Field>}
      </div>
      <footer className="dialog-foot">
        <Button type="submit" variant={danger ? "danger" : "primary"} loading={busy} disabled={mode !== "none" && !value}>{submitLabel}</Button>
      </footer>
    </form>
  );
}

function RegenerateCodes({ user, onClose }: { user: User; onClose: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  if (codes) return <RecoveryCodes codes={codes} onDone={onClose} />;
  return <ConfirmIdentity<{ recoveryCodes: string[] }> user={user} action="/auth/mfa/recovery-codes" submitLabel="Generate new codes" onResult={(r) => setCodes(r.recoveryCodes)} />;
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
        <Segmented label="Theme" value={theme} onChange={setTheme} options={[{ value: "light", label: "Light" }, { value: "dark", label: "Dark" }]} />
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
        <Button variant="danger" onClick={() => setOpen(true)}>Delete account</Button>
      </header>
      <Dialog open={open} onClose={() => setOpen(false)} title="Delete your account?" description="Everything you have planned and logged will be erased immediately." width="sm">
        <ConfirmIdentity user={user} action="/auth/account/delete" submitLabel="Delete everything" danger onDone={() => { qc.clear(); qc.setQueryData(["me"], null); navigate("/login", { replace: true }); }} />
      </Dialog>
    </section>
  );
}
