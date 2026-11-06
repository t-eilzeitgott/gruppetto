import { useState, type FormEvent } from 'react';
import { source } from '../app/config';
import { invalidate } from '../app/query';
import { navigate } from '../app/router';
import { Button, ErrorBox, Notice, Segmented, useAction, useTitle } from '../ui/kit';
import { Wordmark } from '../ui/Shell';

type Mode = 'join' | 'create';

/** Einladungscode aus dem Einladungslink (…/?code=ABC123) */
function codeFromLink(): string {
  try {
    return (new URLSearchParams(window.location.search).get('code') ?? '').trim().toUpperCase().slice(0, 20);
  } catch {
    return '';
  }
}

/** Nach der Anmeldung: mit einem Einladungscode einer Gruppe beitreten – oder ohne Code eine eigene gründen. */
export function Join() {
  const [code, setCode] = useState(codeFromLink);
  const [mode, setMode] = useState<Mode>('join');
  const [name, setName] = useState('');
  const [groupName, setGroupName] = useState('');
  useTitle(mode === 'join' ? 'Beitreten' : 'Gruppe gründen');
  const act = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    act.run(async () => {
      if (mode === 'join') await source.joinGroup(code, name);
      else {
        await source.createGroup(groupName, name);
        // gleich zur Gruppe: dort steht der Einladungscode zum Verschicken
        navigate('/gruppe', { replace: true });
      }
      invalidate();
    });
  };

  const nameOk = name.trim().length >= 2 && name.trim().length <= 20;
  const valid = nameOk && (mode === 'join' ? code.trim().length > 0 : groupName.trim().length >= 2 && groupName.trim().length <= 30);

  return (
    <div className="auth">
      <div className="auth__top">
        <Wordmark />
        <button type="button" className="text-btn" onClick={() => source.signOut()}>Abmelden</button>
      </div>
      <div className="auth__hero">
        <h1 className="display">Fast geschafft.</h1>
        <p className="lead muted">
          {mode === 'join'
            ? 'Wähle deinen Namen für die Rangliste und gib den Einladungscode eurer Gruppe ein.'
            : 'Gründe deine eigene Gruppe: Giro, Tour und Vuelta mit eigener Rangliste. Den Einladungscode für deine Leute bekommst du gleich danach.'}
        </p>
      </div>
      <form className="auth__form" onSubmit={submit} noValidate>
        <Segmented<Mode>
          label="Beitreten oder neue Gruppe gründen"
          value={mode}
          onChange={(m) => { setMode(m); act.setError(null); }}
          options={[{ value: 'join', label: 'Ich habe einen Code' }, { value: 'create', label: 'Neue Gruppe' }]}
        />
        <div className="field">
          <label htmlFor="join-name">Anzeigename</label>
          <input
            id="join-name"
            type="text"
            autoComplete="nickname"
            maxLength={20}
            placeholder="z. B. Christoph"
            value={name}
            onChange={(e) => setName((e.target as HTMLInputElement).value)}
          />
          <span className="field__hint">2 bis 20 Zeichen · so sehen dich die anderen</span>
        </div>
        {mode === 'join' ? (
          <div className="field">
            <label htmlFor="join-code">Einladungscode</label>
            <input
              id="join-code"
              type="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              placeholder="von der Leitung eurer Gruppe"
              value={code}
              onChange={(e) => setCode((e.target as HTMLInputElement).value)}
            />
            <span className="field__hint">Kein Code? Dann gründe oben eine neue Gruppe.</span>
          </div>
        ) : (
          <div className="field">
            <label htmlFor="join-group">Name der Gruppe</label>
            <input
              id="join-group"
              type="text"
              autoComplete="off"
              maxLength={30}
              placeholder="z. B. Bergziegen"
              value={groupName}
              onChange={(e) => setGroupName((e.target as HTMLInputElement).value)}
            />
            <span className="field__hint">2 bis 30 Zeichen · du leitest die Gruppe und kannst Name und Regeln später ändern</span>
          </div>
        )}
        {act.error ? <ErrorBox error={act.error} /> : null}
        <Button type="submit" full busy={act.busy} disabled={!valid}>{mode === 'join' ? 'Der Gruppe beitreten' : 'Gruppe gründen'}</Button>
        {source.mode === 'demo' && mode === 'join' ? <Notice><p>Demo: Der Einladungscode ist <strong>GIRO27</strong>.</p></Notice> : null}
      </form>
    </div>
  );
}
