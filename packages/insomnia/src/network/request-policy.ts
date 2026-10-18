// A check every outgoing HTTP and gRPC request has to pass, set only by the
// headless server (src/server) to its host allowlist. The app sets none.
type RequestPolicy = (url: string) => void;

let policy: RequestPolicy | null = null;

export const setRequestPolicy = (check: RequestPolicy | null) => {
  policy = check;
};

// throws when the policy refuses the url; a unix socket comes as unix:<path>
export const checkRequestPolicy = (url: string) => policy?.(url);

export const hasRequestPolicy = () => policy !== null;
