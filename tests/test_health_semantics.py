"""Regressões da terceira rodada de revisão automática do PR.

O que cada grupo protege, em uma frase:

- a trava de rate limit é um **prazo**, e uma trava vencida deixava a conexão
  amarela para sempre porque nada apagava a marca;
- uma instância local recém-criada dizia "ativa" sem nunca ter sido sondada;
- o painel anunciava "instância inalcançável" para um catálogo vazio que o
  ciclo acabara de gravar como ativo;
- `lastRefreshAt` era lido pelo painel e nenhum provider o escrevia, então
  "última renovação" mostrava o horário da última *verificação*.
"""

import json
import time
import unittest
from datetime import datetime, timedelta, timezone

from nine_rtksync.models import ConnectionRecord
from nine_rtksync.web.render import render_refresh_reason


def agora_mais(segundos: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=segundos)).isoformat().replace(
        "+00:00", "Z"
    )


def conexao(provider: str = "groq", **dados) -> ConnectionRecord:
    return ConnectionRecord(
        id="c1",
        provider=provider,
        name="Teste",
        created_at="2026-01-01",
        updated_at="2026-01-01",
        data_raw=json.dumps(dados),
    )


class TestTravaDeRateLimitVencida(unittest.TestCase):
    def test_a_hold_still_in_the_future_keeps_the_connection_limited(self):
        c = conexao(apiKey="gsk_x", rateLimitedUntil=agora_mais(600))
        self.assertTrue(c.rate_limit_active)
        self.assertEqual(c.health_status, "rate_limited")

    def test_an_expired_hold_releases_the_connection(self):
        c = conexao(apiKey="gsk_x", rateLimitedUntil=agora_mais(-600), credentialState="valid")
        self.assertFalse(c.rate_limit_active)
        self.assertEqual(
            c.health_status,
            "active",
            "uma trava vencida mantinha a conexao amarela para sempre",
        )

    def test_an_epoch_in_milliseconds_is_understood_too(self):
        self.assertTrue(
            conexao(apiKey="k", rateLimitedUntil=int((time.time() + 600) * 1000)).rate_limit_active
        )
        self.assertFalse(
            conexao(apiKey="k", rateLimitedUntil=int((time.time() - 600) * 1000)).rate_limit_active
        )

    def test_no_hold_at_all_is_not_a_hold(self):
        self.assertFalse(conexao(apiKey="k").rate_limit_active)


class TestLocalNaoSondadaNaoAlegaSaude(unittest.TestCase):
    def test_a_brand_new_local_connection_is_not_checked_yet(self):
        c = conexao("openai-compatible-chat-ollama-local", baseUrl="http://127.0.0.1:11434/v1")
        self.assertEqual(
            c.health_status,
            "not_checked",
            "sem sonda nenhuma, dizer 'ativa' e alegar saude que ninguem verificou",
        )

    def test_a_probed_local_connection_is_active(self):
        c = conexao(
            "openai-compatible-chat-ollama-local",
            baseUrl="http://127.0.0.1:11434/v1",
            testStatus="active",
        )
        self.assertEqual(c.health_status, "active")

    def test_a_local_instance_that_did_not_answer_is_unknown(self):
        c = conexao(
            "openai-compatible-chat-ollama-local",
            baseUrl="http://127.0.0.1:11434/v1",
            testStatus="unreachable",
        )
        self.assertEqual(c.health_status, "unknown")


class TestPainelNaoContradizOBanco(unittest.TestCase):
    def test_an_empty_catalog_is_not_reported_as_unreachable(self):
        c = conexao(
            "openai-compatible-chat-ollama-local",
            baseUrl="http://127.0.0.1:11434/v1",
            testStatus="active",
            discoveredModels=[],
        )
        frase = render_refresh_reason(c, refresh_margin=900, lang="pt")
        self.assertNotIn("não respondeu", frase)
        self.assertIn("nenhum modelo", frase)

    def test_an_instance_that_really_did_not_answer_still_says_so(self):
        c = conexao(
            "openai-compatible-chat-ollama-local",
            baseUrl="http://127.0.0.1:11434/v1",
            testStatus="unreachable",
        )
        self.assertIn("não respondeu", render_refresh_reason(c, refresh_margin=900, lang="pt"))


class TestCarimboDeRenovacao(unittest.TestCase):
    """O ciclo carimba `lastRefreshAt` só quando houve renovação de verdade."""

    def ciclo(self, renewed: bool):
        import tempfile, os, sqlite3
        from nine_rtksync.config import Settings
        from nine_rtksync.daemon import SyncEngine

        d = tempfile.mkdtemp()
        db = os.path.join(d, "storage.sqlite")
        con = sqlite3.connect(db)
        con.execute(
            "CREATE TABLE providerConnections (id TEXT PRIMARY KEY, provider TEXT, name TEXT,"
            " data TEXT, createdAt TEXT, updatedAt TEXT)"
        )
        con.execute(
            "INSERT INTO providerConnections VALUES (?,?,?,?,?,?)",
            ("c1", "groq", "Teste", json.dumps({"apiKey": "gsk_x"}), "2026-01-01", "2026-01-01"),
        )
        con.commit()
        con.close()

        class ProviderFalso:
            def can_handle(self, conn):
                return True

            def check_and_refresh(self, conn, margin_seconds=0):
                return renewed, {"apiKey": "gsk_x", "testStatus": "active"}, []

        daemon = SyncEngine(Settings(db_path=db, validate_credentials=False, enable_web=False))
        daemon.providers = [ProviderFalso()]
        daemon.sync_all()

        con = sqlite3.connect(db)
        con.row_factory = sqlite3.Row
        linha = con.execute("SELECT data FROM providerConnections WHERE id='c1'").fetchone()
        con.close()
        return json.loads(linha["data"])

    def test_a_real_renewal_is_stamped(self):
        self.assertIn(
            "lastRefreshAt",
            self.ciclo(renewed=True),
            "o painel le este campo e nenhum provider o escrevia",
        )

    def test_a_plain_probe_is_not_stamped_as_a_renewal(self):
        self.assertNotIn(
            "lastRefreshAt",
            self.ciclo(renewed=False),
            "verificar nao e renovar: carimbar aqui faria um token parado ha dias "
            "parecer recem renovado a cada ciclo",
        )


if __name__ == "__main__":
    unittest.main()
