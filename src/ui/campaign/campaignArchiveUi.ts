import { isTauri } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import {
  CAMPAIGN_ARCHIVE_EXTENSION,
  CampaignExistsError,
  exportCampaign,
  importCampaign,
  readCampaignZip,
  type CampaignImport,
} from '@/data/campaignArchive';
import { writeFileBytes } from '@/data/tauriStorage';
import { useAppStore } from '@/state/appStore';
import { useLibraryStore } from '@/state/libraryStore';
import { choiceDialog } from '../kit';
import { download } from '../library/mapExport';

/** Asks where to save (the browser downloads instead) and writes the campaign archive there. */
export async function exportCampaignToZip(campaignId: string): Promise<void> {
  const { repository, notify } = useAppStore.getState();
  const fileName = `${campaignId}${CAMPAIGN_ARCHIVE_EXTENSION}`;
  const target = isTauri()
    ? await save({ defaultPath: fileName, filters: [{ name: 'Fogwarden campaign', extensions: ['zip'] }] })
    : fileName;
  if (target !== null) {
    const bytes = await exportCampaign(repository, campaignId, new Date());
    if (isTauri()) {
      await writeFileBytes(target, bytes);
    } else {
      download(fileName, bytes);
    }
    notify(`Exported "${target.split(/[\\/]/).at(-1)}"`);
  }
}

/**
 * Imports a campaign archive and opens the campaign. A campaign with the same id is replaced or kept, as the
 * DM picks; packs the campaign needs but that are not installed are named afterwards.
 */
export async function importCampaignZip(bytes: Uint8Array): Promise<void> {
  const { repository, notify, navigate, forgetEncounter } = useAppStore.getState();
  const archive = await readCampaignZip(bytes);
  let imported: CampaignImport | null;
  try {
    imported = await importCampaign(repository, archive, 'fail');
  } catch (error) {
    if (!(error instanceof CampaignExistsError)) {
      throw error;
    }
    const { id, name } = archive.manifest.campaign;
    const choice = await choiceDialog({
      title: 'Campaign exists',
      message:
        `A campaign with the id "${id}" exists already. Replacing it deletes its encounters, journal, people, ` +
        `quests and notes for those of the imported "${name}"; a copy keeps both.`,
      confirmLabel: 'Replace campaign',
      danger: true,
      alternativeLabel: 'Import as copy',
    });
    if (choice === 'confirm') {
      // The Play screen must not save its copy of a replaced encounter back.
      await forgetEncounter({ campaignId: id });
    }
    imported =
      choice === 'cancel' ? null : await importCampaign(repository, archive, choice === 'confirm' ? 'replace' : 'copy');
  }
  if (imported) {
    await useLibraryStore.getState().refreshAll();
    navigate({ page: 'campaigns', campaignId: imported.id });
    notify(`Imported the campaign "${imported.name}"`);
    if (imported.missingPacks.length > 0) {
      const names = imported.missingPacks.map((p) => `"${p.name}"`).join(', ');
      notify(
        `"${imported.name}" uses content packs that are not installed: ${names}. Import them under ` +
          'Compendium › Packs, or its creatures, maps and pictures from them stay missing.',
        'info',
      );
    }
  }
}

/** Lets the DM pick a campaign archive and imports it. */
export function pickCampaignZip(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.zip,application/zip';
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      file
        .arrayBuffer()
        .then((buffer) => importCampaignZip(new Uint8Array(buffer)))
        .catch(useAppStore.getState().reportError);
    }
  };
  input.click();
}
