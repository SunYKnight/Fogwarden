import { z } from 'zod';

/** GitHub repository whose releases the installed app's updater reads. */
export const RELEASE_REPOSITORY = 'https://github.com/SunYKnight/Fogwarden';

/** Platforms a release is built on, named by their key in `latest.json`. */
export const RELEASE_PLATFORMS = ['windows-x86_64', 'linux-x86_64'] as const;
export type ReleasePlatform = (typeof RELEASE_PLATFORMS)[number];

// The updater looks up `<os>-<arch>-<bundle type>` before `<os>-<arch>`, so a
// .deb install would otherwise download the AppImage and refuse to install it.
const UPDATER_TARGETS = [...RELEASE_PLATFORMS, 'linux-x86_64-deb'] as const;
export type UpdaterTarget = (typeof UPDATER_TARGETS)[number];

/** The updater's `latest.json` as tauri-plugin-updater reads it (static JSON format). */
export const updateManifestSchema = z.object({
  version: z.string(),
  notes: z.string(),
  pub_date: z.string(),
  platforms: z.partialRecord(z.enum(UPDATER_TARGETS), z.object({ signature: z.string(), url: z.string() })),
});
export type UpdateManifest = z.infer<typeof updateManifestSchema>;

/** An installer `tauri build` writes, in its folder under `target/release/bundle/`. */
export interface Installer {
  folder: string;
  file: string;
  target: UpdaterTarget;
}

/** A signed installer as uploaded to the release. */
export interface ReleaseAsset {
  target: UpdaterTarget;
  /** File name in the release. */
  asset: string;
  /** Contents of the installer's `.sig` file. */
  signature: string;
}

export interface ManifestInput {
  version: string;
  notes: string;
  pubDate: Date;
  assets: ReleaseAsset[];
}

/** The installers a release build writes on `platform`, named as Tauri names them. */
export function platformInstallers(platform: ReleasePlatform, productName: string, version: string): Installer[] {
  const installers: Record<ReleasePlatform, Installer[]> = {
    'windows-x86_64': [{ folder: 'nsis', file: `${productName}_${version}_x64-setup.exe`, target: 'windows-x86_64' }],
    'linux-x86_64': [
      { folder: 'appimage', file: `${productName}_${version}_amd64.AppImage`, target: 'linux-x86_64' },
      { folder: 'deb', file: `${productName}_${version}_amd64.deb`, target: 'linux-x86_64-deb' },
    ],
  };
  return installers[platform];
}

/** Release asset name of an installer: its name with the build's revision before the extension. */
export function assetName(installer: string, revision: string): string {
  return installer.replace(/(\.[^.]+)$/, `-${revision}$1`);
}

/** The `latest.json` a single platform's build writes next to its installers. */
export function platformManifestFile(platform: ReleasePlatform): string {
  return `latest-${platform}.json`;
}

/** Download URL of an asset of the release tagged `v<version>`. */
export function releaseAssetUrl(version: string, fileName: string): string {
  return `${RELEASE_REPOSITORY}/releases/download/v${version}/${encodeURIComponent(fileName)}`;
}

/**
 * Body of the first `## ` section of a changelog, without its heading. The heading must name `version`, so an
 * `Unreleased` section never ships as release notes.
 */
export function newestChangelogSection(changelog: string, version: string): string {
  const [, heading, body] = changelog.replace(/\r\n/g, '\n').split(/^## (.*)$/m);
  if (heading === undefined || body === undefined) {
    throw new Error('The changelog has no "## " section for the release notes');
  }
  if (heading.trim() !== version) {
    throw new Error(`The newest changelog section is "## ${heading}"; rename it to "## ${version}" first`);
  }
  return body.trim();
}

export function updateManifest(input: ManifestInput): UpdateManifest {
  const platforms: UpdateManifest['platforms'] = {};
  for (const { target, asset, signature } of input.assets) {
    platforms[target] = { signature: signature.trim(), url: releaseAssetUrl(input.version, asset) };
  }
  return { version: input.version, notes: input.notes, pub_date: input.pubDate.toISOString(), platforms };
}

/** One `latest.json` for the platform manifests of a release; they must agree on version and notes. */
export function mergeManifests(manifests: UpdateManifest[]): UpdateManifest {
  const [first] = manifests;
  if (first === undefined) {
    throw new Error('No platform manifests to merge');
  }
  const versions = new Set(manifests.map((m) => m.version));
  if (versions.size > 1) {
    throw new Error(`The platform manifests are for different versions: ${[...versions].join(', ')}`);
  }
  if (manifests.some((m) => m.notes !== first.notes)) {
    throw new Error('The platform manifests have different release notes; build every platform from one commit');
  }
  return {
    version: first.version,
    notes: first.notes,
    // ISO dates in UTC sort as text; the last build finished the release.
    pub_date: manifests.reduce((latest, m) => (m.pub_date > latest ? m.pub_date : latest), first.pub_date),
    platforms: manifests.reduce<UpdateManifest['platforms']>((all, m) => ({ ...all, ...m.platforms }), {}),
  };
}
