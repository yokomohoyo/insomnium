import React, { FC, Fragment } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import {
  EditorKeyMap,
  isMac,
  MAX_EDITOR_FONT_SIZE,
  MAX_INTERFACE_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  MIN_INTERFACE_FONT_SIZE,
} from '../../../common/constants';
import { docsKeyMaps } from '../../../common/documentation';
import { LANGUAGES, resolveLanguage, t } from '../../../common/i18n';
import { HttpVersion, HttpVersions } from '../../../common/settings';
import * as models from '../../../models';
import { initNewOAuthSession } from '../../../network/o-auth-2/get-token';
import { RootLoaderData } from '../../routes/root';
import { Link } from '../base/link';
import { Tooltip } from '../tooltip';
import { BooleanSetting } from './boolean-setting';
import { EnumSetting } from './enum-setting';
import { MaskedSetting } from './masked-setting';
import { NumberSetting } from './number-setting';
import { TextSetting } from './text-setting';

/**
 * We are attempting to move the app away from needing settings changes to restart the app.
 * For now, this component is a holdover until such a time as we are able to fix the underlying cases. (INS-1245)
 */
const RestartTooltip: FC<{ message: string }> = ({ message }) => (
  <Fragment>
    {message}{' '}
    <Tooltip message={t('Will restart the app')} className="space-left">
      <i className="fa fa-refresh super-duper-faint" />
    </Tooltip>
  </Fragment>
);

// the app's language: the OS's unless one is chosen; the window reloads in it,
// and the main process remakes the menus (main.development.ts)
const LanguageSetting: FC<{ value: string }> = ({ value }) => {
  const system = LANGUAGES.find(({ code }) => code === resolveLanguage(navigator.language))?.name || 'English';
  return (
    <div className="form-control form-control--outlined">
      <label>
        {t('Language')}
        <select
          name="language"
          value={value}
          onChange={async event => {
            await models.settings.patch({ language: event.currentTarget.value });
            window.location.reload();
          }}
        >
          <option value="">{t("The system's ({language})", { language: system })}</option>
          {LANGUAGES.map(({ code, name }) => <option key={code} value={code}>{name}</option>)}
        </select>
      </label>
    </div>
  );
};

export const General: FC = () => {
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;

  return (
    <div className="pad-bottom">
      <LanguageSetting value={settings.language || ''} />
      <div className="row-fill row-fill--top">
        <div>
          <BooleanSetting
            label={t('Use bulk header editor')}
            setting="useBulkHeaderEditor"
          />
          <BooleanSetting
            label={t('Use vertical layout')}
            setting="forceVerticalLayout"
            help={t('If checked, stack request and response panels vertically.')}
          />
          <BooleanSetting
            label={<RestartTooltip message={t('Show variable source and value')} />}
            help={t('If checked, reveals the environment variable source and value in the template tag. Otherwise, hover over the template tag to see the source and value.')}
            setting="showVariableSourceAndValue"
          />
        </div>
        <div>
          <BooleanSetting
            label={t('Reveal passwords')}
            setting="showPasswords"
          />
          {!isMac() && (
            <BooleanSetting
              label={t('Hide menu bar')}
              setting="autoHideMenuBar"
            />
          )}
          <BooleanSetting
            label={<RestartTooltip message={t('Raw template syntax')} />}
            setting="nunjucksPowerUserMode"
          />
        </div>
      </div>

      <div className="row-fill row-fill--top pad-top-sm">
        <NumberSetting
          label={t('Autocomplete popup delay (ms)')}
          setting="autocompleteDelay"
          help={t('Delay the autocomplete popup by milliseconds. Enter 0 to disable the autocomplete delay.')}
          min={0}
          max={3000}
          step={100}
        />
      </div>

      <hr className="pad-top" />
      <h2>{t('Font')}</h2>

      <div className="row-fill row-fill--top">
        <div>
          <BooleanSetting
            label={t('Indent with tabs')}
            setting="editorIndentWithTabs"
          />
          <BooleanSetting
            label={t('Wrap text editor lines')}
            setting="editorLineWrapping"
          />
        </div>
        <div>
          <BooleanSetting
            label={t('Font ligatures')}
            setting="fontVariantLigatures"
          />
        </div>
      </div>

      <div className="form-row pad-top-sm">
        <div className="form-row">
          <TextSetting
            label={t('Interface font')}
            setting="fontInterface"
            help={t('Enter a comma-separated list of fonts. If left empty, uses system defaults.')}
            placeholder={t('-- System Default --')}
          />
          <NumberSetting
            label={t('Interface font size (px)')}
            setting="fontSize"
            min={MIN_INTERFACE_FONT_SIZE}
            max={MAX_INTERFACE_FONT_SIZE}
          />
        </div>
      </div>

      <div className="form-row">
        <TextSetting
          label={t('Text editor font')}
          setting="fontMonospace"
          help={t('Enter a comma-separated list of monospace fonts. If left empty, uses system defaults.')}
          placeholder={t('-- System Default --')}
        />
        <NumberSetting
          label={t('Editor Font Size (px)')}
          setting="editorFontSize"
          min={MIN_EDITOR_FONT_SIZE}
          max={MAX_EDITOR_FONT_SIZE}
        />
      </div>

      <div className="form-row">
        <NumberSetting
          label={t('Editor Indent Size')}
          setting="editorIndentSize"
          help=""
          min={1}
          max={16}
        />

        <EnumSetting<EditorKeyMap>
          label={t('Text Editor Key Map')}
          setting="editorKeyMap"
          help={isMac() && settings.editorKeyMap === EditorKeyMap.vim && (
            <Fragment>
              To enable key-repeating with Vim on macOS, see <Link href={docsKeyMaps}>
                documentation <i className="fa fa-external-link-square" /></Link>
            </Fragment>
          )}
          values={[
            { value: EditorKeyMap.default, name: t('Default') },
            { value: EditorKeyMap.vim, name: 'Vim' },
            { value: EditorKeyMap.emacs, name: 'Emacs' },
            { value: EditorKeyMap.sublime, name: 'Sublime' },
          ]}
        />
      </div>

      <hr className="pad-top" />

      <h2>{t('Request / Response')}</h2>

      <div className="row-fill row-fill--top">
        <div>
          <BooleanSetting
            label={t('Validate certificates')}
            setting="validateSSL"
            help={t('If checked, validate SSL certificates for API requests. This does not affect SSL certificate validation during authentication.')}
          />
          <BooleanSetting
            label={t("Trust the system's certificates")}
            setting="useSystemCertificates"
            help={t("Also trust the certificate authorities installed in your operating system, such as a company's root, for HTTP, SSE and WebSocket requests.")}
          />
          <BooleanSetting
            label={t('Allow legacy TLS servers')}
            setting="legacyTls"
            help={t('For old servers that need unsafe TLS renegotiation or close connections without a proper TLS shutdown. This weakens TLS, so only turn it on if a server fails without it.')}
          />
          <BooleanSetting
            label={t('Follow redirects')}
            setting="followRedirects"
          />
          <BooleanSetting
            label={t('Filter responses by environment')}
            setting="filterResponsesByEnv"
            help={t('If checked, only show responses sent under the active environment. ')}
          />
        </div>
        <div>
          <BooleanSetting
            label={t('Disable JS in HTML preview')}
            setting="disableHtmlPreviewJs"
          />
          <BooleanSetting
            label={t('Disable links in response viewer')}
            setting="disableResponsePreviewLinks"
          />
        </div>
      </div>

      <div className="form-row pad-top-sm">
        <EnumSetting<HttpVersion>
          label={t('Preferred HTTP version')}
          setting="preferredHttpVersion"
          values={[
            { value: HttpVersions.default, name: t('Default') },
            { value: HttpVersions.V1_0, name: 'HTTP 1.0' },
            { value: HttpVersions.V1_1, name: 'HTTP 1.1' },
            { value: HttpVersions.V2PriorKnowledge, name: 'HTTP/2 PriorKnowledge' },
            { value: HttpVersions.V2_0, name: 'HTTP/2' },
            // Enable when our version of libcurl supports HTTP/3
            // see: https://github.com/JCMais/node-libcurl/issues/233
            // { value: HttpVersions.v3, name: 'HTTP/3' },
          ]}
          help={t('Select the preferred HTTP version for requests. The version will fall back if it can’t be negotiated.')}
        />
      </div>

      <div className="form-row pad-top-sm">
        <NumberSetting
          label={t('Maximum Redirects')}
          setting="maxRedirects"
          help={t('Enter the maximum amount of redirects to follow. Enter -1 for unlimited redirects.')}
          min={-1}
        />
        <NumberSetting
          label={t('Request timeout (ms)')}
          setting="timeout"
          help={t('Enter the maximum milliseconds allotted before a request will timeout. Enter 0 to disable timeouts. ')}
          min={0}
          step={100}
        />
      </div>

      <div className="form-row pad-top-sm">
        <NumberSetting
          label={t('Response history limit')}
          setting="maxHistoryResponses"
          help={t('Enter the number of responses to keep for each request. Enter -1 to keep all response history.')}
          min={-1}
        />
        <NumberSetting
          label={t('Max timeline chunk size (KiB)')}
          setting="maxTimelineDataSizeKB"
          help={t('Enter the maximum size in kibibytes to show on the response timeline. Decrease the number for less detailed responses.')}
          min={0}
        />
      </div>

      <hr className="pad-top" />

      <h2>{t('Security')}</h2>
      <div className="form-row pad-top-sm">
        <BooleanSetting
          label={t('Clear OAuth 2 session on start')}
          setting="clearOAuth2SessionOnRestart"
          help={t('If checked, clears the OAuth session every time Insomnium is relaunched.')}
        />
        <button
          className="btn btn--clicky pointer"
          style={{
            padding: 0,
          }}
          onClick={initNewOAuthSession}
        >
          {t('Clear OAuth 2 session')}
        </button>
      </div>
      <div className="form-row pad-top-sm">
        <BooleanSetting
          label={t('Validate certificates during authentication')}
          setting="validateAuthSSL"
          help={t('If checked, validates SSL certificates during authentication flows.')}
        />
      </div>

      <hr className="pad-top" />

      <h2>{t('OS Environment Variables')}</h2>
      <div className="form-row pad-top-sm">
        <TextSetting
          label={t('Allowed names')}
          setting="allowedEnvironmentVariables"
          help={t("The OS environment variables templates can read with the Environment Variable tag, {tag}: comma-separated names, or prefixes ending in *. None are allowed until you list them, so a collection from someone else can't send yours anywhere.", { tag: "{% env 'NAME' %}" })}
          placeholder="API_TOKEN, STAGING_*"
        />
        <TextSetting
          label={t('dotenv file')}
          setting="dotenvFile"
          help={t("Optional. A .env file to read allowed names from when the OS environment doesn't set them. It's read on each send, so edits apply straight away.")}
          placeholder="~/projects/api/.env"
        />
      </div>

      <hr className="pad-top" />

      <h2>{t('Secrets')}</h2>
      <div className="form-row pad-top-sm">
        <TextSetting
          label={t('Allowed secrets')}
          setting="allowedSecrets"
          help={t("The secrets the Vault, 1Password, AWS, Google Cloud and Azure tags may read, with your credentials on this computer: comma-separated references, or prefixes ending in *, such as vault:secret/data/app, op://Work/*, aws:prod/*, gcp:projects/my-project/secrets/*, azure:my-vault/*. None are allowed until you list them, so a collection from someone else can't send yours anywhere.")}
          placeholder="op://Work/*, aws:staging/*"
        />
      </div>

      <hr className="pad-top" />

      <h2>{t('Network Proxy')}</h2>

      <BooleanSetting
        label={t('Enable proxy')}
        setting="proxyEnabled"
        help={t('If checked, enables a global network proxy on all requests sent through Insomnium, including WebSocket and gRPC connections. This proxy supports Basic Auth, digest, and NTLM authentication.')}
      />
      <BooleanSetting
        label={t('Otherwise, use the system proxy')}
        setting="useSystemProxy"
        help={t("With the proxy above off, go through the system's: the OS proxy settings (and PAC file), or the HTTP_PROXY, HTTPS_PROXY and NO_PROXY environment variables. Off by default, so requests go direct.")}
        disabled={settings.proxyEnabled}
      />

      <div className="form-row pad-top-sm">
        <MaskedSetting
          label={t('Proxy for HTTP')}
          setting='httpProxy'
          help={t('Enter a HTTP or SOCKS4/5 proxy starting with appropriate prefix from the following (http://, socks4://, socks5://)')}
          placeholder="localhost:8005"
          disabled={!settings.proxyEnabled}
        />
        <MaskedSetting
          label={t('Proxy for HTTPS')}
          setting='httpsProxy'
          help={t('Enter a HTTPS or SOCKS4/5 proxy starting with appropriate prefix from the following (https://, socks4://, socks5://)')}
          placeholder="localhost:8005"
          disabled={!settings.proxyEnabled}
        />
        <TextSetting
          label={t('No proxy')}
          setting="noProxy"
          help={t('Enter a comma-separated list of hostnames that don’t require a proxy.')}
          placeholder="localhost,127.0.0.1"
          disabled={!settings.proxyEnabled}
        />
      </div>

      <hr className="pad-top" />
      <h2>{t('Updates')}</h2>
      <BooleanSetting
        label={t('Check for new releases')}
        setting="checkForNewReleases"
        help={t("Off by default. At most once a day, asks api.github.com for the latest Insomnium release and shows a notice when it's newer. It's a plain request with no account, token or workspace data; like any web request, GitHub sees your IP address.")}
      />

      <hr className="pad-top" />

    </div>
  );
};
