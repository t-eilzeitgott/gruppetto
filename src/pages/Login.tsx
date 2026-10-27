import { useEffect, useState, type FormEvent } from 'react';
import { source } from '../app/config';
import { invalidate } from '../app/query';
import { Button, ErrorBox, Notice, useAction, useTitle } from '../ui/kit';
import { Wordmark } from '../ui/Shell';
import { InstallSteps } from '../ui/InstallSteps';
import { shouldGateLogin, skipInstall, useInstall } from '../lib/install';

/**
 * Auf dem Handy im Browser zuerst „Zum Home-Bildschirm“: Die installierte App hat (vor allem auf dem iPhone)
 * einen eigenen Speicher – eine Anmeldung im Browser gilt dort nicht.
 */
export function Login() {
  const install = useInstall();
  return shouldGateLogin(install) ? <InstallFirst /> : <LoginForm />;
}

function InstallFirst() {
  useTitle('App installieren');
  const install = useInstall();
  return (
    <div className="auth">
      <div className="auth__top">
        <Wordmark />
      </div>
      <div className="auth__hero">
        <h1 className="display"><span>Erst aufs Handy,</span> <span>dann los.</span></h1>
        <p className="lead muted">
          Leg gruppetto auf deinen Home-Bildschirm und melde dich dort an. So startest du mit einem Tipp und bleibst angemeldet.
        </p>
      </div>
      <div className="auth__form">
        <InstallSteps install={install} />
        <div className="auth__links auth__links--center">
          <button type="button" className="text-btn text-btn--muted" onClick={() => skipInstall()}>Ohne Installation im Browser weiter</button>
        </div>
      </div>
    </div>
  );
}

function LoginForm() {
  useTitle('Anmelden');
  const install = useInstall();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const send = useAction();
  const verify = useAction();

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    send.run(async () => {
      await source.sendCode(email);
      setStep('code');
      setCode('');
      setCooldown(60);
    });
  };

  const submitCode = (e: FormEvent) => {
    e.preventDefault();
    verify.run(async () => {
      await source.verifyCode(email, code);
      invalidate();
    });
  };

  const resend = () =>
    send.run(async () => {
      await source.sendCode(email);
      setCooldown(60);
    });

  return (
    <div className="auth">
      <div className="auth__top">
        <Wordmark />
      </div>
      <div className="auth__hero">
        <h1 className="display"><span>Ein Tipp pro Etappe.</span> <span>Drei Grand Tours.</span></h1>
        <p className="lead muted">Das Tippspiel für eure Runde – mit Live-Rangliste, Bonustipps und Tipps, die bis zum Start verdeckt bleiben.</p>
      </div>

      {step === 'email' ? (
        <form className="auth__form" onSubmit={submitEmail} noValidate>
          <div className="field">
            <label htmlFor="login-email">E‑Mail</label>
            <input
              id="login-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              placeholder="name@beispiel.de"
              value={email}
              onChange={(e) => setEmail((e.target as HTMLInputElement).value)}
              required
            />
          </div>
          {send.error ? <ErrorBox error={send.error} /> : null}
          <Button type="submit" full busy={send.busy} disabled={!/^\S+@\S+\.\S+$/.test(email.trim())}>Code per E‑Mail senden</Button>
          <p className="hint">Kein Passwort nötig: Du bekommst einen Code per E‑Mail und bleibst auf diesem Gerät angemeldet.</p>
          {source.mode === 'demo' ? <Notice><p>Demo: Gib eine beliebige E‑Mail ein, der Code ist <strong>123456</strong>.</p></Notice> : null}
          {!install.standalone && install.platform !== 'desktop' ? (
            <div className="auth__links auth__links--center">
              <button type="button" className="text-btn" onClick={() => skipInstall(false)}>Doch lieber als App installieren</button>
            </div>
          ) : null}
        </form>
      ) : (
        <form className="auth__form" onSubmit={submitCode} noValidate>
          <p className="auth__sent">
            Wir haben dir einen Code an <strong className="break-all">{email.trim()}</strong> geschickt. Schau auch im Spam-Ordner nach.
          </p>
          <div className="field">
            <label htmlFor="login-code">Code aus der E‑Mail</label>
            <input
              id="login-code"
              className="input--code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={10}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
              autoFocus
            />
          </div>
          {verify.error ? <ErrorBox error={verify.error} /> : null}
          {send.error ? <ErrorBox error={send.error} /> : null}
          <Button type="submit" full busy={verify.busy} disabled={code.length < 6}>Anmelden</Button>
          <div className="auth__links">
            <button type="button" className="text-btn" onClick={resend} disabled={cooldown > 0 || send.busy}>
              {cooldown > 0 ? `Neuen Code in ${cooldown} s` : 'Code erneut senden'}
            </button>
            <button type="button" className="text-btn" onClick={() => setStep('email')}>Andere E‑Mail</button>
          </div>
        </form>
      )}
    </div>
  );
}
