import { useEffect, useState } from 'react';
import type { AssetRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import type { PlayerEncounter, PlayerHandout } from '@/sync/protocol';
import { AssetImage } from '../components/AssetImage';
import { Icon } from '../kit';
import { usePlayerStore } from './playerStore';

// Two short pulses: noticeable in a pocket, not alarming.
const TURN_VIBRATION_MS = [200, 100, 200];

/** Banner while it is this view's character's turn; phones vibrate when the turn starts. */
export function TurnBanner({ encounter }: { encounter: PlayerEncounter }) {
  const sheet = encounter.sheet;
  const mine = sheet !== undefined && encounter.activeCombatantId === sheet.id;
  const turn = mine ? encounter.round : null;
  useEffect(() => {
    if (turn !== null && 'vibrate' in navigator) navigator.vibrate(TURN_VIBRATION_MS);
  }, [turn]);
  return (
    mine && (
      <div className="turn-banner" role="alert">
        <Icon name="play" /> Your turn, {sheet.name}
      </div>
    )
  );
}

function HandoutVideo({ asset, name }: { asset: AssetRef; name: string }) {
  const repository = useAppStore((s) => s.repository);
  const [url, setUrl] = useState<{ path: string; url: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let current = true;
    repository.storage.assetUrl(asset).then(
      (resolved) => current && setUrl({ path: asset.path, url: resolved }),
      (error: unknown) => current && setProblem(error instanceof Error ? error.message : String(error)),
    );
    return () => {
      current = false;
    };
  }, [asset, repository]);
  return problem ? (
    <p className="error-text">
      Cannot play {name}: {problem}
    </p>
  ) : (
    url?.path === asset.path && <video className="handout-media" src={url.url} controls autoPlay playsInline />
  );
}

function HandoutContent({ handout }: { handout: PlayerHandout }) {
  return handout.kind === 'text' ? (
    <div className="handout-text">{handout.text}</div>
  ) : handout.kind === 'video' && handout.asset ? (
    <HandoutVideo asset={handout.asset} name={handout.name} />
  ) : (
    <AssetImage asset={handout.asset} alt={handout.name} className="handout-media" />
  );
}

/** What the DM shows over the map; the player closes it, and the DM's next show opens it again. */
export function HandoutOverlay() {
  const handout = usePlayerStore((s) => s.handout);
  const [closedId, setClosedId] = useState<string | null>(null);
  return (
    handout &&
    handout.id !== closedId && (
      <div className="handout-overlay" role="dialog" aria-label={handout.name}>
        <div className="handout-card">
          <div className="row">
            <strong className="grow">{handout.name}</strong>
            <button onClick={() => setClosedId(handout.id)} aria-label="Close handout">
              <Icon name="close" /> Close
            </button>
          </div>
          <HandoutContent handout={handout} />
        </div>
      </div>
    )
  );
}
