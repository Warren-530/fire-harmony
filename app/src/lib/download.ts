// Saving files from the browser: a file name part made from a place name, and a blob saved with a link click.

/** "Central Kalimantan, Indonesia" → "central_kalimantan_indonesia". */
export function fileSlug(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 60) || 'area';
}

/** Save a blob as a file (the URL is released a little later). */
export function saveFile(blob: Blob, file: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
