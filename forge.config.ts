import type { ForgeConfig, MakerBase } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';

const makers: MakerBase<unknown>[] = [
  new MakerZIP({}, ['win32', 'linux', 'darwin']),
];

// Only load platform-specific makers if available (installed in CI per-platform)
try {
  const { MakerDMG } = require('@electron-forge/maker-dmg');
  makers.push(new MakerDMG({}));
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
    asar: true,
    name: 'CodeHerd',
    executableName: 'codeherd',
    icon: './assets/icon',
  },
  rebuildConfig: {},
  makers,
};

export default config;
