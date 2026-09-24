/** "Add to Apple Health" is offered on iOS Safari only (SPEC §9.1). */
export function isIosSafari(ua = navigator.userAgent, platform = navigator.platform, touch = navigator.maxTouchPoints): boolean {
  const ios = /iP(hone|od|ad)/.test(ua) || (platform === 'MacIntel' && touch > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|GSA\//.test(ua);
}
