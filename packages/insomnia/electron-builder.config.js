const BINARY_PREFIX = "Insomnium.Core";

// NOTE: USE_HARD_LINKS
// https://github.com/electron-userland/electron-builder/issues/4594#issuecomment-574653870

/**
 * @type {import('electron-builder').Configuration}
 * @see https://www.electron.build/configuration/configuration
 */
const config = {
  npmRebuild: false,
  appId: "com.insomnium.app",
  // Without this, electron-builder writes "Copyright © <year> <author name>"
  // into the macOS Info.plist and the Windows exe and installer, and author is
  // the maintainer, not the copyright holder. Mirror LICENSE instead.
  copyright:
    "Copyright (c) Insomnia REST Client, Copyright (c) 2023 Insomnium REST Client",
  protocols: [
    {
      name: "Insomnium",
      role: "Viewer",
      schemes: ["insomnia"],
    },
  ],
  files: [
    {
      from: "./build",
      to: ".",
      filter: ["**/*", "!opensource-licenses.txt"],
    },
    "./package.json",
  ],
  publish: null,
  extraResources: [
    {
      from: "./bin",
      to: "./bin",
      filter: "yarn-standalone.js",
    },
    {
      from: "./build",
      to: ".",
      filter: "opensource-licenses.txt",
    },
    // Public half of the APT signing key. The deb postinst copies this to
    // /usr/share/keyrings so apt can verify the repo. Harmless on other platforms.
    {
      from: "./packaging/linux",
      to: ".",
      filter: "insomnium-archive-keyring.gpg",
    },
  ],
  extraMetadata: {
    main: "main.min.js", // Override the main path in package.json
  },
  fileAssociations: [],
  mac: {
    // Skip code signing for local/dev builds. CI sets CSC_LINK to enable signing.
    identity: process.env.CSC_LINK ? undefined : null,
    hardenedRuntime: true,
    category: "public.app-category.developer-tools",
    entitlements: "./build/static/entitlements.mac.inherit.plist",
    entitlementsInherit: "./build/static/entitlements.mac.inherit.plist",
    artifactName: `${BINARY_PREFIX}-\${version}.\${ext}`,
    // arm64 only: Electron has dropped Intel (x86_64) macOS support, so a
    // "universal" build would just bloat the artifact with a dead Intel slice.
    target: [
      {
        target: "dmg",
        arch: "arm64",
      },
      {
        target: "zip",
        arch: "arm64",
      },
    ],
    extendInfo: {
      NSRequiresAquaSystemAppearance: false,
    },
    // Notarize only when an App Store Connect API key is provided (CI). electron-builder
    // picks up APPLE_API_KEY (path to .p8) + APPLE_API_KEY_ID + APPLE_API_ISSUER from the env.
    // Local/dev builds (no APPLE_API_KEY) skip notarization.
    notarize: process.env.APPLE_API_KEY ? true : false,
    asarUnpack: ["node_modules/@getinsomnia/node-libcurl"],
  },
  dmg: {
    window: {
      width: 540,
      height: 380,
    },
    contents: [
      {
        x: 130,
        y: 186,
      },
      {
        x: 409,
        y: 186,
        type: "link",
        path: "/Applications",
      },
    ],
  },
  win: {
    target: [
      {
        target: "squirrel",
      },
      {
        target: "portable",
      },
    ],
  },
  squirrelWindows: {
    artifactName: `${BINARY_PREFIX}-\${version}.\${ext}`,
    iconUrl:
      "https://github.com/yokomohoyo/insomnium/blob/main/packages/insomnia/src/icons/icon.png?raw=true",
  },
  portable: {
    artifactName: `${BINARY_PREFIX}-\${version}-portable.\${ext}`,
  },
  linux: {
    artifactName: `${BINARY_PREFIX}-\${version}.\${ext}`,
    icon: "src/icons",
    executableName: "insomnium",
    synopsis: "The Collaborative API Client and Design Tool",
    category: "Development",
    desktop: {
      entry: {
        Name: "Insomnium",
        Comment:
          "Insomnium is a cross-platform REST client, built on top of Electron.",
        Categories: "Development",
        Keywords: "GraphQL;REST;gRPC;SOAP;openAPI;GitOps;",
      },
    },
    target: [
      {
        target: "AppImage",
      },
      {
        target: "deb",
      },
      {
        target: "tar.gz",
      },
      {
        target: "rpm",
      },
      // No snap here: `npm run package:snap` builds it afterwards from the
      // finished dist/linux-unpacked. The snap target (core22 template build,
      // app-builder-lib targets/snap/coreLegacy.js, unchanged in 26.17.0)
      // deletes chrome-sandbox from that shared dir while the targets above
      // are still packing it in parallel. Building them together is why the
      // deb and rpm shipped without it (so no SUID sandbox fallback on hosts
      // without unprivileged user namespaces) and why the AppImage build
      // sometimes failed with "copyfile .../chrome-sandbox ENOENT".
    ],
  },
  deb: {
    // Becomes fpm's --category, i.e. the control file's Section (fpm's default,
    // "default", is not a real Debian section). Don't set it via
    // `fpm: ["--deb-field", ...]` — that appends a second Section line, which
    // newer dpkg rejects outright (#131).
    packageCategory: "devel",
    // Setting this replaces electron-builder's default list, so it is copied
    // verbatim (FpmTarget.getDefaultDepends) plus two libraries Electron links
    // directly that the defaults don't pull in everywhere: without them the app
    // won't start on a minimal install.
    // - ALSA: Ubuntu 24.04+ renamed it libasound2t64; the alternative keeps
    //   older Debian/Ubuntu working.
    // - libgbm1: missing on Ubuntu 22.04.
    depends: [
      "libgtk-3-0",
      "libnotify4",
      "libnss3",
      "libxss1",
      "libxtst6",
      "xdg-utils",
      "libatspi2.0-0",
      "libuuid1",
      "libsecret-1-0",
      "libasound2t64 | libasound2",
      "libgbm1",
    ],
    // These REPLACE electron-builder's built-in templates rather than extending
    // them — both files start as verbatim copies of the originals. See the note
    // at the top of each.
    afterInstall: "packaging/linux/after-install.tpl",
    afterRemove: "packaging/linux/after-remove.tpl",
  },
  rpm: {
    // Same gap as deb.depends above: this replaces electron-builder's default
    // list, copied verbatim, and fpm adds no automatic requires, so without the
    // last two the app won't start on a minimal Fedora, RHEL or openSUSE
    // install (libasound.so.2 and libgbm.so.1 not found). They're required by
    // soname rather than package name because every RPM distro provides those
    // names from its own package: alsa-lib and mesa-libgbm on Fedora/RHEL,
    // libasound2 and libgbm1 on openSUSE.
    depends: [
      "gtk3",
      "libnotify",
      "nss",
      "libXScrnSaver",
      "(libXtst or libXtst6)",
      "xdg-utils",
      "at-spi2-core",
      "(libuuid or libuuid1)",
      "libasound.so.2()(64bit)",
      "libgbm.so.1()(64bit)",
    ],
  },
  // Only used by `npm run package:snap`; see the note in linux.target.
  snap: {
    base: "core22",
    // Secret Service / KWallet access for saved credentials. Not auto-connected:
    // `sudo snap connect insomnium:password-manager-service` (the app says so).
    plugs: ["default", "password-manager-service"],
  },
};

// Windows: signed with Azure Artifact Signing when the release workflow passes
// the account (the windows-signing environment). electron-builder runs
// Microsoft's TrustedSigning module for every .exe it builds, Squirrel's
// Update.exe and Setup.exe included; the Azure login is the workflow's. A build
// so configured must come out signed.
const {
  AZURE_SIGNING_ENDPOINT,
  AZURE_SIGNING_ACCOUNT,
  AZURE_SIGNING_PROFILE,
  AZURE_SIGNING_PUBLISHER,
} = process.env;
if (AZURE_SIGNING_ENDPOINT && AZURE_SIGNING_ACCOUNT && AZURE_SIGNING_PROFILE && AZURE_SIGNING_PUBLISHER) {
  config.win.azureSignOptions = {
    // the certificate's subject CN, exactly
    publisherName: AZURE_SIGNING_PUBLISHER,
    endpoint: AZURE_SIGNING_ENDPOINT,
    codeSigningAccountName: AZURE_SIGNING_ACCOUNT,
    certificateProfileName: AZURE_SIGNING_PROFILE,
  };
  config.forceCodeSigning = true;
}

const {
  env: { BUILD_TARGETS },
  platform,
} = process;
const targets = BUILD_TARGETS?.split(",");
if (platform && targets) {
  console.log("overriding build targets to: ", targets);
  const PLATFORM_MAP = { darwin: "mac", linux: "linux", win32: "win" };
  config[PLATFORM_MAP[platform]].target = config[
    PLATFORM_MAP[platform]
  ].target.filter(({ target }) => targets.includes(target));
}
module.exports = config;
