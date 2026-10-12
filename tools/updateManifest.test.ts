import { describe, expect, it } from 'vitest';
import { newestChangelogSection, updateManifest } from './updateManifest';

const CHANGELOG = '# Changelog\r\n\r\n## 0.2.0\r\n\r\n- Auto-update.\r\n- Fixes.\r\n\r\n## 0.1.0\r\n\r\n- First.\r\n';

describe('latest.json for the updater', () => {
  it('takes the release notes from the newest changelog section', () => {
    expect(newestChangelogSection(CHANGELOG)).toBe('- Auto-update.\n- Fixes.');
  });

  it('fails without a changelog section', () => {
    expect(() => newestChangelogSection('# Changelog\n')).toThrow(/no "## " section/);
  });

  it('points the Windows platform at the release asset and embeds the signature', () => {
    const manifest = updateManifest({
      version: '0.2.0',
      notes: '- Auto-update.',
      pubDate: new Date('2026-10-12T18:30:00Z'),
      signature: 'dW50cnVzdGVkIGNvbW1lbnQ=\n',
      installer: 'Fogwarden_0.2.0_x64-setup-abc1234.exe',
    });
    expect(manifest).toEqual({
      version: '0.2.0',
      notes: '- Auto-update.',
      pub_date: '2026-10-12T18:30:00.000Z',
      platforms: {
        'windows-x86_64': {
          signature: 'dW50cnVzdGVkIGNvbW1lbnQ=',
          url: 'https://github.com/SunYKnight/Fogwarden/releases/download/v0.2.0/Fogwarden_0.2.0_x64-setup-abc1234.exe',
        },
      },
    });
  });
});
