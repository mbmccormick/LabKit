import type { ComponentChildren } from 'preact';

/** LabKit's public source code. New tab, so a card in progress is never lost. */
export const SOURCE_URL = 'https://github.com/mbmccormick/LabKit';

export function SourceLink(props: { children: ComponentChildren }) {
  return (
    <a href={SOURCE_URL} target="_blank" rel="noopener noreferrer">
      {props.children}
    </a>
  );
}
