# Contributing

Issues and pull requests are welcome. The UPN QR standard and the reference rules are published by Združenje bank
Slovenije at [zbs-giz.si](https://www.zbs-giz.si/standardi-in-prirocniki/); cite the section next to any rule you add
or change.

## Development

```sh
npm install
npm test            # unit tests, the official ZBS examples, and end-to-end tests through an MCP client
npm run typecheck
npm run build
npm run inspect     # open the MCP Inspector against the built server
npm run pack:mcpb   # build release/upn-qr-mcp-<version>.mcpb
```

Project layout:

```
src/
  upn/
    fields.ts        the 20 fields of the standard, and which fields each kind of order needs
    encode.ts        fields → QR text
    decode.ts        QR text → fields, with structural checks
    validate.ts      field checks against the standard
    checksum.ts      field 20, the length check
    charset.ts       ISO 8859-2
    purpose-codes.ts the ZBS list of purpose codes
    format.ts        values as printed on the form (***1.234,50, 25.06.2026 …)
  iban.ts            IBAN checks (ISO 13616) and Slovenian bank names
  si-banks.ts        the Bank of Slovenia's list of bank codes
  reference.ts       SI and RF references: checks and check digits
  qr.ts              QR generation (PNG, SVG) and reading
  form.ts            the printable UPN form (PDF)
  vendor/            Project Nayuki's QR library
  server.ts          createServer(): tools and resources
  index.ts           the `upn-qr-mcp` command (stdio)
fonts/               Source Sans 3 and Liberation Mono (SIL OFL), for the PDF form
test/
  fixtures/zbs/      the example QR codes printed in the standard
```

`upn/`, `iban.ts` and `reference.ts` don't depend on MCP and can be used on their own.

Tests use only fictional data or the standard's own examples. Use IBANs with valid check digits but no account behind
them (see `test/data.ts`), never real people's or companies' account numbers.

## Releasing

A release is a version bump on `main`; the Release workflow does the rest.

1. Bump the version:

   ```sh
   npm version minor --no-git-tag-version   # or patch / major
   ```

   This updates `package.json` and `package-lock.json`, and its `version` script copies the version into
   `manifest.json` and `src/version.ts` (`scripts/sync-version.mjs`). `test/versions.test.ts` fails if they ever
   disagree.

2. Commit the change and push it to `main` (directly or through a pull request).

3. The **Release** workflow (`.github/workflows/release.yml`) runs on every push to `main`, on `v*` tags and when
   started by hand, one run at a time. It:

   - reads the name and version from `package.json`;
   - if it was started by a pushed tag, fails when the tag isn't `v<version>`;
   - checks **separately** whether the GitHub release `v<version>` exists and whether `upn-qr-mcp@<version>` is on npm;
   - if both exist, stops: nothing to do (so pushes that don't bump the version release nothing);
   - otherwise runs the typecheck and tests, and builds the `.mcpb`;
   - creates the GitHub release `v<version>` (which also tags the commit) with the `.mcpb` attached and generated
     release notes, if it's missing;
   - publishes to npm, if that version isn't there yet.

   Because the two halves are checked separately, a run that fails halfway (say the GitHub release was created but
   the npm publish failed) only does the missing part when you re-run it: re-run the workflow from the Actions tab,
   or start it with **Run workflow**.

Pushing a `v*` tag yourself (`npm version minor && git push --follow-tags`) works too; the second run of a bump pushed
together with its tag waits for the first and then finds nothing to do.

### npm trusted publishing

Publishing uses [trusted publishing](https://docs.npmjs.com/trusted-publishers): no npm token, the workflow signs in
with its GitHub OIDC identity (`id-token: write`, Node 24 for npm 11.5.1 or newer). npm adds provenance on its own
while the repository is public.

A trusted publisher can only be added to a package that already exists on npm, so the first version is published by
hand, once:

1. `npm login`, then from a clean checkout of the release commit: `npm ci && npm publish --access public`.
2. On npmjs.com, open the package → **Settings** → **Trusted publishing**, choose **GitHub Actions**, and enter
   owner `matejmohar`, repository `upn-qr-mcp` and workflow `release.yml` (no environment).
3. Optionally, under **Publishing access**, require two-factor authentication and disallow tokens, so only the
   workflow can publish.
4. Re-run the Release workflow (or push the next version): it sees the npm half is done and creates only the GitHub
   release, and from then on publishes every version by itself.
