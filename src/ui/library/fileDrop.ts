import { useState, type DragEvent } from 'react';

const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

/** Drop target for files from the OS; `dragging` drives the highlight while files hover. */
export function useFileDrop(onFiles: (files: File[]) => void) {
  const [dragging, setDragging] = useState(false);
  const handlers = {
    onDragOver: (e: DragEvent) => {
      if (hasFiles(e)) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        setDragging(true);
      }
    },
    onDragLeave: (e: DragEvent) => {
      // Leaving into a child element is not leaving the drop target.
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
        setDragging(false);
      }
    },
    onDrop: (e: DragEvent) => {
      if (hasFiles(e)) {
        e.preventDefault();
        setDragging(false);
        onFiles([...e.dataTransfer.files]);
      }
    },
  };
  return { dragging, handlers };
}

export function isImageFile(file: File): boolean {
  return /^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
}
