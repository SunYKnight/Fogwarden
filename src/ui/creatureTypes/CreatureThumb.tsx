import { creatureIconOf } from '@/core/creatureTypeIcon';
import { creaturePortrait, type Creature } from '@/core/model';
import { AssetImage } from '../components/AssetImage';
import { CREATURE_ICON_PATHS, CREATURE_ICON_VIEW } from './creatureIconPaths';

interface CreatureThumbProps {
  creature: Pick<Creature, 'image' | 'token' | 'type' | 'subtype' | 'tags'>;
  /** Sizes the picture and the icon alike. */
  className: string;
  /** Alternative text of a picture; the icon is labelled with the creature type. */
  alt?: string;
}

/** The creature's own picture, else the icon of its creature type. */
export function CreatureThumb({ creature, className, alt = '' }: CreatureThumbProps) {
  const portrait = creaturePortrait(creature);
  const icon = creatureIconOf(creature);
  return portrait ? (
    <AssetImage asset={portrait} alt={alt} className={className} />
  ) : (
    <svg
      className={`creature-type-icon ${className}`}
      viewBox={`0 0 ${CREATURE_ICON_VIEW} ${CREATURE_ICON_VIEW}`}
      role="img"
      aria-label={icon}
    >
      <title>{icon}</title>
      <path d={CREATURE_ICON_PATHS[icon]} fill="currentColor" />
    </svg>
  );
}
