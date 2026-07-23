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
| Windows x64 | `CodeHerd-win32-x64-<version>.zip` |
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

1. Download and extract the ZIP to a folder of your choice (e.g.
   `C:\Tools\CodeHerd`), then run `codeherd.exe`.
2. **SmartScreen**: the first run of an unsigned app shows
   *"Windows protected your PC"*. Click **More info → Run anyway**.
   If the ZIP itself is blocked, right-click it → Properties → tick
   **Unblock** before extracting.
3. **Upgrade**: extract the new ZIP over the old folder (or to a new one and
   delete the old). Your settings are stored outside the install folder, so
   they survive.
4. **Uninstall**: delete the folder. To remove all data as well, delete
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

**Help → Open Diagnostics Folder** inside the app opens the app-data folder
directly.

## Updates

CodeHerd checks GitHub for new releases on startup and shows a notification —
there is no built-in auto-updater. Download and install new versions using the
steps above; installing over an old version preserves your tabs, sessions, and
preferences.
