import { CalendarDays, Check, Copy, Download, ExternalLink, Link2, Plus, RefreshCw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useToast } from "../../components/toast";
import { Button, ConfirmDialog, Dialog, ErrorNote, Field, IconButton, Input, Skeleton } from "../../components/ui";
import { ApiError, errorMessage, type CalendarConnection } from "../../lib/api";
import { useCalendarConnections, useCalendarFeed, useCalendarMutations } from "../../lib/queries";
import { addDays, todayISO } from "../../lib/time";

/** P2-D1 and P2-D2: the plan in other calendars, and other calendars' meetings in the plan. */
export function CalendarsCard() {
  const [showFeed, setShowFeed] = useState(false);
  const feed = useCalendarFeed(showFeed);
  const connections = useCalendarConnections();
  const { regenerateFeed, disconnect, refresh } = useCalendarMutations();
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  const [adding, setAdding] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [removing, setRemoving] = useState<CalendarConnection | null>(null);

  const copy = async () => {
    if (!feed.data) return;
    try {
      await navigator.clipboard.writeText(feed.data.url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Copying was blocked by the browser. Select the link and copy it by hand.");
    }
  };

  const today = todayISO();
  return (
    <section className="card" aria-labelledby="calendars">
      <header className="card-head">
        <div>
          <h2 id="calendars">Calendars</h2>
          <p>See your plan in Google, Apple or Outlook calendar, and plan around the meetings already there.</p>
        </div>
      </header>

      <div className="cal-settings">
        <div>
          <h3><Link2 size={16} aria-hidden /> Show your plan in another calendar</h3>
          <p className="muted">A private link your calendar app subscribes to. It shows block titles and times — never notes. Calendar apps refresh it on their own schedule; Google can take several hours.</p>
          {!showFeed ? (
            <Button onClick={() => setShowFeed(true)}>Get my subscription link</Button>
          ) : feed.isPending ? <Skeleton height={40} radius={8} /> : feed.isError ? <ErrorNote onRetry={() => feed.refetch()}>We could not create the link.</ErrorNote> : (
            <>
              <div className="feed-link">
                <Input readOnly aria-label="Your private calendar subscription link" value={feed.data.url} onFocus={(e) => e.target.select()} />
                <Button icon={copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />} onClick={copy}>{copied ? "Copied" : "Copy"}</Button>
              </div>
              <ul className="feed-help">
                <li><strong>Google Calendar:</strong> Other calendars → + → From URL → paste the link.</li>
                <li><strong>Apple Calendar or Outlook:</strong> <a href={feed.data.webcalUrl}>open the link in your calendar app <ExternalLink size={12} aria-hidden /></a></li>
              </ul>
              <div className="feed-actions">
                <a className="btn btn-secondary btn-sm" href={`/api/calendar/export.ics?from=${today}&to=${addDays(today, 13)}`} download><Download size={15} aria-hidden /> Download the next 2 weeks (.ics)</a>
                <Button size="sm" variant="ghost" onClick={() => setConfirmRegenerate(true)}>Make a new link</Button>
              </div>
            </>
          )}
        </div>

        <div>
          <h3><CalendarDays size={16} aria-hidden /> Plan around your meetings</h3>
          <p className="muted">Connect a calendar by its private iCal address. Its meetings show as busy, and the brain dump plans around them.</p>
          {connections.isPending ? <Skeleton height={48} radius={8} /> : connections.isError ? <ErrorNote onRetry={() => connections.refetch()}>We could not load your calendars.</ErrorNote> : (
            <ul className="connection-list">
              {connections.data.map((c) => (
                <li key={c.id}>
                  <div>
                    <strong>{c.name}</strong>
                    <span className="muted"> · {c.host}</span>
                    <span className={c.lastError ? "connection-status is-error" : "connection-status"}>
                      {c.lastError || `${c.eventCount} meeting${c.eventCount === 1 ? "" : "s"} · read ${c.lastFetchedAt ? new Date(c.lastFetchedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "never"}`}
                    </span>
                  </div>
                  <IconButton size="sm" label={`Remove ${c.name}`} onClick={() => setRemoving(c)}><Trash2 size={15} /></IconButton>
                </li>
              ))}
            </ul>
          )}
          <div className="feed-actions">
            <Button size="sm" icon={<Plus size={15} aria-hidden />} onClick={() => setAdding(true)}>Connect a calendar</Button>
            {!!connections.data?.length && (
              <Button size="sm" variant="ghost" loading={refresh.isPending} icon={<RefreshCw size={15} aria-hidden />}
                onClick={() => refresh.mutate(true, { onSuccess: () => toast.success("Calendars read again"), onError: (e) => toast.error(errorMessage(e)) })}>Read now</Button>
            )}
          </div>
        </div>
      </div>

      <Dialog open={adding} onClose={() => setAdding(false)} title="Connect a calendar" description="manageBagle only reads it, and keeps only meeting titles and times.">
        {adding && <ConnectForm onClose={() => setAdding(false)} />}
      </Dialog>
      <ConfirmDialog open={confirmRegenerate} onClose={() => setConfirmRegenerate(false)} title="Make a new subscription link?"
        body="The old link stops working. Calendars subscribed to it will need the new one." confirmLabel="Make a new link" loading={regenerateFeed.isPending}
        onConfirm={() => regenerateFeed.mutate(undefined, { onSuccess: () => { setConfirmRegenerate(false); toast.success("New link ready"); }, onError: (e) => toast.error(errorMessage(e)) })} />
      <ConfirmDialog open={!!removing} onClose={() => setRemoving(null)} title={`Disconnect “${removing?.name}”?`} body="Its meetings stop showing as busy. Your own calendar is not changed."
        confirmLabel="Disconnect" loading={disconnect.isPending}
        onConfirm={() => removing && disconnect.mutate(removing.id, { onSuccess: () => setRemoving(null), onError: (e) => toast.error(errorMessage(e)) })} />
    </section>
  );
}

function ConnectForm({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const { connect } = useCalendarMutations();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState<ApiError | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const c = await connect.mutateAsync({ name, url });
      toast.success(`${c.name} connected · ${c.eventCount} meeting${c.eventCount === 1 ? "" : "s"} found`);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
    }
  };
  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && !error.field("url") && <ErrorNote>{error.message}</ErrorNote>}
        <Field label="Name" optional>{(p) => <Input {...p} maxLength={80} placeholder="e.g. Work" value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="Private iCal address" error={error?.field("url")}
          hint="Google Calendar: Settings → your calendar → Integrate calendar → “Secret address in iCal format”. Outlook: Settings → Shared calendars → Publish → ICS link.">
          {(p) => <Input {...p} autoFocus required inputMode="url" autoComplete="off" spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" value={url} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={connect.isPending} disabled={!url.trim()}>Connect</Button>
      </footer>
    </form>
  );
}
