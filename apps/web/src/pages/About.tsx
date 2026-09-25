import { BuildInfo } from '../components/BuildInfo';
import { Coffee } from '../components/Coffee';
import { SOURCE_URL, SourceLink } from '../components/Source';

export function About() {
  return (
    <article class="prose">
      <h1>About LabKit</h1>
      <p>
        LabKit (labkit.health) turns your lab report into a <a href="https://spec.smarthealth.cards">SMART Health Card</a>,
        a standard format you can add to Apple Health as lab results. A card holds the results from one collection date and
        time, so a report with several collection dates becomes one card per date.
      </p>

      <h2>What the Signature Means</h2>
      <p>
        Every card is signed by <code>https://labkit.health</code>, so Apple Health can verify where it came from. A
        valid signature means LabKit created the card and it hasn't been changed since. It does <strong>not</strong>{' '}
        mean the values are correct or that they came from a lab: you check the values yourself before signing.
      </p>

      <h2>Not Medical Advice</h2>
      <p>
        LabKit only adds the results from your report to Apple Health. It doesn't interpret results, score them, or
        suggest "optimal" ranges. Reference ranges come only from your lab report. Talk to a clinician about what your
        results mean.
      </p>

      <h2>Lab Results Only</h2>
      <p>
        LabKit signs lab results only. It never creates immunization or COVID-19 cards, and it signs only tests on its
        supported list.
      </p>

      <h2>Supported Reports</h2>
      <p>
        LabKit reads Quest and Labcorp reports, other lab PDFs, and scans or photos of printed reports. Everything is
        read on your device. Results it can't read confidently are shown for you to review, and anything it can't
        identify is left out.
      </p>

      <h2>Open Source</h2>
      <p>
        LabKit is open source under the Apache 2.0 license. You can read every line of code that handles your report,
        report problems, or contribute support for more labs on <SourceLink>GitHub</SourceLink>.
      </p>

      <h2>Verify This Deployment</h2>
      <p>
        To sign your cards, LabKit's server receives your name, date of birth and results. It doesn't store or log them,
        and you can check that the code running here is the code on GitHub.
      </p>
      <BuildInfo />
      <p>
        Every release is built and signed by GitHub Actions from a public commit. You can confirm that the files this
        site sends your browser match that signed build. When a release is deployed, the server code is also checked
        against the signed build, and the result is in the public deploy log. The guide to{' '}
        <a href={`${SOURCE_URL}/blob/main/docs/verify.md`} target="_blank" rel="noopener noreferrer">
          verifying a deployment
        </a>{' '}
        walks through the checks.
      </p>

      <h2>Support LabKit</h2>
      <p>LabKit is free to use. If it's useful to you, you can support it here.</p>
      <p>
        <Coffee />
      </p>
    </article>
  );
}
