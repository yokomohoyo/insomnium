import React, { createContext, useContext } from 'react';

import type { RequestAuthenticationStrategy } from '../../../../models/request';

export interface AuthStrategyContextValue {
  strategy: RequestAuthenticationStrategy;
  strategyIndex: number;
  patch: (patch: Partial<RequestAuthenticationStrategy>) => void;
}

const AuthStrategyContext = createContext<AuthStrategyContextValue | null>(null);

export const AuthStrategyProvider: React.FC<React.PropsWithChildren<AuthStrategyContextValue>> = ({
  strategy,
  strategyIndex,
  patch,
  children,
}) => (
  <AuthStrategyContext.Provider value={{ strategy, strategyIndex, patch }}>
    {children}
  </AuthStrategyContext.Provider>
);

export function useAuthStrategy(): AuthStrategyContextValue {
  const ctx = useContext(AuthStrategyContext);
  if (!ctx) {
    throw new Error('useAuthStrategy must be used inside an AuthStrategyProvider');
  }
  return ctx;
}
