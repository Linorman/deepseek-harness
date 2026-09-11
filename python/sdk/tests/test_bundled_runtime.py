"""Keyless boot tests for the production exe and development node carrier.

Each carrier skips independently when absent. The dummy API key only satisfies
adapter loading; initialize and shutdown do not call a model.
"""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

from clocky import Clocky, HarnessClient, HarnessConfig
from clocky.errors import TransportClosedError
from clocky_runtime import resolve_bundled_launch_args

_MODES = ("exe", "node")
_REPO_ROOT = Path(__file__).parents[3]
_MINIMAL_CONFIG = _REPO_ROOT / "examples" / "jsonrpc-agent" / "minimal.cordis.yml"
_SDK_CREDENTIAL = "sdk-test-product-credential"

# The config must include the JSON-RPC serving plugin.
_CORDIS_YML = """\
- id: product-principals
  name: '@clocky/clocky-product-principal'
- id: product-principal-digest
  name: '@clocky/clocky-host-product-principal-digest'
  config:
    providerName: sdk-digest
    credentialSha256: !!js process.env.CLOCKY_PRODUCT_CREDENTIAL_SHA256
    principalId: sdk-test-principal
    subject: sdk-test-subject
- id: sdk-jsonrpc-server
  name: '@clocky/clocky-sdk-jsonrpc-server'
  config:
    productPrincipalProvider: sdk-digest
- id: llm-pi-ai
  name: '@clocky/clocky-llm-pi-ai'
  config:
    providers:
      test-provider:
        apiKeyEnv: TEST_API_KEY
        api: openai-completions
        baseURL: http://127.0.0.1:9
        models:
          - id: test-model-pro
- id: agent-core
  name: '@clocky/clocky-agent-spine-demo'
  config:
    workspaceContext: false
- id: sessions
  name: '@clocky/clocky-session-persistence-jsonl'
  config:
    root: './sessions'
- id: session-checkpoints
  name: '@clocky/clocky-session-checkpoint-policy'
- id: subprocess
  name: '@clocky/clocky-subprocess-local'
- id: bash
  name: '@clocky/clocky-bash-local'
  config:
    cwd: '.'
- id: todo
  name: '@clocky/clocky-tool-todo'
  config:
    allowParallelInProgress: true
"""


def _launch_args(mode: str) -> tuple[str, ...]:
    try:
        return resolve_bundled_launch_args(mode)
    except FileNotFoundError as exc:
        pytest.skip(f"bundled {mode}-mode runtime unavailable on this machine: {exc}")


def _client(tmp_path: Path, launch_args: tuple[str, ...]) -> HarnessClient:
    return HarnessClient(
        HarnessConfig(
            launch_args_override=launch_args,
            cwd=str(tmp_path),
            env={
                "CLOCKY_CORDIS_CONFIG": "./cordis.yml",
                "CLOCKY_SESSION_ROOT": str(tmp_path / "sessions"),
                "CLOCKY_CWD": str(tmp_path),
                # The lazily mounted adapter requires a key even without a model call.
                "TEST_API_KEY": "test-key-for-boot",
                "TEST_BASE_URL": "http://127.0.0.1:9",
                "CLOCKY_PRODUCT_CREDENTIAL_SHA256": hashlib.sha256(_SDK_CREDENTIAL.encode()).hexdigest(),
            },
            request_timeout_seconds=120,
        )
    )


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_boots_a_cordis_config(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(_CORDIS_YML)

    with _client(tmp_path, launch_args) as client:
        init = client.initialize(
            credential=_SDK_CREDENTIAL,
            provider="test-provider",
            cwd=str(tmp_path),
            model="test-model-pro",
        )

    assert init.serverInfo is not None
    assert init.serverInfo.name == "clocky-sdk-runtime"


@pytest.mark.parametrize("mode", _MODES)
def test_python_sdk_boots_minimal_jsonrpc_config(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    model = "minimal-environment-model"
    harness = Clocky(
        credential=_SDK_CREDENTIAL,
        provider="test-provider",
        model=model,
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        cordis=str(_MINIMAL_CONFIG),
        env={
            "TEST_API_KEY": "test-key-for-boot",
            "TEST_BASE_URL": "http://127.0.0.1:9",
            "CLOCKY_MODEL": model,
            "CLOCKY_CONTEXT_WINDOW": "1000000",
            "CLOCKY_SYSTEM_PROMPT": "You are the Python SDK minimal boot test agent.",
        },
        launch_args_override=launch_args,
        request_timeout_seconds=120,
    )

    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_surfaces_unbundled_plugin_failure(tmp_path: Path, mode: str) -> None:
    launch_args = _launch_args(mode)
    (tmp_path / "cordis.yml").write_text(
        "- id: missing\n  name: '@clocky/clocky-does-not-exist'\n"
    )

    client = _client(tmp_path, launch_args)
    client.start()
    try:
        with pytest.raises((TransportClosedError, TimeoutError)) as excinfo:
            client.initialize(
                credential=_SDK_CREDENTIAL,
                provider="test-provider",
                cwd=str(tmp_path),
                model="test-model-pro",
            )
    finally:
        client.close()

    assert "@clocky/clocky-does-not-exist" in str(excinfo.value)


@pytest.mark.parametrize("mode", _MODES)
@pytest.mark.parametrize("ambient_config", [None, ""], ids=["unset", "empty-counts-as-absent"])
def test_zero_config_run_injects_bundled_default_cordis_config(
    tmp_path: Path, mode: str, ambient_config: str | None, monkeypatch: pytest.MonkeyPatch
) -> None:
    _launch_args(mode)  # skip early when this carrier is unavailable
    monkeypatch.setenv("CLOCKY_RUNTIME_MODE", mode)
    if ambient_config is None:
        monkeypatch.delenv("CLOCKY_CORDIS_CONFIG", raising=False)
    else:
        monkeypatch.setenv("CLOCKY_CORDIS_CONFIG", ambient_config)

    harness = Clocky(
        credential=_SDK_CREDENTIAL,
        provider="test-provider",
        model="test-model-pro",
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        env={"TEST_API_KEY": "test-key-for-boot", "TEST_BASE_URL": "http://127.0.0.1:9"},
        request_timeout_seconds=120,
    )
    with harness:
        pass


@pytest.mark.parametrize("mode", _MODES)
def test_bundled_runtime_accepts_the_local_qwen_route_without_a_model_call(
    tmp_path: Path, mode: str
) -> None:
    launch_args = _launch_args(mode)
    harness = Clocky(
        credential=_SDK_CREDENTIAL,
        provider="local-vllm",
        model="Qwen3.8-27B-AWQ-4bit",
        cwd=str(tmp_path),
        session_root=str(tmp_path / "sessions"),
        env={
            "CLOCKY_LOCAL_MODEL_API_KEY": "EMPTY",
            "CLOCKY_LOCAL_MODEL_REASONING_EFFORT": "high",
        },
        launch_args_override=launch_args,
        request_timeout_seconds=120,
    )
    with harness:
        pass
