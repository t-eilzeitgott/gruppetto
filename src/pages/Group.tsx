import { useState, type FormEvent } from 'react';
import { useApp } from '../app/context';
import { source } from '../app/config';
import { useMembers, useTourData } from '../app/hooks';
import { invalidate, useQuery } from '../app/query';
import { DEFAULT_RULES, byName } from '../lib/scoring';
import type { Group, Profile } from '../lib/types';
import { Avatar, Button, ErrorBox, Loading, Notice, ProBadge, Segmented, TopBar, cx, toast, useAction, useTitle } from '../ui/kit';
import { Icon } from '../ui/Icon';
import { Rules } from './Profile';

export function useGroup() {
  return useQuery<Group | null>('group', () => source.loadGroup());
}

/** Nach einer Änderung an der Gruppe: Gruppe, Mitglieder und alles Berechnete neu laden */
function refreshGroup() {
  invalidate('group');
  invalidate('members');
  invalidate('tour:');
}

/**
 * Die eigene Gruppe: Mitglieder und Regeln für alle – Einladungscode, Name, Regeln und Mitglieder verwalten für die
 * Leitung (wer die Gruppe gegründet hat).
 */
export function GroupPage() {
  useTitle('Gruppe');
  const { me, tour } = useApp();
  const group = useGroup();
  const members = useMembers();
  const tourQ = useTourData(tour);
  const [editing, setEditing] = useState(false);
  const g = group.data;

  return (
    <>
      <TopBar title={g?.name ?? 'Gruppe'} subtitle={g ? 'Deine Gruppe' : undefined} back="/profil" />
      <div className="stack">
        {group.error ? <ErrorBox error={group.error} onRetry={group.reload} /> : g === undefined ? <Loading /> : g === null ? (
          <Notice><p>Du bist in keiner Gruppe.</p></Notice>
        ) : (
          <>
            {g.can_manage && g.invite_code ? <InviteCard group={g} code={g.invite_code} /> : null}
            {members.error ? <ErrorBox error={members.error} onRetry={members.reload} /> : !members.data ? <Loading /> : (
              <MemberList group={g} members={members.data} meId={me.id} />
            )}
            {g.can_manage && editing ? (
              <RulesForm group={g} onDone={() => setEditing(false)} />
            ) : (
              <>
                <Rules data={tourQ.data} />
                {g.can_manage ? <Button variant="secondary" full onClick={() => setEditing(true)}>Name und Regeln anpassen</Button> : null}
              </>
            )}
          </>
        )}
      </div>
    </>
  );
}

function inviteUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}?code=${encodeURIComponent(code)}`;
}

function InviteCard({ group, code }: { group: Group; code: string }) {
  const renew = useAction();
  const message = `Komm in unsere Tipprunde „${group.name}“ bei gruppetto: ${inviteUrl(code)} – Einladungscode: ${code}`;

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

  const onRenew = () => {
    if (!window.confirm('Neuen Einladungscode erzeugen? Der bisherige Code gilt dann nicht mehr. Wer schon dabei ist, bleibt dabei.')) return;
    renew.run(async () => {
      await source.newInviteCode();
      invalidate('group');
      toast('Neuer Einladungscode');
    });
  };

  return (
    <section className="card">
      <span className="eyebrow">Einladungscode</span>
      <p className="invite-code">{code}</p>
      <p className="muted">Schick den Link mit diesem Code an deine Leute – damit kommen sie in deine Gruppe.</p>
      {renew.error ? <ErrorBox error={renew.error} /> : null}
      <div className="form__actions">
        <Button variant="secondary" onClick={onRenew} busy={renew.busy}>Neuer Code</Button>
        <Button icon="share" onClick={share}>Einladung teilen</Button>
      </div>
    </section>
  );
}

function MemberList({ group, members, meId }: { group: Group; members: Profile[]; meId: string }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const list = members
    .filter((m) => m.is_member && m.display_name)
    .sort((a, b) => Number(b.id === group.owner_id) - Number(a.id === group.owner_id) || byName({ name: a.display_name! }, { name: b.display_name! }));
  return (
    <section aria-labelledby="group-members">
      <h2 id="group-members" className="section-title">{list.length} {list.length === 1 ? 'Mitglied' : 'Mitglieder'}</h2>
      {list.length === 1 && group.can_manage ? <p className="muted small">Noch bist du allein – teil den Einladungscode.</p> : null}
      {list.length > 1 && group.can_manage ? <p className="muted small">Mitglied antippen, um es zu entfernen oder ihm die Leitung zu übergeben.</p> : null}
      <ul className="list">
        {list.map((m) => (
          <MemberRow key={m.id} group={group} member={m} isMe={m.id === meId} open={openId === m.id}
            onToggle={() => setOpenId(openId === m.id ? null : m.id)} />
        ))}
      </ul>
    </section>
  );
}

function MemberRow({ group, member, isMe, open, onToggle }: { group: Group; member: Profile; isMe: boolean; open: boolean; onToggle: () => void }) {
  const act = useAction();
  const isOwner = member.id === group.owner_id;
  const manageable = group.can_manage && !isMe && !isOwner;
  const name = member.display_name ?? '';

  const remove = () => {
    if (!window.confirm(`${name} aus der Gruppe nehmen? Die Tipps bleiben gespeichert und zählen wieder, falls ${name} zurückkommt.`)) return;
    act.run(async () => {
      await source.removeMember(member.id);
      refreshGroup();
      toast(`${name} entfernt`);
    });
  };

  const transfer = () => {
    if (!window.confirm(`Die Leitung der Gruppe an ${name} übergeben? Einladungscode, Regeln und Mitglieder verwaltet dann ${name}.`)) return;
    act.run(async () => {
      await source.transferGroup(member.id);
      refreshGroup();
      toast(`${name} leitet jetzt die Gruppe`);
    });
  };

  const head = (
    <>
      <Avatar name={name} color={member.avatar_color} size={36} />
      <span className="account__main">
        <strong>{name}{member.is_pro ? <ProBadge /> : null}{isMe ? ' (du)' : ''}</strong>
        {isOwner ? <span className="muted">Leitung</span> : null}
      </span>
    </>
  );

  return (
    <li className="card user-row member-row">
      {manageable ? (
        <button type="button" className="account member-row__head" aria-expanded={open} onClick={onToggle}>
          {head}
          <Icon name="chevron" className={cx('muted', 'member-row__chev', open && 'is-open')} />
        </button>
      ) : <div className="account">{head}</div>}
      {manageable && open ? (
        <div className="form__actions">
          <Button variant="ghost" size="sm" onClick={transfer} disabled={act.busy}>Leitung übergeben</Button>
          <Button variant="secondary" size="sm" onClick={remove} busy={act.busy}>Entfernen</Button>
        </div>
      ) : null}
      {act.error ? <ErrorBox error={act.error} /> : null}
    </li>
  );
}

const PLACES = 10;

/** Zahl aus einem Eingabefeld: leer = 0, sonst ganze Zahl von 0 bis max */
function toInt(text: string, max: number): number {
  const n = Math.round(Number(text.replace(',', '.')));
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : 0;
}

function RulesForm({ group, onDone }: { group: Group; onDone: () => void }) {
  const [name, setName] = useState(group.name);
  const [stage, setStage] = useState<string[]>(() => Array.from({ length: PLACES }, (_, i) => (group.stage_points[i] ? String(group.stage_points[i]) : '')));
  const [bonus, setBonus] = useState<string[]>(() => [0, 1, 2].map((i) => String(group.bonus_points[i] ?? 0)));
  const [limit, setLimit] = useState(group.tip_limit === null ? '' : String(group.tip_limit));
  const [underdog, setUnderdog] = useState(group.underdog_bonus);
  const save = useAction();

  const setAt = (list: string[], set: (v: string[]) => void, i: number, v: string) => set(list.map((x, k) => (k === i ? v : x)));

  const reset = () => {
    setStage(Array.from({ length: PLACES }, (_, i) => String(DEFAULT_RULES.stage_points[i] ?? '')));
    setBonus(DEFAULT_RULES.bonus_points.map(String));
    setLimit(DEFAULT_RULES.tip_limit === null ? '' : String(DEFAULT_RULES.tip_limit));
    setUnderdog(DEFAULT_RULES.underdog_bonus);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run(async () => {
      // Plätze ohne Punkte am Ende fallen weg (Platz 1 bleibt immer)
      const points = stage.map((x) => toInt(x, 100));
      while (points.length > 1 && points[points.length - 1] === 0) points.pop();
      await source.updateGroup({
        name,
        stage_points: points,
        bonus_points: bonus.map((x) => toInt(x, 100)),
        tip_limit: limit.trim() === '' ? null : Math.max(1, toInt(limit, 21)),
        underdog_bonus: underdog,
      });
      refreshGroup();
      toast('Gruppe gespeichert');
      onDone();
    });
  };

  const validName = name.trim().length >= 2 && name.trim().length <= 30;

  return (
    <form className="card form" onSubmit={submit} noValidate>
      <h2 className="card__title">Name und Regeln</h2>
      <div className="field">
        <label htmlFor="group-name">Name der Gruppe</label>
        <input id="group-name" type="text" maxLength={30} value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />
      </div>

      <fieldset className="points-field">
        <legend>Etappentipp: Punkte je Platz im Ziel</legend>
        <div className="points-grid">
          {stage.map((v, i) => (
            <label key={i} className="points-cell">
              <span>{i + 1}.</span>
              <input type="number" inputMode="numeric" min={0} max={100} placeholder="0" value={v} aria-label={`Punkte für Platz ${i + 1}`}
                onChange={(e) => setAt(stage, setStage, i, (e.target as HTMLInputElement).value)} />
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset className="points-field">
        <legend>Bonustipps: Punkte für Platz 1, 2 und 3</legend>
        <div className="points-grid points-grid--3">
          {bonus.map((v, i) => (
            <label key={i} className="points-cell">
              <span>{i + 1}.</span>
              <input type="number" inputMode="numeric" min={0} max={100} placeholder="0" value={v} aria-label={`Bonuspunkte für Platz ${i + 1}`}
                onChange={(e) => setAt(bonus, setBonus, i, (e.target as HTMLInputElement).value)} />
            </label>
          ))}
        </div>
      </fieldset>

      <div className="field">
        <label htmlFor="group-limit">Max. Tipps pro Fahrer</label>
        <input id="group-limit" type="number" inputMode="numeric" min={1} max={21} placeholder="unbegrenzt" value={limit}
          onChange={(e) => setLimit((e.target as HTMLInputElement).value)} />
        <span className="field__hint">Wie oft man denselben Fahrer pro Rundfahrt tippen darf. Leer = unbegrenzt.</span>
      </div>

      <div className="setting">
        <span className="setting__label">Außenseiter-Bonus</span>
        <Segmented<'on' | 'off'>
          label="Außenseiter-Bonus"
          value={underdog ? 'on' : 'off'}
          onChange={(v) => setUnderdog(v === 'on')}
          options={[{ value: 'on', label: 'An' }, { value: 'off', label: 'Aus' }]}
        />
        <span className="field__hint">Extrapunkte für den einzigen Tipp auf den Etappensieger.</span>
      </div>

      <Notice><p>Die Regeln gelten nur für deine Gruppe – sofort und für die ganze Wertung, auch für schon gefahrene Etappen. Am besten vor dem Start der Rundfahrt festlegen.</p></Notice>
      {save.error ? <ErrorBox error={save.error} /> : null}
      <button type="button" className="text-btn" onClick={reset}>Standardregeln einsetzen</button>
      <div className="form__actions">
        <Button variant="secondary" onClick={onDone}>Abbrechen</Button>
        <Button type="submit" busy={save.busy} disabled={!validName}>Speichern</Button>
      </div>
    </form>
  );
}
