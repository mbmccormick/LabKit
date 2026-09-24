export function Privacy() {
  return (
    <article class="prose">
      <h1>Privacy</h1>
      <p>LabKit is built so that we never keep your health information.</p>

      <h2>In Your Browser</h2>
      <p>
        Your lab report is read inside the open browser tab. The file itself is never uploaded. What we read (your name,
        date of birth, and results) is held only in the tab's memory. It isn't written to cookies, local storage, or any
        other browser storage, and it disappears when you close the tab.
      </p>

      <h2>When You Create a Card</h2>
      <p>
        To sign your card, its contents (name, date of birth, collection time, and results) are sent once over HTTPS to
        our signing service, which runs on Cloudflare Workers. The service checks the contents, signs them, and sends the
        card back. The contents exist only in the service's memory while that request is processed. They aren't stored,
        logged, or shared.
      </p>
      <p>
        We record counts only: how many cards and results were signed, and whether the request succeeded. Cloudflare uses
        your IP address briefly to limit how often signing can be requested, and Cloudflare Turnstile uses it to check
        that a person, not a bot, is making the request.
      </p>

      <h2>No Tracking</h2>
      <p>
        No analytics, advertising pixels, third-party fonts, or third-party scripts, apart from Cloudflare Turnstile,
        which loads only when you create a card.
      </p>

      <h2>Your Cards</h2>
      <p>
        Card files you download and cards you add to Apple Health are stored on your devices, under your control. We
        can't see, change, or delete them.
      </p>
    </article>
  );
}
