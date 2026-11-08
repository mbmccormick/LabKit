import { cardFileContents, SHC_MIME } from '@labkit/core';

/** Blob URL created on click and revoked right after; nothing is cached or stored. */
export function downloadCard(jws: string, fileName: string): void {
  downloadFile(cardFileContents(jws), SHC_MIME, fileName);
}

/** Any generated file (vitals JSON/CSV): built in the browser, never sent anywhere. */
export function downloadFile(contents: string, type: string, fileName: string): void {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
