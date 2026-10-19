import React, { FC, useState } from 'react';
import { useFetchers, useRouteLoaderData } from 'react-router-dom';

import { docsAiAssistant } from '../../../common/documentation';
import { t } from '../../../common/i18n';
import { useSettingsPatcher } from '../../hooks/use-request';
import { RootLoaderData } from '../../routes/root';
import { Link } from '../base/link';
import { HelpTooltip } from '../help-tooltip';
import { Button } from '../themed-button';
import { MaskedSetting } from './masked-setting';
import { TextSetting } from './text-setting';

const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err)).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

export const AiAssistant: FC = () => {
  const { settings } = useRouteLoaderData('root') as RootLoaderData;
  const patchSettings = useSettingsPatcher();
  // the model is typed or picked from the list, so it's kept here as well
  const [model, setModel] = useState(settings.aiModel);
  const [models, setModels] = useState<string[] | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [isChecking, setChecking] = useState(false);
  // the endpoint is asked with the saved settings, so wait for a change to save
  // (useFetchers lists only the busy ones)
  const isSaving = useFetchers().some(fetcher => fetcher.formAction === '/settings/update');

  const chooseModel = (value: string) => {
    setModel(value);
    patchSettings({ aiModel: value });
  };

  const listModels = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const listed = await window.main.ai.models();
      setModels(listed);
      setStatus({ ok: true, message: listed.length ? t('The endpoint offers {count, plural, one {# model} other {# models}}.', { count: listed.length }) : t('The endpoint answered, but lists no models.') });
    } catch (err) {
      setModels(null);
      setStatus({ ok: false, message: errorMessage(err) });
    }
    setChecking(false);
  };

  const tryModel = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const reply = await window.main.ai.chat({ messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
      setStatus({ ok: true, message: t('{model} replied: {reply}', { model, reply: reply.slice(0, 200) }) });
    } catch (err) {
      setStatus({ ok: false, message: errorMessage(err) });
    }
    setChecking(false);
  };

  return (
    <div>
      <p className="notice info no-margin-top">
        {t("The assistant suggests a request from a description, and a commit message from your changes, with a model you choose: one on your computer, or a provider's with your own key.")} {t('Nothing is sent until you ask for a suggestion.')} See the{' '}
        <Link href={docsAiAssistant}>documentation</Link>.
      </p>
      <div className="form-row">
        <TextSetting
          label={t('Endpoint')}
          setting="aiBaseUrl"
          placeholder="http://localhost:11434/v1"
          help={t("The base address of an OpenAI-compatible API, ending before /chat/completions. Ollama's is http://localhost:11434/v1, LM Studio's http://localhost:1234/v1, OpenAI's https://api.openai.com/v1 and Anthropic's https://api.anthropic.com/v1.")}
        />
      </div>
      <div className="form-row">
        <MaskedSetting
          label={t('API key')}
          setting="aiApiKey"
          placeholder={t('Not needed for a model on your computer')}
          help={t("Sent to the endpoint as a bearer token. It's kept encrypted, like your other saved credentials.")}
        />
      </div>
      <div className="form-row">
        <div className="form-control form-control--outlined">
          <label>
            {t('Model')}
            <HelpTooltip className="space-left">{t("The model's name as the endpoint knows it, such as llama3.2 or gpt-4o-mini. List Models fetches the names the endpoint offers.")}</HelpTooltip>
            <input
              type="text"
              name="aiModel"
              placeholder="llama3.2"
              value={model}
              onChange={event => chooseModel(event.currentTarget.value)}
            />
          </label>
        </div>
        {models && models.length > 0 && (
          <div className="form-control form-control--outlined">
            <label>
              {t('Offered')}
              <select aria-label={t('Offered models')} value={models.includes(model) ? model : ''} onChange={event => event.currentTarget.value && chooseModel(event.currentTarget.value)}>
                <option value="">{t('Choose a model…')}</option>
                {models.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </label>
          </div>
        )}
      </div>
      <div className="form-row">
        <Button disabled={isChecking || isSaving} onClick={listModels}>{t('List Models')}</Button>
        <Button disabled={isChecking || isSaving || !model} style={{ marginLeft: '0.3em' }} onClick={tryModel}>
          {isChecking && <i className="fa fa-refresh fa-spin space-right" />}
          {t('Try the Model')}
        </Button>
      </div>
      {status && (
        <p className={`notice ${status.ok ? 'success' : 'error'} selectable`} data-testid="ai-status">{status.message}</p>
      )}
    </div>
  );
};
