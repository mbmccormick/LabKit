# Verifying a LabKit deployment

To sign your cards, LabKit's server receives your name, date of birth and results. This guide shows how to check that the code running at labkit.health is the code in this repository.

## What you can check, and what you can't

- **Every release is built and signed by GitHub Actions from a public commit.** The signature is recorded in the public [Sigstore](https://www.sigstore.dev) transparency log. Only this repository's [deploy workflow](../.github/workflows/deploy.yml) can produce it.
- **You can check the web app yourself.** Every file the site sends your browser can be downloaded and compared with the signed build.
- **The server code is checked when it's deployed.** After each deploy, the workflow reads the deployed code back from Cloudflare and confirms it's exactly the signed build, with request logging off and nothing attached that could copy requests. The result is in that deploy's public log.
- **What you can't check:** Cloudflare doesn't offer a way to prove to a visitor what code a server is running at a given moment, and only the Cloudflare account holder can read the deployed server code. Between deploys you're trusting LabKit's access controls, GitHub and Cloudflare.

## The quick way

You need [Node.js 22](https://nodejs.org), [pnpm](https://pnpm.io) and the [GitHub CLI](https://cli.github.com), signed in with `gh auth login`.

```bash
git clone https://github.com/mbmccormick/LabKit.git && cd LabKit
pnpm install
pnpm verify:deployment --env production
```

This:

1. Downloads the build manifest from `https://labkit.health/.well-known/labkit-build.json`. The manifest names the commit and lists a SHA-256 hash for the server code and for every web file.
2. Runs `gh attestation verify` to confirm that the manifest was signed by this repository's deploy workflow, on a GitHub-hosted runner, from the commit it names.
3. Downloads every web file from the site and checks it against the manifest.
4. Prints the commit and a link to the build and deploy log.

Every line should start with ✓. Open the deploy log and find the step **Check the live deployment against the signed build**. It shows that the server code Cloudflare holds is exactly the signed build (`version … code and _headers are exactly the signed build`), that logging is off, and that there are no tail consumers. The `LabKit-Worker-Version` header on the manifest names the Cloudflare version that answered you. It should match the version in that log.

Use `--env staging` to check `staging.labkit.health`.

## By hand

```bash
curl -sO https://labkit.health/.well-known/labkit-build.json
gh attestation verify labkit-build.json --repo mbmccormick/LabKit \
  --signer-workflow mbmccormick/LabKit/.github/workflows/deploy.yml
```

`gh` prints the commit the build came from. To check a web file, compare its hash with the one listed in the manifest:

```bash
curl -sL https://labkit.health/index.html | shasum -a 256
grep '"/index.html"' labkit-build.json
```

To read the code behind that commit, open `https://github.com/mbmccormick/LabKit/tree/<commit>`. The server is in [apps/worker](../apps/worker), and signing is in [apps/worker/src/sign.ts](../apps/worker/src/sign.ts).

## Limits

- The server delivers the web files, so in principle it could send different files to different visitors. Your check covers the files it sent *you*.
- If you find a mismatch, please report it privately (see [SECURITY.md](../SECURITY.md)).
