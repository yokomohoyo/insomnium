// SPIKE ONLY (spike/mas-sandbox, never merge).
// Ask the kernel whether a running process is sandboxed, and whether its sandbox
// would allow an operation on given paths. Private but stable libsystem_sandbox API
// (used by Activity Monitor's "Sandbox" column).
// SANDBOX_CHECK_NO_REPORT (when exported) keeps these queries out of the unified log,
// so the deny lines there come from the app's own operations.
//   sbcheck <pid> [-o <operation>] path [path ...] [-o <operation>] path ...
// The default operation is file-read-data; -o switches it for the paths after it.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/types.h>

enum { SANDBOX_FILTER_NONE = 0, SANDBOX_FILTER_PATH = 1 };
extern int sandbox_check(pid_t pid, const char *operation, int type, ...);
#ifdef USE_NO_REPORT
extern const int SANDBOX_CHECK_NO_REPORT __attribute__((weak_import));
#endif

int main(int argc, char **argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: sbcheck <pid> [-o operation] [path ...]\n");
    return 2;
  }
  int no_report = 0;
#ifdef USE_NO_REPORT
  if (&SANDBOX_CHECK_NO_REPORT) no_report = SANDBOX_CHECK_NO_REPORT;
#endif
  pid_t pid = (pid_t)atoi(argv[1]);
  int sandboxed = sandbox_check(pid, NULL, SANDBOX_FILTER_NONE);
  printf("pid=%d sandboxed=%d\n", pid, sandboxed);
  const char *op = "file-read-data";
  for (int i = 2; i < argc; i++) {
    if (strcmp(argv[i], "-o") == 0 && i + 1 < argc) {
      op = argv[++i];
      continue;
    }
    int denied = sandbox_check(pid, op, SANDBOX_FILTER_PATH | no_report, argv[i]);
    printf("pid=%d %s %s -> %s\n", pid, op, argv[i], denied > 0 ? "DENY" : (denied == 0 ? "allow" : "ERROR"));
  }
  return 0;
}
