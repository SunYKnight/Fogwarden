import { useEffect, useState } from 'react';
import { isVideoAsset } from '@/core/atmosphere/media';
import type { AssetRef } from '@/core/model';
import { useAppStore } from '@/state/appStore';

interface AssetImageProps {
  asset: AssetRef | null;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * <img> for a storage asset (the first frame for a video battlemap); renders an empty placeholder box while
 * the URL resolves or when there is none.
 */
export function AssetImage({ asset, alt, className, style }: AssetImageProps) {
  const repository = useAppStore((s) => s.repository);
  const reportError = useAppStore((s) => s.reportError);
  const [resolved, setResolved] = useState<{ key: string; url: string } | null>(null);
  const key = asset ? `${asset.area}:${asset.path}` : '';

  useEffect(() => {
    let cancelled = false;
    if (asset) {
      repository.storage
        .assetUrl(asset)
        .then((url) => {
          if (!cancelled) setResolved({ key: `${asset.area}:${asset.path}`, url });
        })
        .catch(reportError);
    }
    return () => {
      cancelled = true;
    };
  }, [asset, repository, reportError]);

  const url = resolved && resolved.key === key ? resolved.url : null;
  return url && asset && isVideoAsset(asset) ? (
    <video src={url} aria-label={alt} className={className} style={style} muted preload="metadata" />
  ) : url ? (
    <img src={url} alt={alt} className={className} style={style} />
  ) : (
    <div className={`thumb ${className ?? ''}`} style={style} />
  );
}
