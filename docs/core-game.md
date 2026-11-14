# Core gameplay

The player wakes up on the floor of a candlelit house and rises to see Granny. She approaches the table, sits, and points across it. **Sit down** takes the player to the overhead congklak board.

Horror gamelan starts looping when the player selects **Wake up** or **Continue**. Four wood impacts alternate with individual seed landings. Fire ignition accompanies every pit burn and both burning endings. A synthesized scream plays with Granny's loss lunge and with the fire that takes her in the true ending. The background music dips during screams. **Settings → Sound** mutes or restores all audio.

## Settings and local progress

**Settings** groups sound, facial hurdles, progress saving, and camera controls. **Show camera preview** hides or reveals the corner panel without changing encounter behavior. Camera start/stop, device selection, a bounded signal test/retry, and the session-only API key entry are in this menu. Facial timers and pressure pause while Settings is open, and gameplay analysis stops. Seed animations already in progress can finish behind the menu.

**Save progress** starts on. A local checkpoint keeps the burned pits and the four-dot rulebook pattern. It saves the setup of the round, rather than each move. On death from losing a round or failing a facial encounter, **Retry round** restores that setup: four seeds in each unburned small pit, empty stores, and the player moving first. **Start new game** remains available and resets all burned pits and draws a new clue.

**Continue** on the title screen resumes the saved round from its beginning after reopening the game. Completing a nonfatal burn updates the checkpoint to the next round, even before selecting **Next round**. Draws replay the same setup and clue. The false ending and a fatal burn can retry the last playable round; the final burn that removed an entire side is undone. The true ending clears the checkpoint.

The title screen keeps **Continue · Round N** without an extra explanation of saved pits or the clue. Settings shows a short saved-round status, and the death screen shows the round number beside retry. Save errors remain visible. The saving toggle explains that switching it off clears the saved game.

Switching **Save progress** off removes the saved checkpoint and makes death end the run. Preferences are still remembered. Re-enabling saving during a live round checkpoints that round's starting setup. Re-enabling it after a death cannot recover a run that died with saving off. Saving failures are reported in Settings; in-session retries remain available when enabled. Unreadable or incompatible saves cannot be continued, and a new game remains available.

Desktop saves use `progress.json` in Electron's application data directory, with atomic replacement and queued writes. Browser development uses local browser storage. Saves stay on this device/profile, without an account or cloud sync. They contain settings and round setup, never webcam images, measurements, or API keys. Camera access starts through a player action, including starting or continuing with facial hurdles enabled.

Windows installer and ZIP builds keep progress at `%APPDATA%\granny-is-watching\progress.json` across upgrades. Packaged apps do not load the developer's `.env.local`; players provide their own key in Settings or their environment. A bundled-runtime failure recommends installing the latest Microsoft Visual C++ x64 runtime, or reinstalling the game, while leaving the base game playable. See [Windows releases](releases.md) for downloading and testing a build.

## Camera and signals preview

An optional **Camera** panel sits at the bottom left throughout the game. With the camera off, it says **Enable your camera for a live preview.** In Settings, **Enable camera** starts a mirrored live webcam preview. **Stop camera** releases the webcam and clears its readings. The panel's **− / +** button collapses or expands it without stopping capture. If more than one camera is available, Settings offers a device selector. Camera or tracking errors do not interrupt the game.

A live **FPS** counter sits at the bottom right of the preview. It measures video frames presented over a rolling two-second window, rather than showing the requested camera rate or the game's animation rate. It waits briefly for enough samples and turns amber below 25 FPS. A stalled visible preview reaches 0 FPS. Hiding/collapsing the preview or leaving the visible page suspends its measurement; returning starts a fresh window.

**Settings → Camera** shows the camera's reported resolution and FPS mode, the measured preview rate, and the observed **Tracking feed** rate from native frame callbacks. The feed counter includes frames rejected for face/quality reasons; it does not count expression classifications. The last measured feed rate remains marked **Last** when tracking stops or fails so it can be inspected after opening Settings. Camera changes clear it. These counters do not open another capture stream or start facial analysis. The app still requests 640 × 480 at an ideal 30 FPS; a negotiated camera mode is distinct from measured delivery. Low light and concurrent device load can reduce the delivered rate; see [SmartSpectra's measurement guidance](https://smartspectra.presagetech.com/docs/measurement-quality/#frame-rate).

The camera stays live between encounters, but SmartSpectra analysis runs only to prepare for and evaluate a facial hurdle. A badge on the preview shows **Tracking off**, **Starting…**, **Tracking on**, **Stopping…**, or **Unavailable**. Idle preview has no explanatory paragraph or empty readout grid; readings appear when tracking starts and clear when it stops. Errors explain what the player can do, without SDK terminology or development commands. Analysis stops during sowing, Granny's turns, the rulebook, Settings, an unfocused/hidden window, and results/endings. It also stops after a successful smile or the single look-away theft. Clean stops retain the SDK instance for the next encounter; camera stop releases it. An abandoned startup is cancelled so analysis cannot begin after the player has already chosen.

**Test tracking · 15s** in Settings explicitly runs facial analysis for at most 15 seconds, including startup time, even with facial hurdles off. **Stop test** ends it early; **Retry tracking · 15s** is offered after a failure. Returning to normal play can still request analysis for a pending encounter. Entering an API key or enabling the preview alone does not start analysis. Failures stay blocked until a deliberate retry, key replacement, or camera restart; new turns do not retry automatically.

A low-frame-rate warning pauses facial judgments while the SDK continues checking input; it can clear if input improves. A sustained-low-rate **error** ends the analysis session. If the SDK marks that failure retryable, **Retry tracking** appears in the camera panel during an eligible player choice and directly in the smile encounter. It starts one fresh analysis session for the current choice, keeps the board unchanged, and resets the active hurdle's pressure and grace period. It does not start a timed Settings test or an automatic retry loop. Missing/invalid tracking cannot advance anger, a smile hold, or a theft. Settings still allows facial hurdles to be turned off if tracking cannot recover.

On larger previews, the rate beside **Tracking on** counts SDK frame callbacks; the bottom-right rate counts preview frames. They can differ even when the camera reports 30 FPS. Settings shows both rates on every window size. Local diagnostic logs record timestamp cadence, validation transitions, stable facial sample counts, and terminal errors without recording camera images, expression values, face coordinates, or API keys. Development logs are Git-ignored at `.playtest/smartspectra-diagnostics.jsonl`; see the README for location and rotation details. The SDK documents sustained-low-FPS errors as requiring a [user-initiated fresh start](https://smartspectra.presagetech.com/docs/nodejs/migration-guide/), rather than automatic restarting.

In Electron, SmartSpectra requests only facial landmarks, eye blink, talking, and facial expression. While analysis runs, all four appear beneath the preview without rate-analysis warm-up countdowns. **Facing camera** estimates **Toward / Away** from the relative positions of the eyes, nose, and chin, with brief smoothing. This estimates head direction; eye movements alone can leave it unchanged. **Eye blink** holds a recent detection for 350 ms so it is visible. **Talking** uses facial analysis without microphone audio. **Expression** shows the highest-scoring SDK classification and its confidence.

Live guidance reports face positioning, lighting, movement, and camera readiness. Missing, unstable, malformed, or stale signals show a dash with a reason. Readings expire after 1.5 seconds without a fresh sample. Losing the face or resetting tracking clears previous detections. Fresh SDK **no face** or **face not forward** feedback also shows **Facing camera: Away**, with its source explained. A camera error remains unknown. Pulse, breathing, HRV, and EDA are not requested. A missing or rejected key can be supplied through **API key**. Signal failures keep the preview available and offer a manual retry; camera failures offer a fresh start.

**Settings → Facial hurdles** toggles the optional facial gameplay mode. It defaults off on the first launch, and the preference is remembered. Enabling it also opens the camera if needed. With it off, the camera remains available for preview and an explicit signal test. The game does not record the webcam, save measurements, capture microphone audio, or request LLM insights. SDK telemetry is disabled. See the [setup instructions](../README.md#camera-and-smartspectra) for the local key and camera requirements.

## Granny wants a smile

With facial hurdles enabled, analysis prepares after two seconds spent choosing a pit on the player's turn. At five seconds, once a fresh reliable expression is available, the POV comes up to Granny if an upside-down visit has not interrupted that choice. A slower SDK startup delays her appearance without building anger. Choosing a pit before she appears cancels preparation. She asks, **“Are you having fun, child?”** Pit selection pauses while she waits for a happy face. This can also happen on a bonus choice. Time spent sowing, on Granny's turn, in the rulebook, in Settings, configuring the camera, or outside the focused game window does not advance the choice timer. Scheduling itself does not require the SDK to be running.

Hold a stable **Happy** classification with at least 45% confidence for about 0.9 seconds to settle her. Brief classification flickers erode that hold gradually. The view returns to the same board, scores, and pending choice. She does not ask again until the player makes a move and a new choice begins.

Other expressions do not fail the encounter immediately. After a 1.5-second grace period, a hidden anger value rises toward failure over eight seconds of reliable non-happy tracking. A happy face reduces anger. Granny's lines change over three stages, the camera moves closer, and a quiet synthesized scream grows louder and sharper. At the limit she lunges closer with the existing loss scream and the run ends in **Game over**.

Missing, stale, unstable, low-confidence, or unspecified expression data pauses both anger and smile progress. The prompt explains when tracking is paused. Leaving the game window also pauses the encounter and fades the pressure audio. Switching facial hurdles off returns to the board without changing any seeds.

## Do not look at her

While facial hurdles are on, each player pit choice has a 30% chance of an upside-down visit, including bonus choices. The chance is rolled once per choice without requiring facial data. A selected visit targets a random 1.5–3.5 seconds of eligible choosing time, with analysis preparing up to two seconds earlier. Her appearance waits for fresh facing data if startup takes longer. Making a move before she appears cancels that visit. The timer pauses in Settings, the rulebook, or an unfocused window. There is no debug trigger.

An isolated copy of Granny's head slides down from the top, upside down with black eyes and her hair toward the player's side. Her head stays above the near row. The overhead camera and all legal pit controls remain usable. The rulebook is unavailable during her visit, and the smile timer is suspended. A completed smile demand cannot be followed by another encounter during the same choice.

Look away from the webcam while choosing a pit. A fresh **Facing camera: Away** estimate, SDK **face not forward**, or SDK **no face** feedback counts as looking away. Turning just the eyes remains unreliable; turning the head out of view is supported. A disconnected camera, stale feedback, multiple faces, or uncertain landmarks pauses the hurdle instead of counting as either direction.

After a 1.5-second grace period, looking toward her accumulates hidden pressure. Looking away reduces it. A lighter version of the progressive scream builds through three warning stages. Six seconds of accumulated looking-toward time triggers one penalty: Granny takes every seed from one random occupied, unburned player pit and banks them in her store. The transfer is animated and uses a quieter scream. Stores, empty pits, burned pits, and Granny's own pits are never chosen for theft.

She stays until the player chooses a pit, including after a penalty. Each appearance can steal at most once. Choosing dismisses the head and plays the selected move normally. Switching facial hurdles off also dismisses her. If a theft has already started, its transfer finishes. If stealing empties the player's row, the usual remaining-seed sweep and scoring end the round and dismiss her. Burned pits and the next round's starting seed counts are unaffected by theft.

## Play a round

The opening board has six small pits per side, four cowrie seeds per pit, and two empty stores. The player moves first in every round. Click an occupied pit on the near row or press **1–6**. See the [congklak rules](congklak-rules.md) for sowing, relays, captures, and scoring.

## Read the rulebook

Click the book on the table before choosing a move or a pit to burn. It floats up and opens. **Next** and **Previous** turn its pages. **Close** returns the book to the table and resumes the board at the same point.

The last spread shows a clue. A new run draws four marked pits at random, two per side. The marks stay fixed through every round and draw replay in that run. The clue uses the setup diagram's pit size and row and column spacing, with two vertical lines marking the edges of the grid. Granny's row is above the player's row. The cover and illustrated spreads draw from the [cover](reference-images/rulebook-cover.jpg), [setup](reference-images/rulebook-setup.jpg), and [capture](reference-images/rulebook-capture.jpg) references.

## Win and burn a pit

After each win, the camera returns to the seated view and Granny asks which patch of earth to burn. **Choose a pit** brings the camera back to the overhead board. Select one unburned small pit on either side. The camera moves in, and the pit flares for about a second before it chars.

The camera returns to Granny for her remark. Her question and remark change with each burn as the board runs out of fertile ground. Select **Next round** to return to play. Both sides skip burned pits when sowing and cannot select them again during the run. Each playable pit starts with four seeds and both stores start empty, so each burn reduces the next round's total by four.

A draw lets the player replay with the same burned pits.

## Endings

- **False ending.** Burn all six of Granny's pits. She opens the way out and asks you to stand. As you get up, she says the ash needs feeding and fire rises in front of you.
- **True ending.** Burn exactly the four pits marked in the rulebook. The order is up to the player. After the fourth burn, the fire takes Granny.
- **Game over.** A loss to Granny, failing her optional smile demand, or a burn that takes the last playable pit on your own side triggers her close stare.

The ending begins after Granny's remark on the final burn. With saving enabled, deaths offer **Retry round** and **Start new game**. Retry preserves the last playable round's burned pits and clue. **Start new game** returns to the wake-up scene with all pits restored and a new clue. The true ending offers a new game and clears its checkpoint. Burned pits belong to the current run.

## Lose and face Granny

When Granny wins, the view cuts from the board to her. She lunges into a close stare, then the game shows **Game over** and the final score. The scene uses the existing Granny model and the framing of the [stare reference](reference-images/granny-staring.jpg). The [powder reference](reference-images/granny-blowing-powder.jpg) is saved for future scenes.
