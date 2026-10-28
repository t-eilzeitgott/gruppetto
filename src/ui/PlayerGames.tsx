/**
 * Spielerprofil: Allzeit-Bestwerte in den Minispielen.
 * Grundlage ist die Saison-Bestenliste (alle gespeicherten Läufe, ohne Zeitfilter) –
 * die Läufe liegen dauerhaft in der Datenbank, der Wert bleibt also über Tage hinweg erhalten.
 */
import { useQuery } from '../app/query';
import { source } from '../app/config';
import type { GameBest } from '../data/source';
import { GAMES, fmtBest, type GameInfo } from '../game/games';
import { Link } from './kit';
import { GameBadge } from './GameIcon';

const nf = (n: number) => Math.round(n).toLocaleString('de-DE');

interface Entry { game: GameInfo; best: GameBest | null; place: number; players: number }

export function PlayerGames({ userId, isMe }: { userId: string; isMe: boolean }) {
  // gleiche Cache-Schlüssel wie in den Spielen – nach einem Lauf wird automatisch neu geladen
  const boards = GAMES.map((g) => ({
    game: g,
    // eslint-disable-next-line react-hooks/rules-of-hooks -- GAMES ist konstant
    q: useQuery<GameBest[]>(`game:${g.id}:season`, () => source.gameLeaderboard(g.id)),
  }));

  if (boards.every((b) => b.q.loading)) return null;

  const entries: Entry[] = boards.map(({ game, q }) => {
    const rows = q.data ?? [];
    const idx = rows.findIndex((r) => r.user_id === userId);
    return { game, best: idx >= 0 ? rows[idx] : null, place: idx + 1, players: rows.length };
  });
  const played = entries.filter((e) => e.best && e.best.runs > 0);
  // Allzeit-Highscore nur aus den Punktespielen (Zeiten sind keine Punkte); wer nur Zeitfahren fährt, zeigt seine Bestzeit
  const points = played.filter((e) => e.game.scoring === 'points');
  const top = (points.length ? points : played).reduce<Entry | null>((a, e) => (!a || e.best!.best > a.best!.best ? e : a), null);
  const runs = played.reduce((n, e) => n + e.best!.runs, 0);

  return (
    <section aria-labelledby="player-games">
      <h2 id="player-games" className="section-title">Minispiele</h2>
      {!top ? (
        <p className="muted">{isMe ? 'Du bist noch keinen Lauf gefahren.' : 'Noch kein Lauf gefahren.'}</p>
      ) : (
        <>
          <div className="pg-best">
            <GameBadge game={top.game.id} size={40} />
            <div className="pg-best__main">
              <span className="pg-best__label">{top.game.scoring === 'time' ? 'Bestzeit' : 'Allzeit-Highscore'}</span>
              <strong className="pg-best__score">{fmtBest(top.game, top.best!.best)}</strong>
              <span className="pg-best__sub">{top.game.name} · {top.place}. von {top.players} · {runs === 1 ? '1 Lauf' : `${nf(runs)} Läufe`} insgesamt</span>
            </div>
          </div>
          <ul className="list">
            {entries.map((e) => (
              <li key={e.game.id}>
                <Link to={e.game.path} className="tip-row">
                  <span className="pg-row__icon"><GameBadge game={e.game.id} size={26} /></span>
                  <span className="tip-row__main">
                    <span>{e.game.name}</span>
                    <span className="muted small pg-row__sub">
                      {e.best ? `${e.place}. von ${e.players} · ${e.best.runs === 1 ? '1 Lauf' : `${nf(e.best.runs)} Läufe`}` : 'noch nicht gefahren'}
                    </span>
                  </span>
                  <span className={e.best ? 'points' : 'points muted'}>{e.best ? fmtBest(e.game, e.best.best) : '–'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
