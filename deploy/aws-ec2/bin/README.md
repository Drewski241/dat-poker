# sage-linux-x86_64

Prebuilt `sage-cli` v0.13.1 for Amazon Linux 2023 (glibc 2.34). The t3.small
20 GB volume cannot compile Sage from source.

`enable-treasury-sage.sh` with `SAGE_INSTALL=1` copies this file to
`/usr/local/bin/sage`.

Built from `xch-dev/sage` tag `v0.13.1` (`sage-cli`) with
`cargo zigbuild --target x86_64-unknown-linux-gnu.2.34`. SHA-256:

`d414a26fc2fed9addacceaca24989e91dc3a4ead54e0e94965d76e4d5ff9294b`
