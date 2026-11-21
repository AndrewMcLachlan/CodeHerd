import path from 'path';
import type { ForgeConfig, MakerBase } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';

const makers: MakerBase<unknown>[] = [
  new MakerZIP({}, ['win32', 'linux', 'darwin']),
];

// Only load platform-specific makers if available (installed in CI per-platform)
try {
  const { MakerSquirrel } = require('@electron-forge/maker-squirrel');
  const { version } = require('./package.json');
  makers.push(new MakerSquirrel({
    name: 'codeherd',
    // Squirrel files the Start Menu shortcut under Programs\<authors>\, which
    // otherwise defaults to package.json's author (a personal name). Override
    // just the nuspec authors so the folder is "CodeHerd" — package.json's
    // author still drives the deb maintainer, About dialog, and copyright.
    authors: 'CodeHerd',
    // Same name-platform-arch-version scheme as every other artifact.
    setupExe: `CodeHerd-win32-x64-${version}-Setup.exe`,
    setupIcon: path.resolve(__dirname, 'assets', 'icon.ico'),
    // Drives the app.ico that the Add/Remove Programs entry (DisplayIcon) uses.
    // Without it electron-winstaller defaults to Electron's own icon; point it at
    // our committed icon so the installed app is branded, not a generic Electron atom.
    iconUrl: 'https://raw.githubusercontent.com/AndrewMcLachlan/CodeHerd/main/assets/icon.ico',
    noMsi: true,
  }));
} catch {}

try {
  const { MakerDMG } = require('@electron-forge/maker-dmg');
  const { version } = require('./package.json');
  makers.push(new MakerDMG({
    // Match the zip naming scheme (name-platform-arch-version) so every release
    // asset is stable and self-describing; title keeps the mounted volume pretty.
    name: `CodeHerd-darwin-${process.arch}-${version}`,
    title: 'CodeHerd',
  }));
} catch {}

// packagerConfig.icon only brands Windows and macOS. Without this the deb/rpm
// makers fall back to their bundled generic Electron icon, so the launcher and
// app menu show the wrong icon even though the window icon is right. A sized
// map installs into /usr/share/icons/hicolor, where desktops resolve the
// .desktop entry's Icon=codeherd.
const linuxIcon = { '256x256': path.resolve(__dirname, 'assets', 'icon.png') };

try {
  const { MakerDeb } = require('@electron-forge/maker-deb');
  makers.push(new MakerDeb({
    options: {
      name: 'codeherd',
      productName: 'CodeHerd',
      maintainer: 'Andrew McLachlan',
      homepage: 'https://github.com/AndrewMcLachlan/CodeHerd',
      icon: linuxIcon,
    },
  }));
} catch {}

// Fedora, RHEL and its rebuilds, and openSUSE. The maker hard-fails `make` when
// rpmbuild is missing, so only register it where rpmbuild exists: local Linux
// builds still get deb + zip, and CI installs rpm and the release workflow's
// expected-artifacts check fails if the .rpm does not appear.
try {
  require('child_process').execFileSync('rpmbuild', ['--version'], { stdio: 'ignore' });
  const { MakerRpm } = require('@electron-forge/maker-rpm');
  const { version } = require('./package.json');
  makers.push(new MakerRpm({
    options: {
      name: 'codeherd',
      productName: 'CodeHerd',
      homepage: 'https://github.com/AndrewMcLachlan/CodeHerd',
      license: 'MIT',
      icon: linuxIcon,
      // RPM forbids '-' in Version and the installer swaps it for '.', but
      // 1.0.0.rc2 sorts AFTER 1.0.0, so the final release would never upgrade
      // over a pre-release. '~' is RPM's pre-release marker: 1.0.0~rc2 < 1.0.0.
      version: version.replace(/-/g, '~'),
      // Electron links libasound.so.2 but the installer's default requires omit
      // it, so a minimal RHEL/Rocky 8 install launches with "libasound.so.2:
      // cannot open shared object file". Merged with the installer's defaults.
      // Fedora/RHEL call it alsa-lib, openSUSE libasound2.
      requires: ['(alsa-lib or libasound2)'],
    },
  }));
} catch {}

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/{node-pty,node-pty/**}',
    },
    name: 'CodeHerd',
    executableName: 'codeherd',
    icon: path.resolve(__dirname, 'assets', process.platform === 'darwin' ? 'icon-mac' : 'icon'),
    appBundleId: 'com.andrewmclachlan.codeherd',
    // Squirrel files the Start Menu shortcut under Programs\<exe CompanyName>\,
    // which defaults to package.json's author (a personal name). Stamp the exe's
    // CompanyName resource with the product name so the folder is "CodeHerd".
    win32metadata: {
      CompanyName: 'CodeHerd',
    },
    darwinDarkModeSupport: true,
    extendInfo: {
      CFBundleDisplayName: 'CodeHerd',
    },
  },
  hooks: {
    postPackage: async (_config, options) => {
      if (process.platform !== 'darwin') return;
      const fs = await import('fs');
      const plistPath = path.join(options.outputPaths[0], 'CodeHerd.app', 'Contents', 'Info.plist');
      if (fs.existsSync(plistPath)) {
        let plist = fs.readFileSync(plistPath, 'utf-8');
        plist = plist.replace(
          /<key>CFBundleDisplayName<\/key>\s*<string>[^<]*<\/string>/,
          '<key>CFBundleDisplayName</key>\n    <string>CodeHerd</string>',
        );
        fs.writeFileSync(plistPath, plist);
      }
      // Without a signing identity, packager leaves only the executable's
      // linker signature, so the bundle as a whole is unsealed (and editing
      // Info.plist above would break any seal anyway). On Apple Silicon,
      // Gatekeeper reports such a quarantined app as "damaged" with no Open
      // Anyway option. Re-seal the whole bundle ad-hoc as the last step so the
      // documented unsigned-app flow works.
      const appPath = path.join(options.outputPaths[0], 'CodeHerd.app');
      // node-pty's prebuilt spawn-helper arrives from npm without its execute
      // bit, so every pty spawn fails with "posix_spawnp failed". Restore it
      // before sealing, since the mode is part of what the user receives.
      const prebuilds = path.join(appPath, 'Contents', 'Resources', 'app.asar.unpacked',
        'node_modules', 'node-pty', 'prebuilds');
      if (fs.existsSync(prebuilds)) {
        for (const dir of fs.readdirSync(prebuilds)) {
          const helper = path.join(prebuilds, dir, 'spawn-helper');
          if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
        }
      }
      const { execFileSync } = await import('child_process');
      execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
      execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
    },
  },
  // node-pty ships N-API prebuilds for each supported platform. Rebuilding it
  // discards those binaries and unnecessarily requires a native toolchain.
  rebuildConfig: {
    ignoreModules: ['node-pty'],
  },
  makers,
};

export default config;
