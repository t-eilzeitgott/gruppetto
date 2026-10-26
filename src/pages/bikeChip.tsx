import { bikeById } from '../game/bikes';
import { Link, cx } from '../ui/kit';
import { Icon } from '../ui/Icon';
import type { Bikes } from '../ui/useBikes';

/** Startbildschirm der Spiele: gewähltes Rad, Weg in die Radgarage */
export function BikeChip({ bikes }: { bikes: Bikes }) {
  const spec = bikeById(bikes.current);
  const fresh = bikes.fresh.length > 0;
  return (
    <Link to="/spiel/garage" className={cx('bike-chip', fresh && 'is-fresh')} ariaLabel={`Dein Rad: ${spec.name}. Radgarage öffnen${fresh ? ' – neues Rad freigeschaltet' : ''}`}>
      <span className="bike-chip__icon" aria-hidden="true"><Icon name="bike" size={18} /></span>
      <span className="bike-chip__text">
        <span className="bike-chip__label">Dein Rad</span>
        <strong>{spec.name}</strong>
      </span>
      {fresh ? <span className="game-new">Neu</span> : null}
      <span className="bike-chip__go">Garage<Icon name="chevron" size={14} /></span>
    </Link>
  );
}

/** Ergebnis: kleiner Hinweis, wenn ein Rad neu freigeschaltet ist */
export function NewBikePill({ bikes }: { bikes: Bikes }) {
  if (!bikes.fresh.length) return null;
  const spec = bikeById(bikes.fresh[bikes.fresh.length - 1]);
  return (
    <Link to="/spiel/garage" className="bike-pill" ariaLabel={`Neues Rad freigeschaltet: ${spec.name}. In der Radgarage ansehen`}>
      <Icon name="bike" size={14} />
      <span>Neues Rad!</span>
    </Link>
  );
}
