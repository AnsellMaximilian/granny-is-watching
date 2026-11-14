const semver = require('semver');

const version = process.env.RELEASE_VERSION;
if (version && semver.valid(version) !== version) throw new Error('RELEASE_VERSION must be a valid semantic version.');

module.exports = {
  appId: 'com.ansellmaximilian.grannyiswatching',
  productName: 'Granny is Watching',
  directories: { output: 'release' },
  asar: true,
  // Koffi uses its prebuilt Node-API binary; SmartSpectra uses FFI, not an
  // Electron-ABI addon. Rebuilding these packages is unnecessary.
  npmRebuild: false,
  files: [
    'dist/**',
    'electron/*.cjs',
    'package.json',
    '!electron/build-preload.mjs',
    // Renderer dependencies are already bundled into dist by Vite.
    '!node_modules/@babylonjs/**',
    '!node_modules/earcut/**',
    '!node_modules/@smartspectra/node-sdk-*/**',
    '!node_modules/koffi/build/koffi/{darwin_*,freebsd_*,linux_*,musl_*,openbsd_*,win32_arm64,win32_ia32}/**',
  ],
  asarUnpack: ['node_modules/koffi/build/koffi/win32_x64/**'],
  extraMetadata: version ? { version } : {},
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }, { target: 'zip', arch: ['x64'] }],
    executableName: 'Granny is Watching',
    // Keep the full native package outside ASAR, on Node's normal search path.
    // The SDK can then use its own scoped Windows DLL dependency loader.
    extraResources: [{ from: 'node_modules/@smartspectra/node-sdk-win32-${arch}', to: 'node_modules/@smartspectra/node-sdk-win32-${arch}' }],
    signExts: ['.exe', '.dll', '.node'],
    artifactName: 'Granny-is-Watching-${version}-win-${arch}.${ext}',
  },
  nsis: {
    artifactName: 'Granny-is-Watching-${version}-win-${arch}-setup.${ext}',
    oneClick: false,
    perMachine: false,
    allowElevation: false,
    allowToChangeInstallationDirectory: true,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    shortcutName: 'Granny is Watching',
    deleteAppDataOnUninstall: false,
  },
};
