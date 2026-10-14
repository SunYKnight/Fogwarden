/** GitHub repository whose releases the installed app's updater reads. */
export const RELEASE_REPOSITORY = 'https://github.com/SunYKnight/Fogwarden';

/** The updater's `latest.json` as tauri-plugin-updater reads it (static JSON format). */
export interface UpdateManifest {
  version: string;
  notes: string;
  pub_date: string;
  platforms: { 'windows-x86_64': { signature: string; url: string } };
}

export interface ManifestInput {
  version: string;
  notes: string;
  pubDate: Date;
  /** Contents of the installer's `.sig` file. */
  signature: string;
  /** Installer file name as uploaded to the release. */
  installer: string;
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
  return {
    version: input.version,
    notes: input.notes,
    pub_date: input.pubDate.toISOString(),
    platforms: {
      'windows-x86_64': {
        signature: input.signature.trim(),
        url: releaseAssetUrl(input.version, input.installer),
      },
    },
  };
}
