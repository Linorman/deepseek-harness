# @clocky/clocky-host-directory-picker-auto

English | [中文](README.zh.md)

The **adaptive chooser** of the [directory-picker seam](../directory-picker/README.md): a host-only plugin that resolves the host's situation once at boot and mounts the matching backend — [`-native`](../directory-picker-native/README.md) or [`-browse`](../directory-picker-browse/README.md) — as a real Loader entry in the in-memory root tree (never persisted to a config file; the root tree's `write()` is a no-op). It does not mount a browser directory-picker package; client interaction composition remains independent. Unloading the chooser removes the backend entry again.

Resolution is one pure boot-time sample (`resolveDirectoryPickerBackend`), exported for reuse. `native` requires every signal that the operator can see the host display and the native backend can serve it: a loopback-only bind (read from the injected `webServer`; an all-interfaces bind admits remote browsers no OS chooser can reach), no SSH launch (`SSH_CONNECTION`/`SSH_TTY` unset or blank — under SSH port-forwarding the chooser would open on the unattended server), and a servable display session — assumed on darwin/win32; on linux `DISPLAY`/`WAYLAND_DISPLAY` plus a zenity or kdialog binary on `PATH` (the probe is one more boot-time fact); never on any other platform, since the native backend drives exactly darwin/win32/linux. Anything ambiguous resolves to `browse`, which works everywhere. The sample happens exactly once per boot so the mounted capability stays stable for the service lifetime, as the seam requires. Pinning a backend is not a config field here — compose the `-native` or `-browse` row directly instead of this one; mounting the chooser and a backend row together fails loud with a duplicate `directoryPicker` service.

## Model Experience

None, as the chooser only composes the GUI host's directory selection; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Detection infers operator location from launch context, which no launch-side signal can prove** — a tmux session detached from its SSH launch loses the `SSH_*` markers; a Darwin process outside an Aqua session still counts as displayed; and a workstation-local launch later reached through `ssh -L` arrives from `127.0.0.1`, resolves `native`, and opens the chooser on the unattended workstation. A wrong `native` choice fails host pick requests through that backend; composing `-browse` directly selects the safe host capability for such deployments.
- **The Linux chooser probe reads `PATH` only** — a zenity/kdialog reachable some other way (shell alias, non-PATH install) still resolves `browse`; installing either binary on `PATH` restores `native` eligibility at the next boot.
- **Boot-time only** — one resolution serves every consumer of the boot; per-connection adaptivity would need a per-client capability and waits for a consumer that needs it.
