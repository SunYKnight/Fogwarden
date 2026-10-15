import { describe, expect, it } from 'vitest';
import {
  assetName,
  mergeManifests,
  newestChangelogSection,
  platformInstallers,
  updateManifest,
  type UpdateManifest,
} from './updateManifest';

const CHANGELOG = '# Changelog\r\n\r\n## 0.2.0\r\n\r\n- Auto-update.\r\n- Fixes.\r\n\r\n## 0.1.0\r\n\r\n- First.\r\n';
const DOWNLOAD = 'https://github.com/SunYKnight/Fogwarden/releases/download/v0.2.0';

function manifest(pubDate: string, platforms: UpdateManifest['platforms']): UpdateManifest {
  return { version: '0.2.0', notes: '- Auto-update.', pub_date: pubDate, platforms };
}

const WINDOWS = manifest('2026-10-12T18:30:00.000Z', {
  'windows-x86_64': { signature: 'd2lu', url: `${DOWNLOAD}/Fogwarden_0.2.0_x64-setup-abc1234.exe` },
});
const LINUX = manifest('2026-10-12T18:41:00.000Z', {
  'linux-x86_64': { signature: 'YXBw', url: `${DOWNLOAD}/Fogwarden_0.2.0_amd64-abc1234.AppImage` },
  'linux-x86_64-deb': { signature: 'ZGVi', url: `${DOWNLOAD}/Fogwarden_0.2.0_amd64-abc1234.deb` },
});

describe('latest.json for the updater', () => {
  it('takes the release notes from the newest changelog section', () => {
    expect(newestChangelogSection(CHANGELOG, '0.2.0')).toBe('- Auto-update.\n- Fixes.');
  });

  it('fails without a changelog section', () => {
    expect(() => newestChangelogSection('# Changelog\n', '0.2.0')).toThrow(/no "## " section/);
  });

  it('fails unless the newest section is the released version', () => {
    const unreleased = CHANGELOG.replace('## 0.2.0', '## Unreleased');
    expect(() => newestChangelogSection(unreleased, '0.2.0')).toThrow(/"## Unreleased"; rename it to "## 0.2.0"/);
    expect(() => newestChangelogSection(CHANGELOG, '0.3.0')).toThrow(/rename it to "## 0.3.0"/);
  });

  it('names the installers Tauri builds per platform', () => {
    expect(platformInstallers('windows-x86_64', 'Fogwarden', '0.2.0')).toEqual([
      { folder: 'nsis', file: 'Fogwarden_0.2.0_x64-setup.exe', target: 'windows-x86_64' },
    ]);
    expect(platformInstallers('linux-x86_64', 'Fogwarden', '0.2.0')).toEqual([
      { folder: 'appimage', file: 'Fogwarden_0.2.0_amd64.AppImage', target: 'linux-x86_64' },
      { folder: 'deb', file: 'Fogwarden_0.2.0_amd64.deb', target: 'linux-x86_64-deb' },
    ]);
  });

  it('puts the revision before the extension of a release asset', () => {
    expect(assetName('Fogwarden_0.2.0_x64-setup.exe', 'abc1234')).toBe('Fogwarden_0.2.0_x64-setup-abc1234.exe');
    expect(assetName('Fogwarden_0.2.0_amd64.AppImage', 'abc1234-dirty')).toBe(
      'Fogwarden_0.2.0_amd64-abc1234-dirty.AppImage',
    );
  });

  it('points the Windows platform at the release asset and embeds the signature', () => {
    const windows = updateManifest({
      version: '0.2.0',
      notes: '- Auto-update.',
      pubDate: new Date('2026-10-12T18:30:00Z'),
      assets: [{ target: 'windows-x86_64', asset: 'Fogwarden_0.2.0_x64-setup-abc1234.exe', signature: 'd2lu\n' }],
    });
    expect(windows).toEqual(WINDOWS);
  });

  it('gives the AppImage and the .deb an updater entry each on Linux', () => {
    const linux = updateManifest({
      version: '0.2.0',
      notes: '- Auto-update.',
      pubDate: new Date('2026-10-12T18:41:00Z'),
      assets: [
        { target: 'linux-x86_64', asset: 'Fogwarden_0.2.0_amd64-abc1234.AppImage', signature: 'YXBw\n' },
        { target: 'linux-x86_64-deb', asset: 'Fogwarden_0.2.0_amd64-abc1234.deb', signature: 'ZGVi' },
      ],
    });
    expect(linux).toEqual(LINUX);
  });
});

describe('merging the platform manifests', () => {
  it('joins the platforms and keeps the newest build date', () => {
    expect(mergeManifests([LINUX, WINDOWS])).toEqual({
      ...WINDOWS,
      pub_date: LINUX.pub_date,
      platforms: { ...WINDOWS.platforms, ...LINUX.platforms },
    });
  });

  it('returns a single manifest unchanged', () => {
    expect(mergeManifests([WINDOWS])).toEqual(WINDOWS);
  });

  it('fails without manifests', () => {
    expect(() => mergeManifests([])).toThrow(/No platform manifests/);
  });

  it('fails for builds of different versions', () => {
    expect(() => mergeManifests([WINDOWS, { ...LINUX, version: '0.2.1' }])).toThrow(/different versions: 0.2.0, 0.2.1/);
  });

  it('fails for builds with different release notes', () => {
    expect(() => mergeManifests([WINDOWS, { ...LINUX, notes: '- Other.' }])).toThrow(/different release notes/);
  });
});
