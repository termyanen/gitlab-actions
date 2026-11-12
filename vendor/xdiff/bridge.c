/* Merge-only ABI for packaged xdiff; no filesystem, network or repository API. */
#include "xinclude.h"
static mmbuffer_t output;
int merge_files(char *base, int base_size, char *ours, int ours_size,
                char *theirs, int theirs_size) {
  mmfile_t ancestor = { base, base_size };
  mmfile_t current = { ours, ours_size };
  mmfile_t incoming = { theirs, theirs_size };
  xmparam_t options = {0};
  options.level = XDL_MERGE_ZEALOUS_ALNUM;
  /* Match the default Myers diff used by git merge-file. */
  options.xpp.flags = 0;
  free(output.ptr);
  output.ptr = NULL;
  output.size = 0;
  return xdl_merge(&ancestor, &current, &incoming, &options, &output);
}
char *result_ptr(void) { return output.ptr; }
int result_size(void) { return output.size; }
