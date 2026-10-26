import { useEffect, useMemo } from 'react';
import { useAuthUser, useMe, useSelectedTour } from './hooks';
import { refreshOnFocus, resetCache } from './query';
import { useRoute } from './router';
import { AppContext } from './context';
import { setTourTheme } from './theme';
import { source } from './config';
import { Shell } from '../ui/Shell';
import { Button, Empty, ErrorBox, Loading, ToastHost } from '../ui/kit';
import { Login } from '../pages/Login';
import { Join } from '../pages/Join';
import { Home } from '../pages/Home';
import { Stages } from '../pages/Stages';
import { StageDetail } from '../pages/StageDetail';
import { TipPicker } from '../pages/TipPicker';
import { Bonus, BonusPicker } from '../pages/Bonus';
import { Leaderboard } from '../pages/Leaderboard';
import { Player } from '../pages/Player';
import { RiderPage } from '../pages/Rider';
import { RidersPage } from '../pages/Riders';
import { ClimbsPage } from '../pages/Climbs';
import { lazy, Suspense } from 'react';

// Das Spiel (mit 3D-Grafik) wird erst beim Öffnen geladen
const GamePage = lazy(() => import('../pages/Game').then((m) => ({ default: m.GamePage })));
const SprintPage = lazy(() => import('../pages/Sprint').then((m) => ({ default: m.SprintPage })));
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
import { BONUS_CATEGORIES, type BonusCategory, type Profile as ProfileT } from '../lib/types';

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

  let content;
  if (!userId) content = <Login />;
  else if (me.error) {
    content = (
      <div className="auth">
        <ErrorBox error={me.error} onRetry={me.reload} />
        <Button variant="secondary" onClick={() => source.signOut()}>Abmelden</Button>
      </div>
    );
  } else if (me.loading) content = <div className="auth"><Loading /></div>;
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

  useEffect(() => {
    setTourTheme(tour?.theme ?? null);
  }, [tour?.theme]);

  const ctx = useMemo(() => ({ me, tour, tours }), [me, tour, tours]);
  const fullScreen = first === 'tipp' || first === 'spiel' || (first === 'bonus' && !!second);

  let page;
  if (error) page = <ErrorBox error={error} />;
  else if (loading) page = <Loading />;
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
        page = <Suspense fallback={<Loading />}>{second === 'sprint' ? <SprintPage /> : <GamePage />}</Suspense>;
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
      <Shell hideTabBar={fullScreen} isAdmin={me.is_admin}>{page}</Shell>
    </AppContext.Provider>
  );
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
    default: return <NotFound />;
  }
}

function NotFound() {
  return <Empty icon="flag" title="Seite nicht gefunden">Diese Seite gibt es nicht (mehr).</Empty>;
}
