# Granny is Watching

A low-poly horror game set in a rural Indonesian house. Wake up on the floor, take the seat Granny points to, and play congklak against her. Win rounds to burn pits, read her rulebook, and work out how to leave.

The base game works without a camera, a SmartSpectra key, or a Presage account. Facial hurdles are optional.

- [Clone and run from source](#clone-and-run-from-source)
- [Play and save](#play-and-save)
- [Enable optional facial hurdles](#camera-and-smartspectra)
- [Camera consent and data handling](#camera-consent-and-data-handling)
- [Troubleshooting](#troubleshooting)
- [Development and assets](#development-and-assets)

## Clone and run from source

These instructions use **Windows x64**, the platform tested by this repository's release workflow. The upstream SDK also supports Apple Silicon macOS and Linux x64/ARM64 with glibc 2.35+, but those game configurations are not covered by our Windows release checks. See [SmartSpectra's platform prerequisites](https://smartspectra.presagetech.com/docs/nodejs/).

### 1. Install the prerequisites

- Install [Git](https://git-scm.com/install/).
- Install **Node.js 24 LTS**, including npm, from the [Node.js downloads page](https://nodejs.org/en/download/). Select the 24.x release to match CI. The project's build tools require Node.js 22.12 or newer; CI uses Node 24 and npm 11.19.1.
- For facial analysis on Windows, install Microsoft's [latest Visual C++ x64 Redistributable](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/). The base game remains usable if the native tracking runtime cannot load.

Open a new PowerShell or terminal window after installing Git and Node.js, then check:

```sh
git --version
node --version
npm --version
```

### 2. Clone the repository

Run these commands in the folder where you want the project:

```sh
git clone https://github.com/AnsellMaximilian/granny-is-watching.git
cd granny-is-watching
```

A normal clone includes the Granny model in `public/models/granny.glb` and the sound files in `public/audio/`. Blender and Python are only needed if you want to regenerate those assets. You do not need to download the installer, a release ZIP, reference images separately, or a separate SDK archive.

### 3. Install the locked dependencies

From the project folder, which contains `package.json`:

```sh
npm ci
```

This installs the renderer, Electron's npm package, and SmartSpectra SDK **3.5.0**. Allow time and disk space for the downloads: the SDK currently installs runtime packages for all its supported platforms. Only the matching native SDK is loaded when the game runs. Keep dependency installation scripts enabled for packages that need them.

### 4. Start the desktop game

```sh
npm start
```

This builds the renderer and Electron preload, then opens the game window. **On the first launch, Electron 45 also downloads/extracts its desktop runtime**, so keep the terminal open and allow the download to finish. You can fetch that runtime ahead of time with `npx install-electron --no` after `npm ci`; see [Electron's binary installation instructions](https://www.electronjs.org/docs/latest/tutorial/installation#binary-download-step).

Choose **Wake up**, then **Sit down**. Leave **Facial hurdles** off to try a complete game without a webcam or API key.

Close the game when finished. If the terminal is still running it, press **Ctrl+C**; on macOS, quit the application rather than only closing its window.

### 5. Update your checkout later

After closing the game, return to the project folder and run:

```sh
git pull --ff-only
npm ci
npm start
```

If Git reports local changes, keep or commit your work before updating. `npm start` rebuilds each time, so source changes take effect on the next launch.

Prefer a ready-made application? Published Windows installers and application ZIPs appear under **Assets** on [GitHub Releases](https://github.com/AnsellMaximilian/granny-is-watching/releases). Draft releases are visible only to repository collaborators with the necessary access. The automatically generated **Source code** archives require the build steps above. See the [release guide](docs/releases.md) for packaging and downloads.

## Play and save

Each side starts with **six small pits and four seeds per pit**, for 48 seeds on a fresh board. Click an occupied pit on the near row, or press **1–6** from left to right. Your store is on the left. A round ends when either row empties after sowing resolves.

Win to choose one pit to burn for the rest of the run; either side can own that pit. Burned pits cannot be selected or receive seeds in later rounds. Draw to replay the same setup. Lose and Granny lunges into a close stare before game over. Click the rulebook on the table for the rules and its final clue. The [core gameplay](docs/core-game.md), [congklak rules](docs/congklak-rules.md), and [story](docs/story.md) cover the full design and endings.

**Settings** contains sound, facial hurdles, progress saving, camera controls, and preview visibility. Preferences are remembered. Facial encounters pause while Settings are open.

**Save progress** is on by default. A checkpoint keeps burned pits and the rulebook clue, rather than the exact position midway through a round. **Continue** resumes that round's starting setup. After a round loss or facial death, **Retry round** starts it again with four seeds per playable pit and empty stores. Nonfatal burns save the next round's setup. **Start new game** resets the run and draws a new clue. The true ending clears its checkpoint; fatal burns retry the last playable setup.

Turning saving off clears the checkpoint and removes death retries; preferences remain stored. Turning it back on during play saves the current round's starting setup, but cannot restore a run after a saving-off death. There is no game account or cloud sync. See [local storage and deletion](#local-storage-retention-and-deletion) for the files retained on your computer.

## Camera and SmartSpectra

### Enable facial gameplay

1. Start the **desktop** game with `npm start`.
2. Open **Settings** and choose **Enable camera**. Your operating system may ask for permission; allow the camera if you want to use it. Check the bottom-left preview and choose a camera in Settings if more than one is available.
3. In **Settings → API key**, enter **your own** key from the [Presage developer portal](https://physiology.presagetech.com/) and choose **Use key**. This input is available when the native runtime loads. The app keeps an entered key for the current window session; it does not save it in your progress file.
4. Turn on **Facial hurdles**, close Settings, and play. Enabling this option also opens the camera if it is not already running. Online Presage authentication and available SDK credits are required for tracking.
5. To check tracking manually, choose **Test tracking · 15s** in Settings. **Stop test** ends it early. This starts a real SDK session and can count toward your account's usage.

Enabling the preview or entering a key alone does not start facial analysis. While playing, analysis prepares ahead of an encounter and stops during sowing, Granny's turns, Settings, the rulebook, an unfocused/hidden window, and endings. Clean stops retain the SDK graph for the next encounter. The SDK accounts for short sessions and partial intervals; stopping between encounters is not a guarantee of any particular credit saving. See the [SDK lifecycle](https://smartspectra.presagetech.com/docs/nodejs/api-reference/) and [usage reporting](https://smartspectra.presagetech.com/docs/nodejs/migration-guide/).

The preview badge shows **Tracking off**, **Starting…**, **Tracking on**, **Stopping…**, or **Unavailable**. The camera can remain live while tracking is off. **Stop camera** releases the device. Collapsing the panel, hiding the preview, or switching facial hurdles off does not release an already-running camera.

### Configure a key locally instead

For source development, you can create `.env.local` from `.env.example` in the project root. If you already have `.env.local`, edit that file rather than replacing it.

PowerShell:

```powershell
Copy-Item .env.example .env.local
```

macOS/Linux shell:

```sh
cp .env.example .env.local
```

Edit `.env.local` and fill in:

```dotenv
SMARTSPECTRA_API_KEY=your-own-key-here
```

Restart `npm start` after changing it. An existing process environment variable takes precedence over the file. `.env.local` is a **plain-text local file**, ignored by Git and excluded from packaged builds; it remains on disk until you remove it. Do not put a key in a `VITE_` variable, source code, screenshots, or an issue. Each testing machine needs its own configuration. Packaged applications do not read the development `.env.local`; use their Settings input or your own launch environment.

### Signals and encounters

Only **facial landmarks, eye blink, talking, and facial expression** are requested. Pulse, breathing, HRV, and EDA are not requested. The four readouts appear while analysis runs and clear when it stops.

- **Facing camera** estimates head direction as **Toward / Away**, using eye corners, nose, and chin from the landmark layout. It is an uncalibrated heuristic; moving just your eyes can leave it unchanged. Fresh SDK **no face** or **face not forward** feedback also counts as **Away**. Camera failures and stale or uncertain data remain unknown. The layout references are linked in [the implementation](src/face-direction.js).
- **Eye blink** holds a detected blink briefly so it is visible between updates.
- **Talking** uses the camera-based SDK signal; microphone audio is not requested.
- **Expression** shows the highest-scoring SDK classification and its confidence. These are model classifications, not a reliable statement about what a person feels. Unstable or missing signals show a dash; display values expire after 1.5 seconds, and gameplay requires fresher data.

After five seconds spent choosing, once usable expression data is available, Granny can come close and demand a happy face. A held happy expression returns you to the unchanged board. Other expressions gradually increase her anger through three stages. Startup, missing signals, and unusable tracking pause judgment. See [the smile encounter](docs/core-game.md#granny-wants-a-smile).

Each eligible player choice also has a 30% chance of an upside-down visit. Look away from the webcam while choosing an occupied pit on your side. Looking toward Granny for too long lets her steal one pit's seeds into her store. She leaves after the choice. Turning fully out of view is supported through fresh no-face feedback; a camera failure does not count as looking away. See [the look-away encounter](docs/core-game.md#do-not-look-at-her).

## Camera consent and data handling

This section describes the current app and its pinned SmartSpectra SDK configuration. The game developer does not operate a server that receives your camera feed, facial results, saves, or diagnostic logs.

### Camera consent and control

- On a fresh install, facial hurdles are **off** and opening the title screen does not start capture. Choosing **Enable camera** or enabling **Facial hurdles** starts a video-only `getUserMedia` request. No microphone permission is requested.
- The app uses these controls and your remembered facial-hurdles preference as its opt-in mechanism. It has no separate facial-analysis consent dialog. If you leave facial hurdles enabled, starting or continuing a run can reopen the camera on later launches.
- Electron allows video permission only for this game's bundled main page and denies microphone and other permission requests. The app does not add a browser-style permission prompt in Electron; the operating system may separately prompt, remember, or block access. Browser development uses the browser's normal site permission controls.
- Hiding/collapsing the preview changes visibility only. Disabling facial hurdles stops analysis but leaves capture active. **Settings → Stop camera** releases the device; closing the game window also releases capture. To prevent automatic reopening, turn facial hurdles off too. OS camera privacy settings provide a separate way to revoke access.

### Local storage, retention, and deletion

| Data | What is kept and for how long | How to remove it |
| --- | --- | --- |
| Camera frames and facial sample values | Used in memory for preview, tracking, and gameplay. The game does not record video, save images, or write landmark coordinates, expression values, or physiological values to a history. Displayed readings clear when analysis stops. | Stop the camera and close the game to release its capture/SDK resources. There is no game recording to delete. |
| Progress and preferences | `progress.json` in Electron's user-data directory stores settings, burned pits, and the round's clue. It has no automatic expiration. Browser development uses the local-storage key `granny-is-watching:progress:v1` for that site's origin. | Turning **Save progress** off clears only the checkpoint. To remove preferences too, close the app and delete `progress.json`; clear the site's storage for browser development. |
| Local diagnostics | The desktop app writes timestamps, a random run ID, camera resolution/FPS, frame timing, SDK status/error codes, gameplay phases, signal-availability flags, and counts of stable facial samples. No raw frames, face coordinates, expression classifications, device IDs, API keys, or native message text are written by this logger. It keeps one current file and one `.previous` file, rotating at 5 MiB each, with **no age-based expiry**. Logging also occurs when no camera is running. | Close the app and delete both diagnostic files listed below. They are recreated on subsequent launches. They are never uploaded automatically by the game. |
| API key you enter in Settings | The app keeps it in memory for the current window session and does not write it to progress or diagnostic files. A key you configure yourself in `.env.local` or an environment variable is persistent according to that configuration. | Close the game to discard an entered key. Remove your `.env.local`/environment configuration separately. Removing a local key does not revoke it at Presage. |
| Electron and SDK caches | Electron/Chromium can keep its usual local profile/cache files. SmartSpectra initializes separate SDK-managed device-key/runtime cache state. The pinned binding has a fallback `SmartSpectraSDK` directory in the OS cache base, which can be shared with other SDK hosts. The game sets no expiry for it and does not manage its internal contents. | After quitting, remove the app's profile/cache for a local reset. SDK-cache deletion is separate and may affect other applications using that shared directory; it can be created again later. |

For the normal **Windows** setup:

- Progress: `%APPDATA%\granny-is-watching\progress.json`.
- Packaged-app diagnostics: `%APPDATA%\granny-is-watching\logs\smartspectra-diagnostics.jsonl` and `smartspectra-diagnostics.jsonl.previous` in the same folder.
- Source-run diagnostics: `.playtest/smartspectra-diagnostics.jsonl` and `.playtest/smartspectra-diagnostics.jsonl.previous` inside your checkout. `.playtest/` is Git-ignored.
- The SDK's Windows fallback cache is `%LOCALAPPDATA%\SmartSpectraSDK`. Its binding also attempts an app-namespaced cache when the host exposes one. This is SDK-managed storage, separate from the game's profile; do not assume deleting `progress.json` or uninstalling clears it. Other systems use OS cache locations and [Electron's profile paths](https://www.electronjs.org/docs/latest/api/app#appgetpathname).

Quit the game before deleting files so it cannot rewrite them. **Start new game** resets the run, not preferences or diagnostic logs. Windows uninstall preserves application data, including saves and logs. Removing the user-data folder is a full local reset, but source-run logs, a developer's `.env.local`, OS permission choices, and the separate SDK cache need separate cleanup. An explicit `--user-data-dir` launch option changes the profile location.

### Sharing, SDK telemetry, and third parties

Facial computation runs on-device. The game does not add an upload endpoint, analytics service, cloud save, or automatic log submission. Presage's SDK policy says camera images and face-derived data stay on the device. When tracking runs, the SDK still sends credentials/device-authentication information, technical request information, and session/usage records to Presage; their servers receive your IP address. These requests can be linked to your account. See the **SmartSpectra SDK Privacy Policy**, sections 3–4, on [Presage's policy page](https://presagetech.com/legal/privacy-policy).

The app explicitly sets **`enableTelemetry: false`**, disabling optional SDK session/readiness telemetry. It does not call device-readiness checks. This does not disable required authentication or usage/entitlement reporting. Our local diagnostic log is separate from SDK telemetry and is not submitted to Presage. See [SDK telemetry and privacy](https://smartspectra.presagetech.com/docs/telemetry-and-privacy/).

**Insights qualification:** the game never calls `requestInsight`, sends an LLM prompt, or requests cardio/breathing metrics. Presage's broader SDK policy nevertheless describes automatic Insights through Presage and Anthropic, independently of telemetry. The [Node Insights guide](https://smartspectra.presagetech.com/docs/nodejs/llm-insights/) requires cardio plus breathing and a stable pulse for automatic vitals Insights; that trigger is not configured here. Native SDK network traffic has not been independently audited, so telemetry-off is not a blanket guarantee against SDK service processing. See SDK policy sections 4.2 and 7.

**Provider retention and deletion:** Presage controls its service records. SDK policy section 10 lists up to 365 days for usage/ordinary logs, longer security/backup retention, and account-based retention for authentication and Insights. Its telemetry documentation separately says readiness reports/access logs have no automatic expiration configured. This app sends no readiness reports; it cannot promise a deletion deadline for provider-held records. Local cleanup does not delete those records. Use the policy's section 11 contact/deletion process for requests to Presage.

Implementation references: [camera lifecycle](src/smart-spectra-session.js), [permission handling](electron/main.cjs), [local progress](electron/progress.cjs), and [diagnostic filtering/rotation](electron/spectra-diagnostics.cjs).

## Troubleshooting

| Problem | What to check |
| --- | --- |
| `git`, `node`, or `npm` is not found | Reopen the terminal after installation and check the three version commands above. On PowerShell, if script execution blocks `npm.ps1`, use `npm.cmd ci` and `npm.cmd start` rather than changing your system's script policy. |
| `npm ci` fails | Confirm you are in the project folder and have network access and Node 24. CI uses npm 11.19.1; a lockfile-validation error on another npm version can be checked with `npx --yes --package=npm@11.19.1 npm ci`. Keep the committed lockfile. |
| Electron did not install or the desktop window does not open | The first launch downloads its native runtime. Allow it to finish and check proxy/firewall access. From the installed checkout, run `npx install-electron --no` to retry the download, then `npm start` and inspect the terminal output. |
| Models or sounds are missing | Check that `public/models/granny.glb` and `public/audio/` exist in the clone. Start from the project folder with `npm start`; the raw source `index.html` is not a built application. |
| Camera access is denied, busy, or disconnected | Check OS privacy settings, close other camera apps, reconnect the device, then use **Enable camera** again. Denial does not prevent the base game. |
| Native tracking or API-key controls are unavailable | On Windows, install/update the Microsoft Visual C++ x64 runtime and restart. Confirm you are using `npm start` on a supported SDK platform; browser development has preview support only. |
| The key is rejected or credits run out | Use your own current Presage key, check your plan/credits and network connection, and retry deliberately. Changing `.env.local` needs an app restart. No key is supplied by this repository. |
| The preview shows ~29 FPS but tracking fails | Preview FPS measures displayed video. **Settings → Camera** separately shows camera mode and SDK callback FPS; larger previews show tracking FPS beside its status badge. Compare the SDK frame-timestamp cadence in the local log. Good preview FPS does not guarantee enough frames reached the processing path. |
| Low-FPS warning becomes **Unavailable** | SmartSpectra targets sustained 30 FPS with roughly 25 FPS minimum. Improve lighting and reduce concurrent CPU/GPU load. Validation warning 11 can clear; terminal error 14 ends the session. The game pauses judgments and offers **Retry tracking** during an eligible encounter, or **Retry tracking · 15s** in Settings. A retry restores hurdle grace and keeps the board/camera; no automatic retries start on later turns. See [measurement guidance](https://smartspectra.presagetech.com/docs/measurement-quality/) and [the recovery contract](https://smartspectra.presagetech.com/docs/nodejs/migration-guide/). |
| Local saving fails | Settings shows the storage error. Check write access to the profile folder; keep playing or start a new game. Browser saves belong to that browser/origin and do not transfer into Electron. |

For timing problems, reproduce an encounter and inspect the newest `runId` in the diagnostic log. One-second summaries distinguish callback arrival FPS from cadence derived from SDK-carried frame timestamps, with frame gaps, render timing, validation/error codes, and stable-sample counts. These callbacks cannot reveal frames dropped before the SDK reported them. Review logs before choosing to share them: they still contain timestamps and gameplay/device-performance information.

## Development and assets

| Command | Purpose |
| --- | --- |
| `npm start` | Build and launch the desktop game with native SDK support when available. |
| `npm run dev` | Start the Vite renderer server; open the local URL printed in the terminal. This browser mode supports gameplay and camera preview, but no native facial analysis. Camera access requires a secure context such as localhost. |
| `npm run build` | Build the renderer and sandboxed Electron preload into `dist/`. |
| `npm test` | Check congklak rules, seed conservation, facial hurdles/recovery, local progress, IPC, diagnostics, and camera/session handling. Tests use fixtures rather than your webcam or live SDK credits. |
| `npm run package:win` | Create a Windows x64 installer and application ZIP in `release/`. |

The [release guide](docs/releases.md#build-locally) covers package verification, isolated smoke checks, checksums, GitHub Actions, draft publishing, and optional signing. A normal source run does not require GitHub Actions credentials or a SmartSpectra MCP connection.

To regenerate the animated Granny model, use Blender 5.x:

```sh
blender --background --python art/build-granny.py
```

To regenerate the original scream effects and pressure loop, use Python 3 and its standard library:

```sh
python art/generate-screams.py
```

The room, furniture, candlelight, and congklak board are generated by the renderer. Bundled gamelan, ignition, wood impacts, and generated scream files live in `public/audio/`. The wood impacts are from Kenney's CC0 Impact Sounds pack; its license is included as [kenney-license.txt](public/audio/kenney-license.txt).
