"""Interface base para provedores de autenticação e credenciais."""

from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional, Tuple

from ..models import ConnectionRecord


class BaseProvider(ABC):
    """Classe base para manipuladores de provedores."""

    @abstractmethod
    def can_handle(self, conn: ConnectionRecord) -> bool:
        """Determina se este provedor atende a conexão especificada."""
        pass

    @abstractmethod
    def check_and_refresh(
        self, conn: ConnectionRecord, margin_seconds: int = 900, **kwargs
    ) -> Tuple[bool, Optional[Dict[str, Any]], List[str]]:
        """
        Verifica a conexão e realiza renovação preventiva se necessário.
        Devolve: (renovado: bool, dados_atualizados: Optional[dict], mensagens: list[str])
        """
        pass
