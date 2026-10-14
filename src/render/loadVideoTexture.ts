import { SRGBColorSpace, VideoTexture } from 'three';

/**
 * Looping, muted video as a texture (animated battlemaps); resolves once the first frame is there. Disposing
 * the texture stops the video and frees its decoder.
 */
export function loadVideoTexture(url: string): Promise<VideoTexture> {
  const video = document.createElement('video');
  const { promise, resolve, reject } = Promise.withResolvers<VideoTexture>();
  video.crossOrigin = 'anonymous';
  video.loop = true;
  video.muted = true;
  video.playsInline = true;
  video.addEventListener(
    'loadeddata',
    () => {
      const texture = new VideoTexture(video);
      texture.colorSpace = SRGBColorSpace;
      texture.addEventListener('dispose', () => {
        video.pause();
        video.removeAttribute('src');
        video.load();
      });
      video.play().then(
        () => resolve(texture),
        (error: unknown) => {
          texture.dispose();
          reject(error);
        },
      );
    },
    { once: true },
  );
  video.addEventListener('error', () => reject(new Error(`Video could not be loaded: ${url}`)), { once: true });
  video.src = url;
  return promise;
}
