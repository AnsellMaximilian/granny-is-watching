# Windows releases

The **Windows release** GitHub Actions workflow builds a Windows x64 installer, a ZIP of the complete application, and `SHA256SUMS.txt`. It tests the game, verifies the package contents, and launches the packaged EXE before uploading anything to a **draft GitHub Release**. Drafts let repository maintainers download and playtest before publishing.

## Credentials

For the first unsigned preview, **no repository secrets are required**. GitHub supplies `GITHUB_TOKEN` automatically. Only the release job receives `contents: write`; the build job has read access. GitHub Actions must be enabled for the repository and allowed to use the pinned official `actions/*` actions.

Do **not** add `SMARTSPECTRA_API_KEY` to GitHub Actions. Public npm packages supply the native SDK. Each player supplies their own Presage key through **Settings → API key**, or their own environment. A key entered in Settings lasts for that app session. Their progress stays local. Developer `.env.local` files and personal attachments are excluded from the application.

Optional Windows signing secrets, under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| --- | --- |
| `WIN_CSC_LINK` | Base64 contents of an exportable Windows Authenticode `.pfx` certificate. |
| `WIN_CSC_KEY_PASSWORD` | Password for that certificate. |

Without these, the installer and EXE are unsigned. Windows may show unknown-publisher or SmartScreen prompts. Signing is optional for preview testing. A hardware token or cloud signing service needs its own signing integration rather than these PFX settings. See the [electron-builder Windows signing guide](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/).

## Create a release

Push a new version tag at the commit to package:

```sh
git tag v0.1.0-alpha.1
git push origin v0.1.0-alpha.1
```

The tagged commit must contain `.github/workflows/release.yml`. This works from the feature branch before merging. The tag supplies the packaged version, so `v0.1.0-alpha.1` produces application version `0.1.0-alpha.1`; it does not require editing the development version in `package.json`. Versions with a prerelease suffix are marked as prereleases.

Once the workflow file is on the default branch, you can also use **Actions → Windows release → Run workflow**. Select the branch to build and enter a new tag. The release job creates that tag at the exact commit tested. If the tag already points elsewhere, the workflow fails instead of attaching mismatched binaries.

The workflow creates a draft and leaves publishing to you. It never replaces a published release. Re-running the same failed workflow can finish or replace assets in its existing draft; fixes to the source need a new version tag.

## Download and test

1. Wait for both jobs in **Actions → Windows release** to succeed.
2. Open [the repository's Releases page](https://github.com/AnsellMaximilian/granny-is-watching/releases) while signed into an account with repository write access. Find the version's **Draft** release.
3. Under **Assets**, download `Granny-is-Watching-VERSION-win-x64-setup.exe`, or `Granny-is-Watching-VERSION-win-x64.zip`. The automatically generated **Source code** archives do not contain the built game.
4. Run the installer, or extract the ZIP and run **Granny is Watching.exe**. Keep the ZIP's files together. Node.js is not required.
5. Check the opening, a full round, burns/endings, retrying a saved round, sound, and optional facial hurdles with your own key. The automated smoke test checks loading, native binding, the board, the rulebook, local saves, and shutdown; it does not start a camera or spend SDK credits.
6. When satisfied, edit the draft and select **Publish release**. Everyone allowed to access the repository can then download its release assets.

GitHub Actions also retains the tested downloads as `windows-x64-VERSION` artifacts for 14 days, and the packaged smoke-test screenshot/log for seven days. This is useful if release upload fails after the build passes.

Installer upgrades and ZIP builds use `%APPDATA%\granny-is-watching\progress.json`. Uninstalling does not delete progress. This loop packages downloads; it does not add an in-app automatic updater.

## Build locally

On Windows with Node.js 22.12 or newer:

```sh
npm ci
npm test
npm run package:win
npm run verify:package
npm run smoke:package
npm run release:checksums
```

Outputs are in `release/`. `npm run package:win:dir` builds just `release/win-unpacked/` for faster native-runtime checks. `RELEASE_VERSION` can override the packaged version locally. Use a clean output directory when changing versions; checksum generation refuses a mixture of old and new installers.

The package includes built `dist/` assets and Electron main-process code. Koffi's Windows x64 Node-API binary is unpacked from ASAR. SmartSpectra's complete Windows runtime is copied into `resources/node_modules/@smartspectra/node-sdk-win32-x64/`. Its normal module resolution then finds real files and retains the SDK's scoped Windows DLL loader. Packaged apps ignore the development-only `SMARTSPECTRA_CAPI_PATH` override. Other platforms' native payloads and renderer source dependencies are omitted. See [SmartSpectra's Electron packaging instructions](https://smartspectra.presagetech.com/docs/nodejs/#electron-desktop-packaging).
