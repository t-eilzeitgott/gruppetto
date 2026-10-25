import { useState, type FormEvent } from 'react';
import { source } from '../app/config';
import { invalidate } from '../app/query';
import { Button, ErrorBox, Notice, useAction, useTitle } from '../ui/kit';
import { Wordmark } from '../ui/Shell';

export function Join() {
  useTitle('Beitreten');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const join = useAction();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    join.run(async () => {
      await source.joinGroup(code, name);
      invalidate();
    });
  };

  const valid = name.trim().length >= 2 && name.trim().length <= 20 && code.trim().length > 0;

  return (
    <div className="auth">
      <div className="auth__top">
        <Wordmark />
        <button type="button" className="text-btn" onClick={() => source.signOut()}>Abmelden</button>
      </div>
      <div className="auth__hero">
        <h1 className="display">Fast geschafft.</h1>
        <p className="lead muted">Wähle deinen Namen für die Rangliste und gib den Einladungscode eurer Runde ein.</p>
      </div>
      <form className="auth__form" onSubmit={submit} noValidate>
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
        <div className="field">
          <label htmlFor="join-code">Einladungscode</label>
          <input
            id="join-code"
            type="text"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            placeholder="vom Organisator"
            value={code}
            onChange={(e) => setCode((e.target as HTMLInputElement).value)}
          />
        </div>
        {join.error ? <ErrorBox error={join.error} /> : null}
        <Button type="submit" full busy={join.busy} disabled={!valid}>Der Runde beitreten</Button>
        {source.mode === 'demo' ? <Notice><p>Demo: Der Einladungscode ist <strong>GIRO27</strong>.</p></Notice> : null}
      </form>
    </div>
  );
}
