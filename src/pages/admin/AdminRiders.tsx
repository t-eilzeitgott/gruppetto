import { useMemo, useState } from 'react';
import { source } from '../../app/config';
import { invalidate } from '../../app/query';
import { useTourData } from '../../app/hooks';
import type { Rider, Tour } from '../../lib/types';
import { parseStartlist, normalize, type ParsedRider } from '../../lib/pcsParse';
import { Button, ErrorBox, Loading, Notice, cx, toast, useAction, useTitle } from '../../ui/kit';
import { Icon } from '../../ui/Icon';
import { AdminPage, ExternalLink, pcsUrl } from './common';

export function AdminRiders() {
  useTitle('Startliste');
  return <AdminPage title="Startliste">{(tour) => <RidersEditor tour={tour} />}</AdminPage>;
}

function RidersEditor({ tour }: { tour: Tour }) {
  const q = useTourData(tour);
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const riders = q.data?.riders ?? [];
  const filtered = useMemo(() => {
    const n = normalize(query);
    return riders.filter((r) => !n || normalize(`${r.name} ${r.team} ${r.bib ?? ''}`).includes(n));
  }, [riders, query]);

  if (q.error) return <ErrorBox error={q.error} onRetry={q.reload} />;
  if (!q.data) return <Loading />;
  const teams = [...new Set(filtered.map((r) => r.team))];

  return (
    <>
      <Importer tour={tour} existing={riders.length} />
      {riders.length ? (
        <>
          <h2 className="section-title">{riders.length} Fahrer</h2>
          <p className="muted small">Fahrer antippen, um Joker-Limit, „Best of the Rest“ oder den Status zu ändern.</p>
          <label className="search">
            <Icon name="search" size={18} />
            <span className="sr-only">Fahrer suchen</span>
            <input type="search" placeholder="Fahrer oder Team suchen" value={query} onChange={(e) => setQuery((e.target as HTMLInputElement).value)} />
          </label>
          {teams.map((team) => (
            <section key={team} className="card">
              <h3 className="card__h">{team}</h3>
              <ul className="list">
                {filtered.filter((r) => r.team === team).map((r) => (
                  <li key={r.id}>
                    {openId === r.id
                      ? <RiderEditor tour={tour} rider={r} onDone={() => setOpenId(null)} />
                      : (
                        <button type="button" className="admin-rider" onClick={() => setOpenId(r.id)}>
                          <span className="rider-option__bib">{r.bib ?? '–'}</span>
                          <span className="admin-rider__name">{r.name}</span>
                          <span className="admin-rider__tags">
                            {r.tip_limit !== null ? <span className="chip chip--accent">Joker {r.tip_limit}×</span> : null}
                            {r.excluded_from_rest ? <span className="chip">nicht Best of Rest</span> : null}
                            {r.status === 'out' ? <span className="chip">ausgestiegen</span> : null}
                          </span>
                        </button>
                      )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      ) : null}
    </>
  );
}

function Importer({ tour, existing }: { tour: Tour; existing: number }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<{ riders: ParsedRider[]; skipped: string[] } | null>(null);
  const imp = useAction();
  const url = pcsUrl(tour, 'startlist');

  const run = () => imp.run(async () => {
    if (!parsed) return;
    await source.importRiders(tour.id, parsed.riders);
    invalidate(`tour:${tour.id}`);
    toast(`${parsed.riders.length} Fahrer importiert`);
    setText('');
    setParsed(null);
  });

  return (
    <section className="card">
      <h2 className="card__title">{existing ? 'Startliste aktualisieren' : 'Startliste importieren'}</h2>
      <p className="muted">
        Auf der PCS-Startliste alles markieren, kopieren und hier einfügen. Alternativ eine Zeile pro Fahrer: <code>Nr;Name;Team</code>.
        Vorhandene Fahrer werden über den Namen aktualisiert.
      </p>
      {url ? <ExternalLink href={url}>Startliste auf procyclingstats.com</ExternalLink> : null}
      <div className="field">
        <label htmlFor="import-text">Text einfügen</label>
        <textarea id="import-text" rows={6} value={text} onChange={(e) => { setText((e.target as HTMLTextAreaElement).value); setParsed(null); }}
          placeholder={'UAE Team Emirates XRG\n1 POGAČAR Tadej\n2 DEL TORO Isaac'} />
      </div>
      {!parsed ? (
        <Button variant="secondary" full onClick={() => setParsed(parseStartlist(text))} disabled={!text.trim()}>Vorschau</Button>
      ) : (
        <>
          <Notice>
            <strong>{parsed.riders.length} Fahrer erkannt</strong>
            {parsed.skipped.length ? <span>{parsed.skipped.length} Zeilen übersprungen, z. B. „{parsed.skipped[0]}“</span> : <span>Bitte prüfen und dann importieren.</span>}
          </Notice>
          {parsed.riders.length ? (
            <div className="table-scroll preview">
              <table>
                <thead><tr><th scope="col" className="num">Nr</th><th scope="col" className="left">Name</th><th scope="col" className="left">Team</th></tr></thead>
                <tbody>
                  {parsed.riders.slice(0, 200).map((r, i) => (
                    <tr key={`${r.name}-${i}`}><td className="num">{r.bib ?? '–'}</td><td className="left">{r.name}</td><td className="left muted">{r.team}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {imp.error ? <ErrorBox error={imp.error} /> : null}
          <div className="form__actions">
            <Button variant="secondary" onClick={() => setParsed(null)}>Zurück</Button>
            <Button onClick={run} busy={imp.busy} disabled={!parsed.riders.length}>{parsed.riders.length} importieren</Button>
          </div>
        </>
      )}
    </section>
  );
}

function RiderEditor({ tour, rider, onDone }: { tour: Tour; rider: Rider; onDone: () => void }) {
  const [limit, setLimit] = useState(rider.tip_limit === null ? '' : String(rider.tip_limit));
  const [excluded, setExcluded] = useState(rider.excluded_from_rest);
  const [status, setStatus] = useState(rider.status);
  const [name, setName] = useState(rider.name);
  const [team, setTeam] = useState(rider.team);
  const [bib, setBib] = useState(rider.bib === null ? '' : String(rider.bib));
  const save = useAction();
  const del = useAction();

  const submit = () => save.run(async () => {
    await source.updateRider(rider.id, {
      tip_limit: limit.trim() === '' ? null : Math.max(0, Number(limit)),
      excluded_from_rest: excluded,
      status,
      name: name.trim(),
      team: team.trim(),
      bib: bib.trim() === '' ? null : Number(bib),
    });
    invalidate(`tour:${tour.id}`);
    toast(`${name.trim()} gespeichert`);
    onDone();
  });

  const remove = () => {
    if (!window.confirm(`${rider.name} aus der Startliste löschen? Tipps auf ihn werden mitgelöscht.`)) return;
    del.run(async () => {
      await source.deleteRider(rider.id);
      invalidate(`tour:${tour.id}`);
      onDone();
    });
  };

  return (
    <div className={cx('form', 'rider-editor')}>
      <div className="form__grid">
        <div className="field">
          <label htmlFor={`r-bib-${rider.id}`}>Nr</label>
          <input id={`r-bib-${rider.id}`} type="number" inputMode="numeric" value={bib} onChange={(e) => setBib((e.target as HTMLInputElement).value)} />
        </div>
        <div className="field">
          <label htmlFor={`r-limit-${rider.id}`}>Joker-Limit</label>
          <input id={`r-limit-${rider.id}`} type="number" inputMode="numeric" min={0} placeholder="kein Limit" value={limit}
            onChange={(e) => setLimit((e.target as HTMLInputElement).value)} />
        </div>
      </div>
      <div className="field">
        <label htmlFor={`r-name-${rider.id}`}>Name</label>
        <input id={`r-name-${rider.id}`} type="text" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} />
      </div>
      <div className="field">
        <label htmlFor={`r-team-${rider.id}`}>Team</label>
        <input id={`r-team-${rider.id}`} type="text" value={team} onChange={(e) => setTeam((e.target as HTMLInputElement).value)} />
      </div>
      <label className="check">
        <input type="checkbox" checked={excluded} onChange={(e) => setExcluded((e.target as HTMLInputElement).checked)} />
        <span>Bei „Best of the Rest“ ausklammern</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={status === 'out'} onChange={(e) => setStatus((e.target as HTMLInputElement).checked ? 'out' : 'active')} />
        <span>Ausgestiegen (nicht mehr tippbar)</span>
      </label>
      {save.error ? <ErrorBox error={save.error} /> : null}
      {del.error ? <ErrorBox error={del.error} /> : null}
      <div className="form__actions">
        <Button variant="ghost" onClick={remove} busy={del.busy}>Löschen</Button>
        <Button variant="secondary" onClick={onDone}>Abbrechen</Button>
        <Button onClick={submit} busy={save.busy} disabled={!name.trim() || !team.trim()}>Speichern</Button>
      </div>
    </div>
  );
}
