import { useState } from 'react';
import { source } from '../../app/config';
import { invalidate, useQuery } from '../../app/query';
import { useApp } from '../../app/context';
import type { AdminUser } from '../../lib/types';
import { Avatar, Button, ErrorBox, Loading, TopBar, cx, toast, useAction, useTitle } from '../../ui/kit';

export function AdminMembers() {
  useTitle('Mitglieder');
  const users = useQuery<AdminUser[]>('admin:users', () => source.adminListUsers());
  const code = useQuery<string>('admin:invite', () => source.getInviteCode());
  return (
    <>
      <TopBar title="Mitglieder & Einladung" back="/admin" />
      <div className="stack">
        {code.error ? <ErrorBox error={code.error} onRetry={code.reload} /> : code.data === undefined ? <Loading /> : <InviteCard code={code.data} />}
        {users.error ? <ErrorBox error={users.error} onRetry={users.reload} /> : !users.data ? <Loading /> : <UserList users={users.data} />}
      </div>
    </>
  );
}

function appUrl(): string {
  return `${window.location.origin}${window.location.pathname}`;
}

function InviteCard({ code }: { code: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(code);
  const save = useAction();
  const message = `Komm in unsere Tipprunde bei gruppetto: ${appUrl()} – Einladungscode: ${code}`;

  const share = async () => {
    const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };
    try {
      if (nav.share) await nav.share({ text: message });
      else {
        await navigator.clipboard.writeText(message);
        toast('Einladung kopiert');
      }
    } catch {
      /* abgebrochen */
    }
  };

  const onSave = () => save.run(async () => {
    await source.setInviteCode(value);
    invalidate('admin:invite');
    toast('Einladungscode geändert');
    setEditing(false);
  });

  return (
    <section className="card">
      <span className="eyebrow">Einladungscode</span>
      {editing ? (
        <>
          <div className="field">
            <label htmlFor="invite">Neuer Code</label>
            <input id="invite" type="text" autoCapitalize="characters" value={value} onChange={(e) => setValue((e.target as HTMLInputElement).value)} />
            <span className="field__hint">Wer schon dabei ist, bleibt dabei. Der neue Code gilt nur für neue Mitglieder.</span>
          </div>
          {save.error ? <ErrorBox error={save.error} /> : null}
          <div className="form__actions">
            <Button variant="secondary" onClick={() => setEditing(false)}>Abbrechen</Button>
            <Button onClick={onSave} busy={save.busy} disabled={value.trim().length < 4}>Speichern</Button>
          </div>
        </>
      ) : (
        <>
          <p className="invite-code">{code}</p>
          <p className="muted">Schick den App-Link zusammen mit diesem Code in eure Gruppe.</p>
          <div className="form__actions">
            <Button variant="secondary" onClick={() => setEditing(true)}>Ändern</Button>
            <Button icon="share" onClick={share}>Einladung teilen</Button>
          </div>
        </>
      )}
    </section>
  );
}

function UserList({ users }: { users: AdminUser[] }) {
  const members = users.filter((u) => u.is_member);
  const requests = users.filter((u) => u.pro_requested_at && !u.is_pro).length;
  const pending = users.filter((u) => !u.is_member);
  return (
    <>
      <h2 className="section-title">{members.length} Mitglieder</h2>
      {requests ? <p className="muted small">{requests} offene Pro-Anfrage{requests === 1 ? '' : 'n'} – zum Freischalten bei der Person „Pro“ antippen.</p> : null}
      <ul className="list">
        {members.map((u) => <UserRow key={u.id} user={u} />)}
      </ul>
      {pending.length ? (
        <>
          <h2 className="section-title">Angemeldet, aber nicht beigetreten</h2>
          <p className="muted small">Diese Konten haben den Einladungscode noch nicht eingegeben. Du kannst sie direkt freischalten.</p>
          <ul className="list">
            {pending.map((u) => <UserRow key={u.id} user={u} />)}
          </ul>
        </>
      ) : null}
    </>
  );
}

function UserRow({ user }: { user: AdminUser }) {
  const { me } = useApp();
  const act = useAction();
  const set = (patch: Partial<Pick<AdminUser, 'is_member' | 'is_admin' | 'is_pro'>>) => act.run(async () => {
    const next = { ...user, ...patch };
    await source.adminSetFlags(user.id, next.is_member, next.is_admin, next.is_pro);
    invalidate('admin:users');
    invalidate('members');
  });
  return (
    <li className="card user-row">
      <div className="account">
        <Avatar name={user.display_name ?? user.email} color={user.avatar_color} size={36} />
        <span className="account__main">
          <strong>{user.display_name ?? 'Noch ohne Namen'}{user.id === me.id ? ' (du)' : ''}</strong>
          <span className="muted break-all">{user.email}</span>
          {user.pro_requested_at && !user.is_pro ? (
            <span className="chip chip--accent pro-request">Pro angefragt am {new Date(user.pro_requested_at).toLocaleDateString('de-DE')}</span>
          ) : null}
        </span>
      </div>
      <div className="toggles" role="group" aria-label={`Rechte für ${user.display_name ?? user.email}`}>
        <Toggle label="Mitglied" on={user.is_member} onClick={() => set({ is_member: !user.is_member })} disabled={act.busy} />
        <Toggle label="Admin" on={user.is_admin} onClick={() => set({ is_admin: !user.is_admin })} disabled={act.busy || user.id === me.id} />
        <Toggle label="Pro" on={user.is_pro} onClick={() => set({ is_pro: !user.is_pro })} disabled={act.busy} />
      </div>
      {act.error ? <ErrorBox error={act.error} /> : null}
    </li>
  );
}

function Toggle({ label, on, onClick, disabled }: { label: string; on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className={cx('toggle', on && 'is-on')} aria-pressed={on} onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
}
