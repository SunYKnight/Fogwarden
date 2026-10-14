import { useState } from 'react';
import type { Campaign, OnboardingStep } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { Button, Icon, type IconName } from '../kit';
import { openNewCampaign } from '../library/CampaignLibrary';
import { openDndApiImport } from '../library/compendiumUi';
import { openNewMapWizard } from '../library/NewMapWizard';
import { dismissFirstSteps, openSampleEncounter } from './onboarding';
import { SAMPLE_CAMPAIGN_ID } from './sampleContent';

/** Ticked steps live in the settings; players and campaign are read from the library. */
type StepId = OnboardingStep | 'players' | 'campaign';

interface StepSpec {
  id: StepId;
  icon: IconName;
  title: string;
  text: string;
  action: string;
  /** Offered, but the card counts and closes without it. */
  optional?: boolean;
}

/** A new DM's order of work: where data lives, rules content, the party, its campaign, then maps. */
const STEPS: StepSpec[] = [
  {
    id: 'dataFolder',
    icon: 'folder',
    title: 'Choose data folder',
    text: 'Where your maps, creatures and campaigns are stored; pick a synced folder to share them.',
    action: 'Open settings',
  },
  {
    id: 'srdData',
    icon: 'download',
    title: 'Download the SRD rules content',
    text:
      'Monsters, spells, items and area templates from the free D&D 5e API; monster pictures are optional ' +
      '(about 580 MB).',
    action: 'Download…',
  },
  {
    id: 'players',
    icon: 'user',
    title: 'Add the player characters',
    text: 'Import them from Aurora Builder or create them in Compendium > Players.',
    action: 'Open players',
  },
  {
    id: 'campaign',
    icon: 'swords',
    title: 'Create a campaign',
    text: 'It holds the party, the encounters, the journal and the quests of one group.',
    action: 'New campaign…',
  },
  {
    id: 'mapFromImage',
    icon: 'image',
    title: 'Create a map from an image',
    text: 'Pick a battlemap image and line up its grid in three steps.',
    action: 'New map…',
  },
  {
    id: 'sampleEncounter',
    icon: 'play',
    title: 'Try the sample encounter',
    text:
      'Optional: four goblins ambush two heroes at a ruined chapel, part of a sample campaign with journal ' +
      'and quests.',
    action: 'Open sample',
    optional: true,
  },
];

const REQUIRED = STEPS.filter((s) => !s.optional);

/** Next actions for a new user; hidden once dismissed or all required steps are done. */
export function FirstSteps({ campaigns }: { campaigns: readonly Campaign[] | null }) {
  const onboarding = useAppStore((s) => s.settings?.onboarding);
  const reportError = useAppStore((s) => s.reportError);
  const hasPlayers = useLibraryStore((s) => s.listings.creature.entries.some((e) => e.doc.kind === 'player'));
  const [busy, setBusy] = useState(false);

  // Settings > Data ticks the folder step once a folder is chosen there.
  const actions: Record<StepId, () => Promise<void>> = {
    dataFolder: async () => useAppStore.getState().navigate({ page: 'settings', section: 'data' }),
    srdData: async () => openDndApiImport(),
    players: async () => useAppStore.getState().navigate({ page: 'compendium', tab: 'players' }),
    campaign: async () => openNewCampaign(),
    mapFromImage: async () => openNewMapWizard(),
    sampleEncounter: async () => {
      setBusy(true);
      try {
        await openSampleEncounter();
      } finally {
        setBusy(false);
      }
    },
  };

  const done: Record<StepId, boolean> | null =
    onboarding && campaigns
      ? { ...onboarding.done, players: hasPlayers, campaign: campaigns.some((c) => c.id !== SAMPLE_CAMPAIGN_ID) }
      : null;
  const remaining = done ? REQUIRED.filter((s) => !done[s.id]).length : 0;
  return onboarding && done && !onboarding.dismissed && remaining > 0 ? (
    <section className="home-card first-steps" aria-label="First steps">
      <div className="home-card-head">
        <h2>First steps</h2>
        <span className="muted">
          {REQUIRED.length - remaining} of {REQUIRED.length} done
        </span>
        <div className="spacer" />
        <Button
          icon="close"
          label="Hide first steps"
          variant="ghost"
          onClick={() => dismissFirstSteps().catch(reportError)}
        />
      </div>
      <ol className="first-steps-list">
        {STEPS.map((step) => (
          <li key={step.id} className={done[step.id] ? 'done' : ''}>
            <span className="first-step-icon">
              <Icon name={done[step.id] ? 'check' : step.icon} />
            </span>
            <div className="first-step-text">
              <strong>{step.title}</strong>
              <span className="muted">{done[step.id] ? 'Done' : step.text}</span>
            </div>
            <Button
              label={step.action}
              variant={done[step.id] ? 'ghost' : 'default'}
              disabled={busy}
              onClick={() => actions[step.id]().catch(reportError)}
            />
          </li>
        ))}
      </ol>
    </section>
  ) : null;
}
