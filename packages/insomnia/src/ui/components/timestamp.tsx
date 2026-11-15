import { format } from 'date-fns';
import React, { FunctionComponent } from 'react';

export const Timestamp: FunctionComponent<{ time: Date | number }> = ({ time }) => {
  const date = format(time, 'HH:mm:ss');
  return <>{date}</>;
};
