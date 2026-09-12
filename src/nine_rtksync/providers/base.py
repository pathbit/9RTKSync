"""Base interface for authentication and credential providers."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord


class BaseProvider(ABC):
    """Base class for credential provider handlers."""

    @abstractmethod
    def can_handle(self, conn: ConnectionRecord) -> bool:
        """Determine whether this provider handles the specified connection."""
        pass

    @abstractmethod
    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        """
        Verify connection and perform proactive renewal if necessary.
        Returns: (renewed: bool, updated_data: Optional[dict], messages: list[str])
        """
        pass

