import type { ResponseTimings } from '../models/response';

// How long each part of an exchange took, from when each part was done
export const timingPhases = ({ dns, connect, tls, firstByte }: ResponseTimings, total: number): [string, number][] => {
  const connected = Math.max(dns, connect, tls);
  return [
    ['DNS lookup', dns],
    ['Connecting', Math.max(0, connect - dns)],
    ...(tls > 0 ? [['TLS handshake', Math.max(0, tls - connect)] as [string, number]] : []),
    ['Waiting (time to first byte)', Math.max(0, firstByte - connected)],
    ['Download', Math.max(0, total - firstByte)],
  ];
};
