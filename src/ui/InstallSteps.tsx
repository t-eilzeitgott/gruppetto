import { useState } from 'react';
import { promptInstall, type InstallState } from '../lib/install';
import { Button, Notice } from './kit';
import { Icon } from './Icon';

/** Anleitung bzw. Knopf für „Zum Home-Bildschirm“, je nach Gerät. */
export function InstallSteps({ install, compact }: { install: InstallState; compact?: boolean }) {
  const [busy, setBusy] = useState(false);

  if (install.installed) {
    return (
      <Notice icon="check" tone="accent">
        <strong>Installiert!</strong>
        <p>Öffne gruppetto jetzt über das Symbol auf deinem Home-Bildschirm{compact ? '.' : ' und melde dich dort an.'}</p>
      </Notice>
    );
  }

  if (install.canPrompt) {
    const run = async () => {
      setBusy(true);
      try {
        await promptInstall();
      } finally {
        setBusy(false);
      }
    };
    return <Button full={!compact} variant={compact ? 'secondary' : 'primary'} icon="plus" busy={busy} onClick={run}>App installieren</Button>;
  }

  if (install.platform === 'ios' && install.iosNoShare) {
    return (
      <Notice icon="info">
        <strong>Hier geht das leider nicht</strong>
        <p>Dieser Browser kann keine Apps ablegen. Tippe auf <strong>⋯</strong> und wähle <strong>In Safari öffnen</strong>.</p>
      </Notice>
    );
  }

  const steps = install.platform === 'ios'
    ? [
        <>Tippe {install.iosOtherBrowser ? 'oben in der Adressleiste' : 'unten'} auf <Icon name="share" size={17} className="install-steps__icon" /> <strong>Teilen</strong>{install.iosOtherBrowser ? '' : <> (im neuen Safari erst auf <strong>⋯</strong>)</>}.</>,
        <>Wähle <strong>Zum Home-Bildschirm</strong> – eventuell etwas nach unten scrollen.</>,
        <>Tippe auf <strong>Hinzufügen</strong>{compact ? '.' : <> und öffne gruppetto dann vom Home-Bildschirm.</>}</>,
      ]
    : [
        <>Öffne das Browser-Menü <strong>⋮</strong>.</>,
        <>Wähle <strong>App installieren</strong> oder <strong>Zum Startbildschirm hinzufügen</strong>.</>,
        <>{compact ? 'Bestätigen.' : 'Bestätigen und gruppetto vom Startbildschirm öffnen.'}</>,
      ];

  return (
    <ol className="install-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="install-steps__n" aria-hidden="true">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}
