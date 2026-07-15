import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const outdir = 'dist';

async function build() {
  // Clean dist
  fs.rmSync(outdir, { recursive: true, force: true });
  fs.mkdirSync(outdir, { recursive: true });

  // Main process bundle
  await esbuild.build({
    entryPoints: ['src/main/main.ts'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: path.join(outdir, 'main.js'),
    external: ['electron', 'node-pty'],
    format: 'cjs',
    sourcemap: true,
  });

  // Preload script bundle
  await esbuild.build({
    entryPoints: ['src/preload/preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: path.join(outdir, 'preload.js'),
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
  });

  // About preload script
  await esbuild.build({
    entryPoints: ['src/preload/about-preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: path.join(outdir, 'about-preload.js'),
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
  });

  // Preferences preload script
  await esbuild.build({
    entryPoints: ['src/preload/preferences-preload.ts'],
    bundle: true,
    platform: 'node',
    target: 'node24',
    outfile: path.join(outdir, 'preferences-preload.js'),
    external: ['electron'],
    format: 'cjs',
    sourcemap: true,
  });

  // Renderer bundle
  await esbuild.build({
    entryPoints: ['src/renderer/renderer.ts'],
    bundle: true,
    platform: 'browser',
    target: 'chrome144',
    outfile: path.join(outdir, 'renderer.js'),
    format: 'iife',
    sourcemap: true,
  });

  // Copy static files
  fs.copyFileSync('src/renderer/index.html', path.join(outdir, 'index.html'));
  fs.copyFileSync('src/renderer/styles.css', path.join(outdir, 'styles.css'));
  fs.copyFileSync('src/renderer/about.html', path.join(outdir, 'about.html'));
  fs.copyFileSync('src/renderer/preferences.html', path.join(outdir, 'preferences.html'));
  fs.copyFileSync('src/renderer/themes.css', path.join(outdir, 'themes.css'));

  // Copy app icons
  fs.copyFileSync(path.join('assets', 'icon.png'), path.join(outdir, 'icon.png'));
  const menuIconSrc = path.join('assets', 'menu-icon.png');
  if (fs.existsSync(menuIconSrc)) {
    fs.copyFileSync(menuIconSrc, path.join(outdir, 'menu-icon.png'));
  }

  // Copy xterm.css from the xterm package. index.html hard-links ./xterm.css,
  // and without it xterm renders unstyled: the helper textarea it normally
  // hides off-screen becomes a visible, resizable box that displays raw input
  // (including mouse-tracking reports). Resolve through Node rather than a
  // literal node_modules path so hoisted/linked layouts work, and fail the
  // build rather than silently shipping a broken app.
  let xtermCss: string;
  try {
    xtermCss = require.resolve('@xterm/xterm/css/xterm.css');
  } catch {
    throw new Error(
      'Could not resolve @xterm/xterm/css/xterm.css — the renderer would be unstyled. Is node_modules installed and intact?',
    );
  }
  fs.copyFileSync(xtermCss, path.join(outdir, 'xterm.css'));

  console.log('Build complete.');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
