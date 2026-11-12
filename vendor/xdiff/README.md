# Packaged xdiff merge engine

Upstream: https://github.com/libgit2/libgit2/tree/v1.9.4/deps/xdiff
The `.c`/`.h` upstream files are unmodified except `git-xdiff.h`, replaced by
our standalone libc adapter. `bridge.c` is our merge-only ABI. No complete Git
client, network, filesystem, plugins or external WASI imports are included.

License: upstream xdiff is LGPL-2.1-or-later (see COPYING and file headers).
LIBGIT2-COPYING preserves libgit2's additional license inventory. Local adapter
files may be redistributed under LGPL-2.1-or-later. The extension archive ships
these corresponding sources, licenses and rebuild instructions; the module is
separate and replaceable. Application code lives in the public project repository.

Compiler: official WASI SDK 34.0. macOS ARM64 archive:
https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-34.0-arm64-macos.tar.gz
SHA-256: 9c59398106b417f8f14913380fdf0097a8cc0ff4af9eb3ce0065a859e88d49e9
Other platforms: use the equivalent official 34.0 release, verify its published hash.

From the repository root, set WASI_SDK_PATH to the extracted SDK and run:

    node scripts/xdiff.mjs --build

Normal `npm run build` needs no C toolchain or download: it verifies the recorded
source/binary checksums and copies the prebuilt module. To rebuild from the source
folder shipped with an extension, run the equivalent command in that folder:

    "$WASI_SDK_PATH/bin/clang" -O2 -DNDEBUG -mexec-model=reactor \
      -Wl,--export=malloc -Wl,--export=free -Wl,--export=merge_files \
      -Wl,--export=result_ptr -Wl,--export=result_size \
      -Wl,-z,stack-size=262144 -Wl,--initial-memory=1048576 \
      -Wl,--max-memory=67108864 -Wl,--strip-all *.c -o xdiff.wasm

Replace `wasm/xdiff.wasm` in an unpacked extension with your rebuilt version.
`checksums.json` pins this build's sources and binary. Upgrades must deliberately
update checksums after rebuilding and passing native-Git compatibility tests.

Merge options: Myers, no whitespace ignoring or side preference,
XDL_MERGE_ZEALOUS_ALNUM. These match the local Git 2.37.1 (Apple Git-137.1) `merge-file` defaults;
custom Git drivers, attributes, rename handling and alternative diff algorithms
are not implemented by this file-only engine. No conflict output is committed.
The wrapper returns a conflict count and complete merged bytes, preserving CRLF,
Unicode and missing terminal newlines. Each operation uses a fresh instance with
1 MiB initial / 64 MiB maximum memory and a 256 KiB stack. The compiled module is
cached only in the service worker; file contents are not cached or persisted.

The compiler's linked libc is wasi-libc 2e6fb9d8ee0c (with musl and dlmalloc),
from WASI SDK 34.0. WASI-LIBC-LICENSE and the WASI-* / MUSL-COPYRIGHT files preserve
its licensing notices. Source: https://github.com/WebAssembly/wasi-libc/tree/2e6fb9d8ee0c
The SDK supplies the standard compiler/runtime libraries; rebuilding the module
requires no project-specific binary objects besides that documented toolchain.
