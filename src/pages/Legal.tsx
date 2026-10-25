import { TopBar, useTitle } from '../ui/kit';

/*
 * Platzhalter: Vor dem Livegang die Angaben in eckigen Klammern ersetzen
 * und die Texte prüfen (keine Rechtsberatung).
 */

export function Impressum() {
  useTitle('Impressum');
  return (
    <>
      <TopBar title="Impressum" back="/profil" />
      <article className="prose">
        <h2>Angaben gemäß § 5 DDG</h2>
        <p>[Vorname Nachname]<br />[Straße Hausnummer]<br />[PLZ Ort]</p>
        <h2>Kontakt</h2>
        <p>E‑Mail: [kontakt@beispiel.de]</p>
        <h2>Verantwortlich für den Inhalt</h2>
        <p>[Vorname Nachname], Anschrift wie oben</p>
        <h2>Hinweis</h2>
        <p>
          gruppetto ist ein privates Tippspiel unter Freunden. Es werden keine Geldeinsätze angenommen und keine Gewinne ausgezahlt.
          Fahrer- und Ergebnisdaten werden manuell gepflegt, unter anderem anhand öffentlich zugänglicher Quellen wie procyclingstats.com.
        </p>
      </article>
    </>
  );
}

export function Datenschutz() {
  useTitle('Datenschutz');
  return (
    <>
      <TopBar title="Datenschutz" back="/profil" />
      <article className="prose">
        <h2>Verantwortlicher</h2>
        <p>[Vorname Nachname], [Anschrift], [kontakt@beispiel.de]</p>
        <h2>Welche Daten wir speichern</h2>
        <ul>
          <li>E‑Mail-Adresse – für die Anmeldung per Code</li>
          <li>Anzeigename und Profilfarbe – sichtbar für die anderen Mitglieder</li>
          <li>Deine Tipps – bis zum Etappenstart nur für dich sichtbar, danach für alle Mitglieder</li>
        </ul>
        <p>Rechtsgrundlage ist die Teilnahme am Tippspiel (Art. 6 Abs. 1 lit. b DSGVO). Es gibt keine Werbung, kein Tracking und keine Analyse-Cookies.</p>
        <h2>Dienstleister</h2>
        <ul>
          <li>Supabase Inc. (Datenbank und Anmeldung, Serverstandort Frankfurt am Main)</li>
          <li>Google (Versand der Anmelde-Codes über Gmail)</li>
          <li>GitHub Inc. (Bereitstellung der Webseite; dabei werden technisch bedingt IP-Adressen in Server-Logs verarbeitet)</li>
        </ul>
        <h2>Speicherung im Browser</h2>
        <p>Die App speichert deine Anmeldung und Einstellungen (z. B. Hell/Dunkel) im lokalen Speicher deines Browsers. Schriften werden nicht von Drittanbietern geladen.</p>
        <h2>Deine Rechte</h2>
        <p>
          Du hast das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung sowie auf Beschwerde bei einer Aufsichtsbehörde.
          Dein Konto inklusive aller Tipps kannst du jederzeit unter Profil → Konto löschen entfernen.
        </p>
      </article>
    </>
  );
}
