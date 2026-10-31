import type { ResponseTimings } from '../models/response';

// How long each part of an exchange took, from libcurl's times for when each
// part was done
export interface PhaseDurations {
  dns: number;
  connect: number;
  // 0 without TLS
  tls: number;
  // from connected to the first byte: sending, and the server's work
  wait: number;
  download: number;
}

export const PHASE_LABELS: Record<keyof PhaseDurations, string> = {
  dns: 'DNS lookup',
  connect: 'Connecting',
  tls: 'TLS handshake',
  wait: 'Waiting (time to first byte)',
  download: 'Download',
};

export const phaseDurations = ({ dns, connect, tls, firstByte }: ResponseTimings, total: number): PhaseDurations => {
  const connected = Math.max(dns, connect, tls);
  return {
    dns,
    connect: Math.max(0, connect - dns),
    tls: tls > 0 ? Math.max(0, tls - connect) : 0,
    wait: Math.max(0, firstByte - connected),
    download: Math.max(0, total - firstByte),
  };
};

export const timingPhases = (timings: ResponseTimings, total: number): [string, number][] => {
  const phases = phaseDurations(timings, total);
  return (Object.keys(PHASE_LABELS) as (keyof PhaseDurations)[])
    .filter(phase => phase !== 'tls' || timings.tls > 0)
    .map(phase => [PHASE_LABELS[phase], phases[phase]]);
};
