import path from 'path';
import type { ForgeConfig, MakerBase } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';

const makers: MakerBase<unknown>[] = [
  new MakerZIP({}, ['win32', 'linux', 'darwin']),
];

// Only load platform-specific makers if available (installed in CI per-platform)
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

try {
  const { MakerDeb } = require('@electron-forge/maker-deb');
  makers.push(new MakerDeb({
    options: {
      name: 'codeherd',
      productName: 'CodeHerd',
      maintainer: 'Andrew McLachlan',
      homepage: 'https://github.com/AndrewMcLachlan/CodeHerd',
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
