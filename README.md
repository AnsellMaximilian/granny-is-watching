# Granny is Watching

A low-poly horror game set in a rural Indonesian house. Wake up on the floor, take the seat Granny points to, and play a round of congklak against her.

## Run on desktop

With Node.js 22.12 or newer installed, run:

```sh
npm ci
npm start
```

Choose **Wake up**, then **Sit down**. On your turn, click an occupied pit on the near row or press **1–6** from left to right. Your store is on the left. A round ends when either row empties after sowing resolves.

Each side starts with six small pits and four seeds in each pit, for 48 seeds total. Win to burn one pit for the rest of the run. Draw to replay the same board. Lose and Granny lunges into a close stare before game over. Click the rulebook on the table to read the rules and find its final clue. See [core gameplay](docs/core-game.md) and the [congklak rules](docs/congklak-rules.md).

## Camera and SmartSpectra

The bottom-left **Camera & signals** panel previews facial analysis. Choose **Enable camera** to start your webcam. **Stop camera** releases it. The **−** button collapses the panel while capture continues. **Facial hurdles: Off / On** toggles gameplay integration and starts the camera if needed. It starts off.

Copy `.env.example` to `.env.local` in the project root and set `SMARTSPECTRA_API_KEY` to your Presage developer key, then restart `npm start`. An existing environment variable takes precedence. Alternatively, enter a key through the panel's **API key** section. An entered key lasts for this app session only. Keys are not included in the renderer build, saved in browser storage, or committed. Each testing machine needs its own local configuration.

The Electron app uses SmartSpectra Node SDK **3.5.0** with its bundled native runtime. Use a supported desktop platform (Windows x64, Apple Silicon macOS, or glibc 2.35+ Linux x64/ARM64). `npm ci` installs the native dependencies for all supported platforms. Camera processing requires the desktop app; browser development supports a live preview only. Online authentication and available SmartSpectra credits are required for detection.

The SDK requests only **facial landmarks, eye blink, talking, and facial expression**. All four readouts are visible beneath the preview. There are no rate-analysis warm-up countdowns. Keep one face visible in even front lighting. Capture requests 640 × 480 at 30 fps to limit pixel-copy overhead alongside the 3D game; cameras may negotiate different settings.

**Facing camera** shows **Toward / Away** using the eye corners, nose, and chin from SmartSpectra's 478-point landmark layout. It estimates head direction from relative landmark positions, with brief smoothing to reduce flicker. This is an uncalibrated heuristic; moving just your eyes can leave the head-direction estimate unchanged. It has not been calibrated across people, camera positions, or facial proportions. Missing, malformed, unstable, or stale landmarks show a dash instead of a direction. The landmark layout follows the [MediaPipe face connections](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/python/solutions/face_mesh_connections.py) and [canonical face model](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/modules/face_geometry/data/canonical_face_model.obj).

**Eye blink** briefly holds a detected blink for 350 ms so it remains visible between UI updates. **Talking** displays the SDK's camera-based detection without microphone audio. **Expression** displays the highest-scoring SDK classification and its confidence: angry, contempt, disgust, fear, happy, neutral, sad, surprise, or unspecified. These are model classifications. Unstable or missing signals show a dash; readings expire after 1.5 seconds without a fresh sample. Losing the face or resetting tracking clears previous detections. Pulse, breathing, HRV, and EDA are neither requested nor displayed.

Camera access, missing cameras, busy/disconnected devices, missing or rejected keys, exhausted credits, network failures, and low frame rate have recoverable messages. A signal failure preserves the preview and offers **Retry signals**. Sustained low frame rate never triggers an automatic restart. If it occurs, improve lighting and close competing apps before retrying. An unavailable native runtime leaves the game and preview usable.

With facial hurdles on, spending five seconds choosing a pit brings Granny close to ask whether you're having fun. Hold a confident happy expression briefly to return to your unchanged board. Other expressions gradually increase hidden anger through three dialogue stages and an escalating scream before game over. Uncertain or missing tracking pauses the encounter. Turning the mode off resumes play. See the [full encounter rules](docs/core-game.md#granny-wants-a-smile).

Video and signal processing stay on-device. The game does not record the feed or persist measurements, request microphone access, or request LLM insights. SDK session and readiness telemetry are disabled. Authentication still contacts Presage. See the [official Electron integration](https://smartspectra.presagetech.com/docs/nodejs/), [metric schema](https://smartspectra.presagetech.com/docs/data-types/), and [measurement guidance](https://smartspectra.presagetech.com/docs/measurement-quality/).

## Develop

- `npm run dev` starts the Babylon.js renderer in a browser.
- `npm run build` builds the renderer and sandboxed Electron preload.
- `npm test` checks the rules, seed conservation, facial hurdles, signal quality handling, and camera/session lifecycle.
- `blender --background --python art/build-granny.py` rebuilds the animated Granny GLB with Blender 5.x. The room, candlelight, furniture, and carved board are generated by the renderer.
- `python art/generate-screams.py` rebuilds the original scream effects and the looping pressure layer with Python's standard library.

The gamelan, ignition, and wood impacts are bundled in `public/audio/`. Wood impacts are from Kenney's CC0 Impact Sounds pack, with its license included alongside the files.
