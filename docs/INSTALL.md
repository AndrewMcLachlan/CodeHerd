# Installing CodeHerd

CodeHerd ships unsigned builds — paid code-signing certificates and Apple
notarisation are deliberately out of scope for now. Every release therefore
includes the material to verify what you downloaded, and this page documents
the warnings each operating system shows and how to proceed safely.

## Downloads

Grab the latest release from
[GitHub Releases](https://github.com/AndrewMcLachlan/CodeHerd/releases).
Artifact names are stable and self-describing:

| Platform | Artifact |
|---|---|
| Windows x64 (installer) | `CodeHerd-win32-x64-<version>-Setup.exe` |
| Windows x64 (portable) | `CodeHerd-win32-x64-<version>.zip` |
| macOS Apple Silicon | `CodeHerd-darwin-arm64-<version>.dmg` (or `.zip`) |
| Linux x64 (Debian/Ubuntu) | `codeherd_<version>_amd64.deb` |
| Linux x64 (portable) | `CodeHerd-linux-x64-<version>.zip` |

## Verifying a download

Each release includes a `SHA256SUMS` file:

```sh
# in your download directory
sha256sum -c SHA256SUMS --ignore-missing
```

Releases also carry GitHub build-provenance attestations, which prove an
artifact was built by this repository's CI from a specific commit:

```sh
gh attestation verify CodeHerd-win32-x64-<version>.zip --repo AndrewMcLachlan/CodeHerd
```

## Windows

### Installer (recommended)

1. Run `CodeHerd-win32-x64-<version>-Setup.exe`. It installs per-user into
   `%LocalAppData%\codeherd` — no admin rights, no install wizard, and it
   launches when done.
2. A **Start Menu** entry is created. No desktop shortcut is ever added; make
   one yourself from the Start Menu entry if you want it.
3. **SmartScreen**: the first run of an unsigned installer shows
   *"Windows protected your PC"*. Click **More info → Run anyway**.
4. **Upgrade**: run the newer Setup.exe — it upgrades in place.
5. **Uninstall**: Settings → Apps (Add/Remove Programs) → CodeHerd. To remove
   all data as well, delete `%USERPROFILE%\.codeherd` and `%APPDATA%\CodeHerd`.

### Portable ZIP

1. Download and extract the ZIP to a folder of your choice (e.g.
   `C:\Tools\CodeHerd`), then run `codeherd.exe`. If the ZIP is blocked,
   right-click it → Properties → tick **Unblock** before extracting.
   SmartScreen behaves as above.
2. **Upgrade**: extract the new ZIP over the old folder (or to a new one and
   delete the old). Your settings are stored outside the install folder, so
   they survive.
3. **Uninstall**: delete the folder. To remove all data as well, delete
   `%USERPROFILE%\.codeherd` and `%APPDATA%\CodeHerd`.

## macOS

1. Open the DMG and drag **CodeHerd** to Applications (or unzip and move it).
2. **Gatekeeper**: the first launch of an unsigned app is refused with
   *"CodeHerd can't be opened"*. Either right-click the app → **Open** →
   **Open**, or go to **System Settings → Privacy & Security** and click
   **Open Anyway** next to the CodeHerd message. You only need this once per
   install.
3. **Upgrade**: replace the app in Applications with the new version.
4. **Uninstall**: delete the app. To remove all data, also delete
   `~/.codeherd` and `~/Library/Application Support/CodeHerd`.

Only Apple Silicon (arm64) builds are published. Intel Macs are not currently
supported.

## Linux

Debian/Ubuntu:

```sh
sudo apt install ./codeherd_<version>_amd64.deb   # also upgrades in place
```

Portable: extract the ZIP anywhere and run `codeherd`.

- **Upgrade**: install the new `.deb` (or replace the extracted folder).
- **Downgrade**: `sudo apt install ./codeherd_<older-version>_amd64.deb
  --allow-downgrades`.
- **Uninstall**: `sudo apt remove codeherd`. To remove all data, also delete
  `~/.codeherd` and `~/.config/CodeHerd`.

## Where your data lives

State survives upgrades because it lives outside the install location:

- `~/.codeherd/state.json` — tabs, sessions, preferences (plus `.bak`
  last-known-good backup)
- The per-OS app-data folder above — window state and any opt-in debug logs

While a diagnostic log is being recorded, **Help → Open Diagnostics Folder**
inside the app opens the app-data folder directly; otherwise use the path above.

## Recording a diagnostic log

Some faults — a terminal that stops responding to keystrokes for tens of
seconds, a copy that silently does not reach the clipboard — are intermittent
and cannot be reproduced on demand. CodeHerd can record a timeline to help
diagnose them, but it is off unless asked for, and there is no setting for it:
it is a tool for chasing a specific problem, not something to leave configured.

It records **timing only** — how long the main process stalled and how much
terminal output arrived around the stall, how long each keystroke waited to be
handled, whether clipboard writes succeeded, and how long CodeHerd spent reading
session transcripts. Keys are recorded as *what kind* they were, never as what
you typed: an arrow key appears as `<ESC>[B`, while typed text appears only as a
count such as `<7 chars>`. The log rotates at 5 MB and keeps one previous file,
so it is safe to leave running for as long as it takes for the fault to recur.

**Windows** — set a user environment variable, then start CodeHerd normally:

```powershell
setx CODEHERD_DIAGNOSTICS 1
```

A shortcut carrying `--diagnostics` also works, including while CodeHerd is
already running: only one copy of CodeHerd runs at a time, so the flag is handed
to the copy already open and recording starts there. Note that shortcut arguments
do not survive an upgrade — the installer recreates the shortcut each time it
updates the app — so the environment variable is the setting that sticks.

**macOS and Linux** — launch with the flag, or export the variable:

```bash
CODEHERD_DIAGNOSTICS=1 /Applications/CodeHerd.app/Contents/MacOS/CodeHerd
```

While recording, a **Diagnostics** badge appears at the left of the status bar —
click it to open the folder holding the log. The badge is the only sign the mode
is on, which matters when a run is left recording for days.

The log is written to `diagnostics.log` in the app-data folder (**Help → Open
Diagnostics Folder**, shown only while recording). To stop recording, remove the
variable — `setx CODEHERD_DIAGNOSTICS ""` on Windows — and restart CodeHerd.

`--pty-debug` is a separate, developer-only switch that captures **every byte
the terminal shows**, including prompts and any secrets on screen. It is not
needed for the above and should not be left on.

## Updates

CodeHerd checks GitHub for new releases on startup and shows a notification —
there is no built-in auto-updater. Download and install new versions using the
steps above; installing over an old version preserves your tabs, sessions, and
preferences.
