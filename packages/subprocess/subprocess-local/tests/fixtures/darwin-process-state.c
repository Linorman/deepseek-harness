#include <inttypes.h>
#include <libproc.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/proc_info.h>

int main(int argc, char **argv) {
  if (argc != 2) return 1;
  int pid = atoi(argv[1]);
  struct proc_bsdinfo info = {0};
  if (proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, sizeof(info)) != sizeof(info)) return 2;
  printf("{\"bytes\":%zu,\"offsets\":[%zu,%zu,%zu,%zu,%zu],\"parentPid\":%u,\"started\":\"%" PRIu64 ":%" PRIu64 "\"}\n",
    sizeof(info), offsetof(struct proc_bsdinfo, pbi_status), offsetof(struct proc_bsdinfo, pbi_pid),
    offsetof(struct proc_bsdinfo, pbi_ppid), offsetof(struct proc_bsdinfo, pbi_start_tvsec),
    offsetof(struct proc_bsdinfo, pbi_start_tvusec), info.pbi_ppid, info.pbi_start_tvsec, info.pbi_start_tvusec);
  return 0;
}
