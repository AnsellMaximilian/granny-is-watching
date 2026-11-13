# Core gameplay

The player wakes up on the floor of a candlelit house and rises to see Granny. She approaches the table, sits, and points across it. **Sit down** takes the player to the overhead congklak board.

Horror gamelan starts looping when the player selects **Wake up**. Four wood impacts alternate with individual seed landings. Fire ignition accompanies every pit burn and both burning endings. A synthesized scream plays with Granny's loss lunge and with the fire that takes her in the true ending. The background music dips during screams. **Sound on / Sound off** mutes or restores all audio.

## Camera and signals preview

An optional **Camera & signals** panel sits at the bottom left throughout the game. **Enable camera** starts a mirrored live webcam preview. **Stop camera** releases the webcam and clears its readings. The **− / +** button collapses or expands the panel without stopping capture. If more than one camera is available, a selector lets the player switch. Camera or signal errors do not interrupt the game.

In Electron, SmartSpectra requests only facial landmarks, eye blink, talking, and facial expression. All four appear beneath the preview without rate-analysis warm-up countdowns. **Facing camera** estimates **Toward / Away** from the relative positions of the eyes, nose, and chin, with brief smoothing. This estimates head direction; eye movements alone can leave it unchanged. **Eye blink** holds a recent detection for 350 ms so it is visible. **Talking** uses facial analysis without microphone audio. **Expression** shows the highest-scoring SDK classification and its confidence.

Live guidance reports face positioning, lighting, movement, and camera readiness. Missing, unstable, malformed, or stale signals show a dash with a reason. Readings expire after 1.5 seconds without a fresh sample. Losing the face or resetting tracking clears previous detections. Fresh SDK **no face** or **face not forward** feedback also shows **Facing camera: Away**, with its source explained. A camera error remains unknown. Pulse, breathing, HRV, and EDA are not requested. A missing or rejected key can be supplied through **API key**. Signal failures keep the preview available and offer a manual retry; camera failures offer a fresh start.

**Facial hurdles: Off / On** toggles the optional facial gameplay mode. It starts off and can be changed at any time. Enabling it also opens the camera if needed. With it off, facial signals remain a diagnostic preview. The game does not record the webcam, save measurements, capture microphone audio, or request LLM insights. SDK telemetry is disabled. See the [setup instructions](../README.md#camera-and-smartspectra) for the local key and camera requirements.

## Granny wants a smile

With facial hurdles enabled, five seconds spent choosing a pit on the player's turn brings the POV up to Granny. She asks, **“Are you having fun, child?”** Pit selection pauses while she waits for a happy face. This can also happen on a bonus choice. Time spent sowing, on Granny's turn, in the rulebook, configuring the camera, or outside the focused game window does not advance the timer. The timer also waits for reliable expression tracking.

Hold a stable **Happy** classification with at least 45% confidence for about 0.9 seconds to settle her. Brief classification flickers erode that hold gradually. The view returns to the same board, scores, and pending choice. She does not ask again until the player makes a move and a new choice begins.

Other expressions do not fail the encounter immediately. After a 1.5-second grace period, a hidden anger value rises toward failure over eight seconds of reliable non-happy tracking. A happy face reduces anger. Granny's lines change over three stages, the camera moves closer, and a quiet synthesized scream grows louder and sharper. At the limit she lunges closer with the existing loss scream and the run ends in **Game over**.

Missing, stale, unstable, low-confidence, or unspecified expression data pauses both anger and smile progress. The prompt explains when tracking is paused. Leaving the game window also pauses the encounter and fades the pressure audio. Switching facial hurdles off returns to the board without changing any seeds.

## Do not look at her

For this milestone, **Debug: Upside-down Granny** manually starts this encounter while facial hurdles are on and the player is choosing a pit. There are no random appearances yet. An isolated copy of Granny's head slides down from the top, upside down with black eyes and her hair toward the player's side. Her head stays above the near row. The overhead camera and all legal pit controls remain usable. The rulebook is unavailable during her visit, and the smile timer is suspended.

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

The ending begins after Granny's remark on the final burn. **Start a new run** returns to the wake-up scene with all pits restored. Burned pits belong to the current run.

## Lose and face Granny

When Granny wins, the view cuts from the board to her. She lunges into a close stare, then the game shows **Game over** and the final score. The scene uses the existing Granny model and the framing of the [stare reference](reference-images/granny-staring.jpg). The [powder reference](reference-images/granny-blowing-powder.jpg) is saved for future scenes.
