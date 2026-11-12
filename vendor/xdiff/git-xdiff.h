/* Local standalone/WASI adapter. Upstream xdiff sources are unmodified.
 * Regex-ignore options are not exposed by our merge-only wrapper. */
#ifndef INCLUDE_git_xdiff_h__
#define INCLUDE_git_xdiff_h__
#include <stdlib.h>
#include <stdint.h>
#include <stddef.h>
#include <string.h>
#include <stdio.h>
#include <limits.h>
#include <ctype.h>
#define XDL_UNUSED __attribute__((unused))
#define xdl_malloc malloc
#define xdl_calloc calloc
#define xdl_realloc realloc
#define xdl_free free
#define XDL_BUG(msg) abort()
typedef int xdl_regex_t;
typedef int xdl_regmatch_t;
static inline int xdl_regexec_buf(const xdl_regex_t *p, const char *b, size_t s,
 size_t n, xdl_regmatch_t m[], int f) {
 (void)p; (void)b; (void)s; (void)n; (void)m; (void)f;
 abort();
}
#endif
