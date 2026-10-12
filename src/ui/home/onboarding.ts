import type { Onboarding, OnboardingStep } from '@/core/model';
import { campaignPath, encounterPath } from '@/data/repository';
import { useAppStore } from '@/state/appStore';
import {
  createSampleCampaign,
  createSampleEncounter,
  SAMPLE_CAMPAIGN_ID,
  SAMPLE_ENCOUNTER_ID,
  SAMPLE_GOBLIN,
  SAMPLE_MAP,
} from './sampleContent';

async function updateOnboarding(change: (onboarding: Onboarding) => Onboarding): Promise<void> {
  const { settings, setSettings } = useAppStore.getState();
  if (!settings) {
    throw new Error('Settings are not loaded yet');
  }
  await setSettings({ ...settings, onboarding: change(settings.onboarding) });
}

/** Ticks a first step on the Home page; no write when it is already done. */
export async function completeOnboardingStep(step: OnboardingStep): Promise<void> {
  if (!useAppStore.getState().settings?.onboarding.done[step]) {
    await updateOnboarding((o) => ({ ...o, done: { ...o.done, [step]: true } }));
  }
}

export function dismissFirstSteps(): Promise<void> {
  return updateOnboarding((o) => ({ ...o, dismissed: true }));
}

/** Creates the sample campaign and encounter on first use, then shows the encounter on the Play page. */
export async function openSampleEncounter(): Promise<void> {
  const { repository, openEncounter } = useAppStore.getState();
  if (!(await repository.storage.exists('data', campaignPath(SAMPLE_CAMPAIGN_ID)))) {
    await repository.saveCampaign(createSampleCampaign());
  }
  if (!(await repository.storage.exists('data', encounterPath(SAMPLE_CAMPAIGN_ID, SAMPLE_ENCOUNTER_ID)))) {
    const [map, goblin] = await Promise.all([
      repository.load('map', SAMPLE_MAP),
      repository.load('creature', SAMPLE_GOBLIN),
    ]);
    await repository.saveEncounter(createSampleEncounter(map, goblin));
  }
  await completeOnboardingStep('sampleEncounter');
  await openEncounter({ campaignId: SAMPLE_CAMPAIGN_ID, encounterId: SAMPLE_ENCOUNTER_ID });
}
