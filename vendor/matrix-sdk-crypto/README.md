# Preloaded matrix-sdk-crypto-nodejs libraries

Building the Docker image downloads the native library of
`@matrix-org/matrix-sdk-crypto-nodejs` from GitHub releases. If the build host
cannot reach GitHub, download the libraries elsewhere and place them here
before building:

```
vendor/matrix-sdk-crypto/<version>/matrix-sdk-crypto.<platform>.node
```

For example, for linux/amd64:

```sh
for v in 0.6.6 0.7.0; do
  mkdir -p vendor/matrix-sdk-crypto/$v
  curl -fL -o vendor/matrix-sdk-crypto/$v/matrix-sdk-crypto.linux-x64-gnu.node \
    https://github.com/matrix-org/matrix-rust-sdk-crypto-nodejs/releases/download/v$v/matrix-sdk-crypto.linux-x64-gnu.node
done
```

The versions needed are the `@matrix-org/matrix-sdk-crypto-nodejs` versions
in `pnpm-lock.yaml`. Libraries placed here are not committed (see
`.gitignore`).
