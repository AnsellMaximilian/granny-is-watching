# Granny is Watching

A low-poly horror game set in a rural Indonesian house. Wake up on the floor, take the seat Granny points to, and play a round of congklak against her.

## Run on desktop

Packaged Windows builds are available from [GitHub Releases](https://github.com/AnsellMaximilian/granny-is-watching/releases) after a release workflow completes. Download the installer or application ZIP; Node.js is not needed for these builds. Facial analysis requires the latest Microsoft Visual C++ x64 runtime. The [release guide](docs/releases.md) covers draft downloads, native prerequisites, version tags, GitHub Actions, and optional signing credentials.

With Node.js 22.12 or newer installed, run:

```sh
npm ci
npm start
```

Choose **Wake up**, then **Sit down**. On your turn, click an occupied pit on the near row or press **1–6** from left to right. Your store is on the left. A round ends when either row empties after sowing resolves.

Each side starts with six small pits and four seeds in each pit, for 48 seeds total. Win to burn one pit for the rest of the run. Draw to replay the same board. Lose and Granny lunges into a close stare before game over. Click the rulebook on the table to read the rules and find its final clue. See [core gameplay](docs/core-game.md) and the [congklak rules](docs/congklak-rules.md).

## Settings and saving

**Settings** contains sound, facial hurdles, progress saving, camera controls, and the preview visibility toggle. Preferences are remembered. Facial encounters pause while the menu is open.

**Save progress** is on by default. A checkpoint retains burned pits and the rulebook clue. After a round loss or facial death, **Retry round** starts that round over with four seeds per playable pit and empty stores. **Start new game** resets the run and draws a new clue. **Continue** resumes the saved round after reopening the app. Nonfatal burns save the next round's setup. The true ending clears its checkpoint; fatal burns retry the last playable setup.

Turn saving off for a run without death retries. This removes the checkpoint. Turning it back on during play saves the current round's starting setup; it cannot resurrect a run after a saving-off death. Desktop data is stored locally as `progress.json` in Electron's application data directory. Browser development uses local browser storage. There is no account or cloud sync. Storage errors are shown in Settings, and no credentials, webcam images, or measurements are saved.

## Camera and SmartSpectra

The bottom-left **Camera** panel previews facial analysis. Use **Settings → Enable camera** to start your webcam. **Stop camera** releases it. The **−** button collapses the panel while capture continues. **Settings → Facial hurdles** toggles gameplay integration and starts the camera if needed. It defaults off and remembers your choice. Starting or continuing a run opens the camera when this preference is enabled.

The camera preview stays live while **Tracking off** means facial processing is stopped. Its badge also shows **Starting…**, **Tracking on**, **Stopping…**, or **Unavailable**. Idle preview stays compact; the four readouts appear when tracking starts. Gameplay starts analysis ahead of a possible encounter and stops it during moves, Granny's turns, menus, the rulebook, unfocused windows, and endings. Settings offers **Test tracking · 15s** for an explicit, time-limited diagnostic session. Enabling the camera or entering a key alone starts no analysis. Clean stops reuse the SDK graph. This reduces unnecessary processing time; the public SDK documentation does not specify a credit deduction formula, so this is not a guaranteed credit-saving estimate. The [renderer lifecycle](https://smartspectra.presagetech.com/docs/nodejs/api-reference/) supports stopping processing while retaining a host-owned camera stream.

Copy `.env.example` to `.env.local` in the project root and set `SMARTSPECTRA_API_KEY` to your Presage developer key, then restart `npm start`. An existing environment variable takes precedence. Alternatively, enter a key through **Settings → API key**. An entered key lasts for this app session only. Keys are not included in the renderer build, saved in progress data, or committed. Each testing machine needs its own local configuration.

The Electron app uses SmartSpectra Node SDK **3.5.0** with its bundled native runtime. Use a supported desktop platform (Windows x64, Apple Silicon macOS, or glibc 2.35+ Linux x64/ARM64). `npm ci` installs the native dependencies for all supported platforms. Camera processing requires the desktop app; browser development supports a live preview only. Online authentication and available SmartSpectra credits are required for detection.

The SDK requests only **facial landmarks, eye blink, talking, and facial expression**. All four readouts are visible beneath the preview while analysis runs and clear when it stops. There are no rate-analysis warm-up countdowns. Keep one face visible in even front lighting. Capture requests 640 × 480 at 30 fps to limit pixel-copy overhead alongside the 3D game; cameras may negotiate different settings.

**Facing camera** shows **Toward / Away** using the eye corners, nose, and chin from SmartSpectra's 478-point landmark layout. It estimates head direction from relative landmark positions, with brief smoothing to reduce flicker. This is an uncalibrated heuristic; moving just your eyes can leave the head-direction estimate unchanged. It has not been calibrated across people, camera positions, or facial proportions. Fresh SDK **no face** and **face not forward** feedback also counts as **Away**, with its source shown in the panel. Missing, malformed, unstable, or stale tracking and camera errors remain unknown. The landmark layout follows the [MediaPipe face connections](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py) and [canonical face model](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj).

**Eye blink** briefly holds a detected blink for 350 ms so it remains visible between UI updates. **Talking** displays the SDK's camera-based detection without microphone audio. **Expression** displays the highest-scoring SDK classification and its confidence: angry, contempt, disgust, fear, happy, neutral, sad, surprise, or unspecified. These are model classifications. Unstable or missing signals show a dash; readings expire after 1.5 seconds without a fresh sample. Losing the face or resetting tracking clears previous detections. Pulse, breathing, HRV, and EDA are neither requested nor displayed.

Camera access, missing cameras, busy/disconnected devices, missing or rejected keys, exhausted credits, network failures, and low frame rate have recoverable messages. A tracking failure preserves the preview and offers **Retry tracking · 15s**. Failures never trigger automatic retries on a later turn. If low frame rate occurs, improve lighting and close competing apps before retrying. An unavailable native runtime leaves the game and preview usable.

With facial hurdles on, analysis prepares after two seconds spent choosing a pit. At five seconds, once expression tracking is ready, Granny comes close to ask whether you're having fun. Hold a confident happy expression briefly to return to your unchanged board. Other expressions gradually increase hidden anger through three dialogue stages and an escalating scream before game over. Startup never increases anger, and uncertain or missing tracking pauses the encounter. Turning the mode off resumes play. See the [full encounter rules](docs/core-game.md#granny-wants-a-smile).

Each player choice has a 30% chance of an upside-down visit targeting a random 1.5–3.5 seconds of eligible choosing time, with analysis preparing up to two seconds earlier. Appearance waits for usable direction data. Look away from the webcam while choosing a pit. Her black-eyed, inverted head leaves the player row clear and stays until a pit is chosen. Looking toward her for too long builds a lighter scream and lets her steal one occupied player pit into her store. Each appearance can steal once. Fresh no-face feedback supports turning fully away; camera failures pause the pressure. The debug trigger has been removed. See [the look-away rules](docs/core-game.md#do-not-look-at-her).

Video and signal processing stay on-device. The game does not record the feed or persist measurements, request microphone access, or request LLM insights. SDK session and readiness telemetry are disabled. Authentication still contacts Presage. See the [official Electron integration](https://smartspectra.presagetech.com/docs/nodejs/), [metric schema](https://smartspectra.presagetech.com/docs/data-types/), and [measurement guidance](https://smartspectra.presagetech.com/docs/measurement-quality/).

## Develop

- `npm run dev` starts the Babylon.js renderer in a browser.
- `npm run build` builds the renderer and sandboxed Electron preload.
- `npm run package:win` creates a Windows x64 installer and ZIP in `release/`. See [packaging and release checks](docs/releases.md#build-locally).
- `npm test` checks the rules, seed conservation, randomized facial hurdles, local saves, progress IPC, signal quality handling, and camera/session lifecycle.
- `blender --background --python art/build-granny.py` rebuilds the animated Granny GLB with Blender 5.x. The room, candlelight, furniture, and carved board are generated by the renderer.
- `python art/generate-screams.py` rebuilds the original scream effects and the looping pressure layer with Python's standard library.

The gamelan, ignition, and wood impacts are bundled in `public/audio/`. Wood impacts are from Kenney's CC0 Impact Sounds pack, with its license included alongside the files.
