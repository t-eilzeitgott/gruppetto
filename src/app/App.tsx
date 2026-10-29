import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useAuthUser, useMe, useMembers, useSelectedTour, useTourData } from './hooks';
import { endIntro, introReady } from './intro';
import { startWarm } from './warm';
import { stageOfDay } from '../game/abfahrt/sprintRiders';
import { berlinDayKey } from '../game/abfahrt/rng';
import { refreshOnFocus, resetCache } from './query';
import { useRoute } from './router';
import { AppContext } from './context';
import { setTourTheme } from './theme';
import { LIVE_CONFIGURED, source } from './config';
import { Shell } from '../ui/Shell';
import { Button, Empty, ErrorBox, ToastHost } from '../ui/kit';
import { Login } from '../pages/Login';
import { Join } from '../pages/Join';
import { Home, HomeHead } from '../pages/Home';
import { Stages } from '../pages/Stages';
import { StageDetail } from '../pages/StageDetail';
import { TipPicker } from '../pages/TipPicker';
import { Bonus, BonusPicker } from '../pages/Bonus';
import { Leaderboard } from '../pages/Leaderboard';
import { Player } from '../pages/Player';
import { RiderPage } from '../pages/Rider';
import { RidersPage } from '../pages/Riders';
import { ClimbsPage } from '../pages/Climbs';
import { Suspense } from 'react';
import { AkkuPage, BergPage, GamePage, GaragePage, JourneyPage, SprintPage, WorldEditorPage, ZeitfahrenPage, GpuTestPage, RaceGpuPage } from './pages';
import { AppSkeleton, RouteSkeleton } from '../ui/skeleton';
import { DemoBanner } from '../ui/Shell';
import { PageBoundary } from '../ui/PageBoundary';

import { Profile } from '../pages/Profile';
import { Datenschutz, Impressum } from '../pages/Legal';
import { AdminHome } from '../pages/admin/AdminHome';
import { AdminTours } from '../pages/admin/AdminTours';
import { AdminStages } from '../pages/admin/AdminStages';
import { AdminRiders } from '../pages/admin/AdminRiders';
import { AdminResults } from '../pages/admin/AdminResults';
import { AdminBonus } from '../pages/admin/AdminBonus';
import { AdminMembers } from '../pages/admin/AdminMembers';
import { AdminSync } from '../pages/admin/AdminSync';
import { BONUS_CATEGORIES, type BonusCategory, type Profile as ProfileT, type Tour as TourT } from '../lib/types';

export function App() {
  const userId = useAuthUser();
  const me = useMe();
  const route = useRoute();

  useEffect(() => {
    refreshOnFocus();
  }, []);

  useEffect(() => {
    if (!userId) resetCache();
  }, [userId]);


  const first = route.parts[0];
  if (first === 'impressum' || first === 'datenschutz') {
    return (
      <div className="standalone">
        <main className="main">{first === 'impressum' ? <Impressum /> : <Datenschutz />}</main>
      </div>
    );
  }

  // Intro nur für angemeldete Mitglieder: Anmeldung, Fehler und Beitritt beenden es sofort
  const plain = !userId || !!me.error || (!me.loading && (!me.data || !me.data.is_member || !me.data.display_name));
  useEffect(() => {
    if (plain) endIntro();
  }, [plain]);

  let content;
  if (!userId) content = <Login />;
  else if (me.error) {
    content = (
      <div className="auth">
        <ErrorBox error={me.error} onRetry={me.reload} />
        <Button variant="secondary" onClick={() => source.signOut()}>Abmelden</Button>
      </div>
    );
  } else if (me.loading) content = <AppSkeleton parts={route.parts} banner={source.mode === 'demo' ? <DemoBanner live={LIVE_CONFIGURED} /> : null} />;
  else if (!me.data || !me.data.is_member || !me.data.display_name) content = <Join />;
  else content = <MemberApp me={me.data} />;

  return (
    <>
      {content}
      <ToastHost />
    </>
  );
}

function MemberApp({ me }: { me: ProfileT }) {
  const { tour, tours, loading, error } = useSelectedTour();
  const route = useRoute();
  const [first, second] = route.parts;

  // Farbe der Rundfahrt vor dem Zeichnen setzen (kein Farbwechsel nach dem ersten Bild)
  useLayoutEffect(() => {
    if (!loading) setTourTheme(tour?.theme ?? null);
  }, [tour?.theme, loading]);

  const ctx = useMemo(() => ({ me, tour, tours }), [me, tour, tours]);
  // andere Seite als die Startseite (z. B. Link aufs Spiel): sobald der Rahmen steht, darf das Intro gehen
  useEffect(() => {
    if (!loading && first !== undefined) introReady('content');
  }, [loading, first]);
  const fullScreen = first === 'tipp' || first === 'spiel' || (first === 'bonus' && !!second) || (first === 'admin' && (second === 'akku' || second === 'welt' || second === 'gpu' || second === 'abfahrt'));

  let page;
  if (error) page = <ErrorBox error={error} />;
  else if (loading) page = <RouteSkeleton parts={route.parts} head={first === undefined ? <HomeHead me={me} /> : undefined} />;
  else {
    switch (first) {
      case undefined:
        page = <Home />;
        break;
      case 'etappen':
        page = <Stages />;
        break;
      case 'etappe':
        page = <StageDetail id={Number(second)} />;
        break;
      case 'tipp':
        page = <TipPicker id={Number(second)} />;
        break;
      case 'bonus':
        page = second
          ? (BONUS_CATEGORIES.includes(second as BonusCategory) ? <BonusPicker category={second as BonusCategory} /> : <NotFound />)
          : <Bonus />;
        break;
      case 'rangliste':
        page = <Leaderboard />;
        break;
      case 'spieler':
        page = <Player id={second ?? ''} />;
        break;
      case 'fahrer':
        page = second ? <RiderPage id={Number(second)} /> : <RidersPage />;
        break;
      case 'anstiege':
        page = <ClimbsPage />;
        break;
      case 'spiel':
        page = <Suspense fallback={<RouteSkeleton parts={route.parts} />}>{second === 'sprint' ? <SprintPage /> : second === 'berg' ? <BergPage /> : second === 'zeitfahren' ? <ZeitfahrenPage /> : second === 'garage' ? <GaragePage /> : second === 'reise' ? <JourneyPage /> : <GamePage />}</Suspense>;
        break;
      case 'profil':
        page = <Profile />;
        break;
      case 'admin':
        page = me.is_admin ? <AdminRouter section={second} /> : <NotFound />;
        break;
      default:
        page = <NotFound />;
    }
  }

  return (
    <AppContext.Provider value={ctx}>
      <Shell hideTabBar={fullScreen} isAdmin={me.is_admin}><PageBoundary key={route.path}>{page}</PageBoundary></Shell>
      {loading ? null : <WarmUp me={me} tour={tour} />}
    </AppContext.Provider>
  );
}

/**
 * Vorwärmen beim Start: sobald Rundfahrt und Mitglieder da sind (aus dem Zwischenspeicher sofort), sonst
 * nach kurzer Wartezeit mit dem, was da ist – die Welt des ersten Minispiels entsteht unsichtbar.
 */
function WarmUp({ me, tour }: { me: ProfileT; tour: TourT | null }) {
  const data = useTourData(tour).data;
  const members = useMembers().data;
  const [late, setLate] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setLate(true), 1200);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (tour && !(data && members) && !late) return;
    const names = (members ?? []).map((m) => m.display_name ?? '').filter(Boolean);
    startWarm({ me, tour, data, names, kind: data ? stageOfDay(data.stages, berlinDayKey())?.kind ?? null : null });
  }, [me, tour, data, members, late]);
  return null;
}

function AdminRouter({ section }: { section?: string }) {
  switch (section) {
    case undefined: return <AdminHome />;
    case 'rundfahrten': return <AdminTours />;
    case 'etappen': return <AdminStages />;
    case 'startliste': return <AdminRiders />;
    case 'ergebnis': return <AdminResults />;
    case 'bonus': return <AdminBonus />;
    case 'mitglieder': return <AdminMembers />;
    case 'automatik': return <AdminSync />;
    case 'akku': return <Suspense fallback={<RouteSkeleton parts={['spiel', 'akku']} />}><AkkuPage /></Suspense>;
    case 'welt': return <Suspense fallback={<RouteSkeleton parts={['spiel', 'welt']} />}><WorldEditorPage /></Suspense>;
    case 'gpu': return <Suspense fallback={<RouteSkeleton parts={['spiel', 'gpu']} />}><GpuTestPage /></Suspense>;
    case 'abfahrt': return <Suspense fallback={<RouteSkeleton parts={['spiel', 'abfahrt']} />}><RaceGpuPage /></Suspense>;
    default: return <NotFound />;
  }
}

function NotFound() {
  return <Empty icon="flag" title="Seite nicht gefunden">Diese Seite gibt es nicht (mehr).</Empty>;
}
