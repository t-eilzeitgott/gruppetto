import { source } from '../../app/config';
import { invalidate, useQuery } from '../../app/query';
import { useApp } from '../../app/context';
import type { AdminUser } from '../../lib/types';
import { Avatar, ErrorBox, Loading, Notice, TopBar, cx, useAction, useTitle } from '../../ui/kit';

export function AdminMembers() {
  useTitle('Konten');
  const users = useQuery<AdminUser[]>('admin:users', () => source.adminListUsers());
  return (
    <>
      <TopBar title="Konten" subtitle="Alle Gruppen" back="/admin" />
      <div className="stack">
        <Notice>
          <p>Jede Gruppe hat ihren eigenen Einladungscode und ihre eigenen Regeln – beides verwaltet ihre Leitung unter Profil → Gruppe. Hier siehst du alle Konten.</p>
        </Notice>
        {users.error ? <ErrorBox error={users.error} onRetry={users.reload} /> : !users.data ? <Loading /> : <UserList users={users.data} />}
      </div>
    </>
  );
}

function UserList({ users }: { users: AdminUser[] }) {
  const members = users.filter((u) => u.is_member);
  const groups = new Set(members.map((u) => u.group_id).filter(Boolean)).size;
  const requests = users.filter((u) => u.pro_requested_at && !u.is_pro).length;
  const pending = users.filter((u) => !u.is_member);
  return (
    <>
      <h2 className="section-title">{members.length} Mitglieder{groups > 1 ? ` in ${groups} Gruppen` : ''}</h2>
      {requests ? <p className="muted small">{requests} offene Pro-Anfrage{requests === 1 ? '' : 'n'} – zum Freischalten bei der Person „Pro“ antippen.</p> : null}
      <ul className="list">
        {members.map((u) => <UserRow key={u.id} user={u} />)}
      </ul>
      {pending.length ? (
        <>
          <h2 className="section-title">Angemeldet, aber nicht beigetreten</h2>
          <p className="muted small">Diese Konten sind noch in keiner Gruppe. Mit „Mitglied“ nimmst du sie in deine eigene Gruppe auf.</p>
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
    invalidate('group');
  });
  return (
    <li className="card user-row">
      <div className="account">
        <Avatar name={user.display_name ?? user.email} color={user.avatar_color} size={36} />
        <span className="account__main">
          <strong>{user.display_name ?? 'Noch ohne Namen'}{user.id === me.id ? ' (du)' : ''}</strong>
          <span className="muted break-all">{user.email}</span>
          {user.group_name ? <span className="muted">{user.group_name}{user.is_owner ? ' · Leitung' : ''}</span> : null}
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
