Windows x64 preview build of **Granny is Watching**.

- Download the **setup.exe** for the per-user installer, or extract the **ZIP** and run **Granny is Watching.exe**. Keep all files from the ZIP together.
- Node.js and a source checkout are not required. The game, audio, Granny model, and SmartSpectra native runtime are bundled.
- Facial analysis also requires the [latest Microsoft Visual C++ x64 runtime](https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist/). Install or update it if the game reports that the native facial runtime is unavailable. The base game remains playable without facial analysis.
- Facial hurdles are optional and start off. To enable them, enter **your own SmartSpectra API key** in **Settings → API key**, then turn on facial hurdles. Keys entered here last for the app session. Online Presage authentication and available credits are required for facial analysis.
- Progress and preferences are stored only on this PC. Saves survive upgrades; no online account or cloud sync is used.
- Early builds are unsigned unless Windows signing credentials have been configured. Windows may show an unknown-publisher/SmartScreen prompt.
- `SHA256SUMS.txt` contains checksums for both downloads.

This draft is ready for manual playtesting. Publishing it is a separate action after verification.
