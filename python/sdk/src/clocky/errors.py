from __future__ import annotations

from collections.abc import Iterable


_REDACTED_CREDENTIAL = "[REDACTED]"


class HarnessError(Exception):
    """Base exception for SDK and runtime failures."""


class TransportClosedError(HarnessError):
    """Raised when the runtime subprocess exits or closes stdout."""


class SdkProtocolError(HarnessError):
    """Raised when a runtime response or coordinator event violates the SDK protocol."""


class JsonRpcError(HarnessError):
    """Raised when the runtime returns a JSON-RPC error response."""

    def __init__(self, code: int | None, message: str, data: object | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.data = data


def redact_credentials(value: object, credentials: Iterable[str]) -> object:
    """Copy a JSON-like diagnostic value with every known credential removed."""
    secrets = tuple(sorted({credential for credential in credentials if credential}, key=len, reverse=True))
    if not secrets:
        return value
    if isinstance(value, str):
        for credential in secrets:
            value = value.replace(credential, _REDACTED_CREDENTIAL)
        return value
    if isinstance(value, list):
        return [redact_credentials(item, secrets) for item in value]
    if isinstance(value, tuple):
        return tuple(redact_credentials(item, secrets) for item in value)
    if isinstance(value, dict):
        return {
            redact_credentials(key, secrets) if isinstance(key, str) else key: redact_credentials(item, secrets)
            for key, item in value.items()
        }
    return value


def redact_credentials_error(error: BaseException, credentials: Iterable[str]) -> BaseException:
    """Return a safe replacement for an error without any registered secrets."""
    secrets = tuple(credentials)
    message = redact_credentials(str(error), secrets)
    if not isinstance(message, str):
        message = str(message)
    if isinstance(error, JsonRpcError):
        return JsonRpcError(
            error.code,
            message,
            redact_credentials(error.data, secrets),
        )
    if isinstance(error, TransportClosedError):
        return TransportClosedError(message)
    if isinstance(error, SdkProtocolError):
        return SdkProtocolError(message)
    if isinstance(error, TimeoutError):
        return TimeoutError(message)
    if isinstance(error, FileNotFoundError):
        return FileNotFoundError(message)
    if isinstance(error, HarnessError):
        return HarnessError(message)
    if isinstance(error, Exception):
        return RuntimeError(message)
    return error
