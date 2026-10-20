import { ValueOf } from 'type-fest';

/**
 * The readable definition of a hotkey.
 */
export interface KeyboardShortcutDefinition {
  id: string;
  description: string;
}

/**
 * The combination of key presses that will activate a hotkey if pressed.
 */
export interface KeyCombination {
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
  keyCode: number;
}

/**
 * The collection of a hotkey's key combinations for each platforms.
 */
export interface PlatformKeyCombinations {
  macKeys: KeyCombination[];
  // The key combinations for both Windows and Linux.
  winLinuxKeys: KeyCombination[];
}

export type KeyboardShortcut =
  | 'workspace_showSettings'
  | 'request_showSettings'
  | 'preferences_showKeyboardShortcuts'
  | 'preferences_showGeneral'
  | 'request_quickSwitch'
  | 'request_showRecent'
  | 'request_showRecentPrevious'
  | 'plugin_reload'
  | 'showAutocomplete'
  | 'request_send'
  | 'request_showOptions'
  | 'environment_showEditor'
  | 'environment_showSwitchMenu'
  | 'request_toggleHttpMethodMenu'
  | 'request_toggleHistory'
  | 'request_focusUrl'
  | 'request_showGenerateCodeEditor'
  | 'sidebar_focusFilter'
  | 'sidebar_toggle'
  | 'response_focus'
  | 'showCookiesEditor'
  | 'request_createHTTP'
  | 'request_showDelete'
  | 'request_showCreateFolder'
  | 'request_showDuplicate'
  | 'request_togglePin'
  | 'environment_showVariableSourceAndValue'
  | 'beautifyRequestBody'
  | 'graphql_explorer_focus_filter';

/**
 * The collection of defined hotkeys.
 * The registry maps a hotkey by its reference id to its key bindings.
 */
export type HotKeyRegistry = Record<KeyboardShortcut, PlatformKeyCombinations>;

// HTTP version codes
export const HttpVersions = {
  V1_0: 'V1_0',
  V1_1: 'V1_1',
  V2PriorKnowledge: 'V2PriorKnowledge',
  V2_0: 'V2_0',
  v3: 'v3',
  default: 'default',
} as const;

export type HttpVersion = ValueOf<typeof HttpVersions>;

export enum UpdateChannel {
  stable = 'stable',
  beta = 'beta',
}

/** Gets a subset of Settings where the values match a condition */
export type SettingsOfType<MatchType> = NonNullable<{
  [Key in keyof Settings]: Settings[Key] extends MatchType ? Key : never;
}[keyof Settings]>;

export interface PluginConfig {
  disabled: boolean;
  // runs with Node.js, as the app does, rather than in a sandbox (plugins/sandbox)
  fullAccess?: boolean;
  // the folder it was allowed for: a plugin of the same name elsewhere runs sandboxed
  fullAccessDirectory?: string;
}

export type PluginConfigMap = Record<string, PluginConfig>;

export interface Settings {
  // the theme follows the OS's light or dark (lightTheme, darkTheme); on out of the box
  autoDetectColorScheme: boolean;
  // set once the out-of-the-box theme has been switched to follow the OS (0.5): an
  // install from before keeps a theme of its own, and isn't switched again after
  autoDetectColorSchemeDefaulted: boolean;
  autoHideMenuBar: boolean;
  autocompleteDelay: number;
  /** Opt-in: ask GitHub for the latest release and show a notice when it's newer. */
  checkForNewReleases: boolean;
  clearOAuth2SessionOnRestart: boolean;
  darkTheme: string;
  deviceId: string | null;
  disableHtmlPreviewJs: boolean;

  disableResponsePreviewLinks: boolean;

  /** @deprecated Unused; the release notice is controlled by checkForNewReleases. */
  disableUpdateNotification: boolean;
  editorFontSize: number;
  editorIndentSize: number;
  editorIndentWithTabs: boolean;
  editorKeyMap: string;
  editorLineWrapping: boolean;

  /** If true, Insomnium will send anonymous data about features and plugins used. */
  enableAnalytics: boolean;
  filterResponsesByEnv: boolean;
  followRedirects: boolean;
  fontInterface: string | null;
  fontMonospace: string | null;
  fontSize: number;
  fontVariantLigatures: boolean;
  forceVerticalLayout: boolean;
  hotKeyRegistry: HotKeyRegistry;
  httpProxy: string;
  httpsProxy: string;
  showVariableSourceAndValue: boolean;
  /** Unsafe legacy renegotiation and lenient TLS shutdown, for old servers */
  legacyTls: boolean;
  // the app's language (common/i18n.ts): a code, or '' for the OS's
  language: string;
  lightTheme: string;
  lineWrapping?: boolean;
  maxHistoryResponses: number;
  maxRedirects: number;
  maxTimelineDataSizeKB: number;
  noProxy: string;
  nunjucksPowerUserMode: boolean;
  pluginConfig: PluginConfigMap;
  pluginPath: string;
  /** Where plugins are installed from, when not the npm registry */
  pluginRegistry: string;
  preferredHttpVersion: HttpVersion;
  proxyEnabled: boolean;
  /** With the proxy off, use the system's: OS settings, or HTTP(S)_PROXY */
  useSystemProxy: boolean;
  showPasswords: boolean;
  theme: string;
  timeout: number;
  /** @deprecated Unused; there is no auto-updater. */
  updateAutomatically: boolean;
  /** @deprecated Unused; there is no auto-updater. */
  updateChannel: UpdateChannel;
  useBulkHeaderEditor: boolean;
  useBulkParametersEditor: boolean;
  validateAuthSSL: boolean;
  validateSSL: boolean;
  /** OS environment variables templates may read: names, or prefixes ending in * */
  allowedEnvironmentVariables: string;
  /** A .env file to read them from when the OS environment has no value */
  dotenvFile: string;
  // the secret-manager secrets templates may read (templating/secret-managers.ts)
  allowedSecrets: string;
  /** Also trust the OS certificate store, on top of the bundled roots */
  useSystemCertificates: boolean;

  // Tokens used when fetching .proto sources from private GitHub repos or
  // private BSR modules. Empty string = no auth (public sources only).
  bufToken: string;
  githubToken: string;

  // MCP automation: when enabled, Insomnium exposes a loopback HTTP+SSE
  // server that MCP clients (e.g. Claude Code) can connect to in order to
  // list/run requests. Token is auto-generated on first enable.
  mcpEnabled: boolean;
  mcpPort: number;   // 0 = pick free
  mcpToken: string;

  // The AI assistant (main/ai.ts): an OpenAI-compatible endpoint, its model,
  // and a key for it if it needs one. Empty = off.
  aiBaseUrl: string;
  aiModel: string;
  aiApiKey: string;
}
