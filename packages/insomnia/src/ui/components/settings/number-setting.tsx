import React, { ChangeEventHandler, FC, FocusEventHandler, InputHTMLAttributes, useCallback } from 'react';
import { useRouteLoaderData } from 'react-router-dom';

import { SettingsOfType } from '../../../common/settings';
import { useSettingsPatcher } from '../../hooks/use-request';
import { RootLoaderData } from '../../routes/root';
import { HelpTooltip } from '../help-tooltip';

interface Props {
  help?: string;
  label: string;
  max?: InputHTMLAttributes<HTMLInputElement>['max'];
  min: InputHTMLAttributes<HTMLInputElement>['min'];
  setting: SettingsOfType<number>;
  step?: InputHTMLAttributes<HTMLInputElement>['step'];
}
// a limit of 0 is a limit too
const isLimit = (limit?: number): limit is number => typeof limit === 'number' && !Number.isNaN(limit);

export function snapNumberToLimits(value: number, min?: number, max?: number) {
  if (isLimit(max) && value > max) {
    return max;
  }
  if (isLimit(min) && value < min) {
    return min;
  }
  return value;
}

const snapInput = ({ value, min, max }: HTMLInputElement) => snapNumberToLimits(parseInt(value, 10) || 0, parseInt(min, 10), parseInt(max, 10));
export const NumberSetting: FC<Props> = ({
  help,
  label,
  max,
  min,
  setting,
  step = 1,
}) => {
  const {
    settings,
  } = useRouteLoaderData('root') as RootLoaderData;

  if (!Object.prototype.hasOwnProperty.call(settings, setting)) {
    throw new Error(`Invalid setting name ${setting}`);
  }
  const patchSettings = useSettingsPatcher();

  const handleOnChange = useCallback<ChangeEventHandler<HTMLInputElement>>(async ({ currentTarget }) => {
    patchSettings({ [setting]: snapInput(currentTarget) });
  }, [patchSettings, setting]);

  // leaving the field shows what was kept, not a number out of its limits
  const handleOnBlur = useCallback<FocusEventHandler<HTMLInputElement>>(({ currentTarget }) => {
    currentTarget.value = String(snapInput(currentTarget));
  }, []);

  let defaultValue: string | number = settings[setting];
  if (typeof defaultValue !== 'number') {
    defaultValue = '';
  }

  return (
    <div className="form-control form-control--outlined">
      <label>
        {label}
        {help && <HelpTooltip className="space-left">{help}</HelpTooltip>}
        <input
          defaultValue={defaultValue}
          max={max}
          min={min}
          name={setting}
          onChange={handleOnChange}
          onBlur={handleOnBlur}
          type={'number'}
          step={step}
        />
      </label>
    </div>
  );
};
