# npm Publishing Checklist

## Current Status

- `dsh-browser-workbench` has not been published to npm.
- The first npm publication is still pending.
- No npm dist-tag has been changed for this package.
- The project `.npmrc` currently defaults to the `next` tag. Always pass an explicit tag when publishing a prerelease.

## Before the First Publish

- Confirm `dsh-browser-workbench` is available on npm and the publisher account has permission to claim it.
- Confirm the intended version, package contents, README install instructions, and DSH `0.2.1-rc.2` compatibility.
- Complete fresh DSH Web Profile installation, startup, authentication, and UI acceptance.
- Run the release checks, including `pnpm install --frozen-lockfile --ignore-scripts`, `pnpm peers check`, `pnpm run build`, and `node scripts/check-public-package.mjs`.
- Sign in to npm with the account that will own and publish the package; verify it with `npm whoami`.
- Publish a release candidate with an explicit prerelease tag, such as `npm publish --tag next`. Do not let a prerelease move the `latest` tag.

## Set the `latest` Tag

After a stable version has been published, point npm's `latest` tag at that exact version:

```sh
npm dist-tag add dsh-browser-workbench@<stable-version> latest
```

Verify the result with:

```sh
npm view dsh-browser-workbench dist-tags --json
```

Changing npm dist-tags requires npm authentication and publish/maintainer permission for the package. Editing this repository's `.npmrc` only changes local defaults; it does not update tags on the npm registry.
