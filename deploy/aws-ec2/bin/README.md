# sage-linux-x86_64

Prebuilt `sage-cli` v0.13.1 for the AWS website host. The t3.small 20 GB
volume cannot compile Sage from source (`No space left on device`).

`enable-treasury-sage.sh` with `SAGE_INSTALL=1` copies this file to
`/usr/local/bin/sage`.

Built from `xch-dev/sage` tag `v0.13.1` (`sage-cli`). SHA-256:

`fb8efca233a979753db81faeae43779495c55ff6fdbbbd176f17075ceb959b31`
