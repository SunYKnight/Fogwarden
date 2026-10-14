import type { Onboarding, OnboardingStep } from '@/core/model';
import { useAppStore } from '@/state/appStore';
import { ensureSampleCampaign } from './sampleCampaign';
import { SAMPLE_CAMPAIGN_ID, SAMPLE_ENCOUNTER_ID } from './sampleContent';

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

/** Creates the missing parts of the sample campaign, then shows its goblin ambush on the Play page. */
export async function openSampleEncounter(): Promise<void> {
  const { repository, openEncounter } = useAppStore.getState();
  await ensureSampleCampaign(repository);
  await completeOnboardingStep('sampleEncounter');
  await openEncounter({ campaignId: SAMPLE_CAMPAIGN_ID, encounterId: SAMPLE_ENCOUNTER_ID });
}
