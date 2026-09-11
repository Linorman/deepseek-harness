# bundle/ — profile plugin bundles

English | [中文](README.zh.md)

Profile bundles: npm packages whose manifest declares `"clocky": { "bundle": { "patch": "./cordis.patch.yml" } }`, making them installable patch layers for `clocky --profile` compositions ([profile contract](../boot/app-boot/README.md#profiles)). A bundle's substance is its patch list; some also ship runtime glue plugins their patch mounts.

The manifest declaration, not this directory, defines Bundle identity. Domain packages can carry their own optional Profile layer.

| Package | Role | ctx key |
|---|---|---|
| [`base/`](base/README.md) | The shared clocky core every profile applies first | — (patch only) |
| [`web-app/`](web-app/README.md) | Browser surface: web patch layer + runtime glue plugin | mounts rows |
| [`headless/`](headless/README.md) | One-shot Team task mode over base, with no Host or Web layer | mounts `headless-runner` |

In-box bundles resolve from the clocky installation; out-of-tree bundles install into a profile through `clocky plugin --profile <name> add <package>`.
