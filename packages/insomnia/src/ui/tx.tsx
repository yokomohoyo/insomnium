import React, { type ReactNode } from 'react';

import { t } from '../common/i18n';

// A sentence with elements in it (a link, a <code>), translated whole: each
// {name} that `parts` has is that element, so a translation can put it where
// its language does. npm run i18n:strings finds tx('…') as it finds t('…').
export const tx = (text: string, parts: Record<string, ReactNode>, values?: Record<string, string | number>) => (
  <>
    {React.Children.toArray(t(text, values).split(/(\{\w+\})/).filter(Boolean).map(piece => {
      const name = /^\{(\w+)\}$/.exec(piece)?.[1];
      return name !== undefined && name in parts ? parts[name] : piece;
    }))}
  </>
);
