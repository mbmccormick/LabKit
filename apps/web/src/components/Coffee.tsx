/** Buy Me a Coffee, as a plain link to a self-hosted image: no third-party script, font or tracking. */
const COFFEE_URL = 'https://buymeacoffee.com/mbmccormick';

export function Coffee() {
  return (
    // New tab: nothing is kept, so leaving this page in the same tab would lose the card.
    <a class="coffee" href={COFFEE_URL} target="_blank" rel="noopener noreferrer">
      <img src="/badges/buy-me-a-coffee.svg" alt="Buy me a coffee" height={44} />
    </a>
  );
}
