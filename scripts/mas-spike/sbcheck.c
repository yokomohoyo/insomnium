// SPIKE ONLY (spike/mas-sandbox, never merge).
// Ask the kernel whether a running process is sandboxed, and optionally whether
// its sandbox would allow file-read-data on given paths. Private but stable
// libsystem_sandbox API (used by Activity Monitor's "Sandbox" column).
//   sbcheck <pid> [path ...]
#include <stdio.h>
#include <stdlib.h>
#include <sys/types.h>

enum { SANDBOX_FILTER_NONE = 0, SANDBOX_FILTER_PATH = 1 };
extern int sandbox_check(pid_t pid, const char *operation, int type, ...);

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: sbcheck <pid> [path ...]\n");
    return 2;
  }
  pid_t pid = (pid_t)atoi(argv[1]);
  int sandboxed = sandbox_check(pid, NULL, SANDBOX_FILTER_NONE);
  printf("pid=%d sandboxed=%d\n", pid, sandboxed);
  for (int i = 2; i < argc; i++) {
    int denied = sandbox_check(pid, "file-read-data", SANDBOX_FILTER_PATH, argv[i]);
    printf("pid=%d file-read-data %s -> %s\n", pid, argv[i], denied ? "DENY" : "allow");
  }
  return 0;
}
