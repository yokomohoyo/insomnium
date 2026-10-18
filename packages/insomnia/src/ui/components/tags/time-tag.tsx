import classnames from 'classnames';
import React, { FC, memo } from 'react';

import { timingPhases } from '../../../common/timings';
import type { ResponseTimings } from '../../../models/response';
import { Tooltip } from '../tooltip';

interface Props {
  milliseconds: number;
  // to show how the time was spent
  timings?: ResponseTimings;
  small?: boolean;
  className?: string;
  tooltipDelay?: number;
}

const ms = (value: number) => `${value < 10 ? value.toFixed(2) : Math.round(value)} ms`;

export const TimeTag: FC<Props> = memo(({ milliseconds, timings, small, className, tooltipDelay }) => {
  let unit = 'ms';
  let number = milliseconds;

  if (milliseconds > 1000 * 60) {
    unit = 'm';
    number = milliseconds / 1000 / 60;
  } else if (milliseconds > 1000) {
    unit = 's';
    number = milliseconds / 1000;
  }

  // Round to 0, 1, 2 decimal places depending on how big the number is
  if (number > 100) {
    number = Math.round(number);
  } else if (number > 10) {
    number = Math.round(number * 10) / 10;
  } else {
    number = Math.round(number * 100) / 100;
  }

  const description = timings ? (
    <table aria-label="Response timing" className="txt-sm">
      <tbody>
        {timingPhases(timings, milliseconds).map(([phase, value]) => (
          <tr key={phase}>
            <td className="pad-right-sm">{phase}</td>
            <td className="text-right">{ms(value)}</td>
          </tr>
        ))}
        <tr>
          <td className="pad-right-sm"><strong>Total</strong></td>
          <td className="text-right"><strong>{ms(milliseconds)}</strong></td>
        </tr>
      </tbody>
    </table>
  ) : `${milliseconds.toFixed(3)} milliseconds`;
  return (
    <div
      className={classnames(
        'tag',
        {
          'tag--small': small,
        },
        className,
      )}
    >
      <Tooltip message={description} position="bottom" delay={tooltipDelay}>
        {number}&nbsp;{unit}
      </Tooltip>
    </div>
  );
});

TimeTag.displayName = 'TimeTag';
