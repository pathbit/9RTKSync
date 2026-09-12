"""Regressões do despacho de providers e da contagem de renovações.

Cada teste aqui nasceu de um apontamento da revisão automática do PR. O que eles
protegem, em uma frase cada:

- uma conexão local carrega chave de fachada, então o handler genérico de chave
  a engolia antes do handler local e o catálogo nunca era descoberto;
- carimbar o horário de uma verificação virava "credencial renovada" no resumo
  do ciclo;
- a chave recém-descoberta no host não era a que ia para o provedor;
- um catálogo vazio (instalação nova, sem modelo) era relatado como instância
  fora do ar;
- 5xx do provedor virava "credencial válida";
- um `baseUrl` próprio (Azure, proxy) perdia para o casamento por substring do
  nome, e a chave saía para o endereço público do fornecedor.
"""

import json
import unittest
from unittest import mock

from nine_rtksync.credential_check import (
    STATE_UNREACHABLE,
    STATE_VALID,
    CheckResult,
    _classify,
    check_api_key,
)
from nine_rtksync.models import ConnectionRecord
from nine_rtksync.providers import ApiKeyProvider, LocalProvider


def conexao(provider: str, **dados) -> ConnectionRecord:
    return ConnectionRecord(
        id="c1",
        provider=provider,
        name="Teste",
        created_at="2026-01-01",
        updated_at="2026-01-01",
        data_raw=json.dumps(dados),
    )


class TestLocalNaoEEngolidaPeloHandlerDeChave(unittest.TestCase):
    """O sintoma era o Ollama local aparecendo sem modelo nenhum no painel."""

    def setUp(self):
        self.local = conexao(
            "openai-compatible-chat-ollama-local",
            baseUrl="http://127.0.0.1:11434/v1",
            apiKey="chave-de-fachada",
        )

    def test_the_api_key_handler_declines_a_local_connection(self):
        self.assertFalse(ApiKeyProvider().can_handle(self.local))

    def test_the_local_handler_takes_it(self):
        self.assertTrue(LocalProvider().can_handle(self.local))

    def test_exactly_one_handler_claims_it_and_it_is_the_local_one(self):
        # Reproduz o laço do motor, inclusive a ordem em que ele monta a lista.
        ordem = [ApiKeyProvider(), LocalProvider()]
        escolhidos = [p for p in ordem if p.can_handle(self.local)]
        self.assertEqual(len(escolhidos), 1)
        self.assertIsInstance(escolhidos[0], LocalProvider)

    def test_a_cloud_key_still_goes_to_the_api_key_handler(self):
        nuvem = conexao("groq", apiKey="gsk_qualquer")
        self.assertTrue(ApiKeyProvider().can_handle(nuvem))
        self.assertFalse(LocalProvider().can_handle(nuvem))


class TestVerificacaoNaoERenovacao(unittest.TestCase):
    """"N renovadas" precisa significar N credenciais trocadas."""

    def test_a_plain_validation_does_not_count_as_a_renewal(self):
        provider = ApiKeyProvider(validate_credentials=True)
        with mock.patch(
            "nine_rtksync.providers.api_keys.check_api_key",
            return_value=CheckResult(state=STATE_VALID, detail="ok", checked_at="2026-01-01T00:00:00Z"),
        ):
            renewed, data, _ = provider.check_and_refresh(conexao("groq", apiKey="gsk_a"))
        self.assertFalse(renewed, "verificar chave nao e renovar chave")
        # Mas o resultado da verificacao tem de ser gravado assim mesmo.
        self.assertIsNotNone(data)
        self.assertEqual(data["testStatus"], "active")

    def test_a_key_replaced_from_the_host_does_count(self):
        class DescobertaFalsa:
            def get_credential_for_provider(self, provider):
                return {"apiKey": "gsk_nova", "source_path": "~/.config/x"}

        provider = ApiKeyProvider(discovery=DescobertaFalsa(), validate_credentials=False)
        renewed, data, _ = provider.check_and_refresh(conexao("groq", apiKey="gsk_antiga"))
        self.assertTrue(renewed)
        self.assertEqual(data["apiKey"], "gsk_nova")


class TestAChaveSondadaEAMaisNova(unittest.TestCase):
    def test_the_probe_uses_the_key_just_discovered(self):
        class DescobertaFalsa:
            def get_credential_for_provider(self, provider):
                return {"apiKey": "gsk_nova", "source_path": "host"}

        vistas = []

        def espiao(provider, api_key, **kwargs):
            vistas.append(api_key)
            return CheckResult(state=STATE_VALID, detail="ok", checked_at="2026-01-01T00:00:00Z")

        provider = ApiKeyProvider(discovery=DescobertaFalsa(), validate_credentials=True)
        with mock.patch("nine_rtksync.providers.api_keys.check_api_key", side_effect=espiao):
            provider.check_and_refresh(conexao("groq", apiKey="gsk_revogada"))

        self.assertEqual(vistas, ["gsk_nova"],
                         "sondar com a chave velha marcaria como invalida a chave que acabou de ser consertada")


class TestCatalogoVazioNaoEQueda(unittest.TestCase):
    def test_an_instance_answering_with_no_model_is_still_up(self):
        provider = LocalProvider()
        conn = conexao("openai-compatible-local", baseUrl="http://127.0.0.1:11434/v1")
        # Erro vazio = respondeu; lista vazia = nenhum modelo baixado ainda.
        with mock.patch.object(LocalProvider, "discover_models", return_value=([], "")):
            _, data, msgs = provider.check_and_refresh(conn)
        self.assertEqual(data["testStatus"], "active")
        self.assertTrue(any("empty model catalog" in m for m in msgs))

    def test_an_instance_that_does_not_answer_is_unreachable(self):
        provider = LocalProvider()
        conn = conexao("openai-compatible-local", baseUrl="http://127.0.0.1:11434/v1")
        with mock.patch.object(LocalProvider, "discover_models", return_value=([], "Connection refused")):
            _, data, _ = provider.check_and_refresh(conn)
        self.assertEqual(data["testStatus"], "unreachable")


class TestErroDoProvedorNaoValidaCredencial(unittest.TestCase):
    def test_5xx_is_unreachable_not_valid(self):
        for status in (500, 502, 503, 504):
            with self.subTest(status=status):
                self.assertEqual(_classify(status), STATE_UNREACHABLE)

    def test_2xx_is_still_valid(self):
        self.assertEqual(_classify(200), STATE_VALID)


class TestEnderecoDeclaradoVenceONome(unittest.TestCase):
    """Chave de cliente não pode sair para o endereço público do fornecedor."""

    def urls_sondadas(self, provider, api_key, base_url):
        vistas = []

        def espiao(request, timeout, opener=None, spec_invalid=()):
            vistas.append(request.full_url)
            return CheckResult(state=STATE_VALID, detail="ok", checked_at="2026-01-01T00:00:00Z")

        with mock.patch("nine_rtksync.credential_check._execute", side_effect=espiao):
            check_api_key(provider, api_key, base_url=base_url)
        return vistas

    def test_an_azure_openai_key_never_reaches_api_openai_com(self):
        urls = self.urls_sondadas("azure-openai", "k", "https://minha-org.openai.azure.com/v1")
        self.assertEqual(len(urls), 1)
        self.assertNotIn("api.openai.com", urls[0])
        self.assertIn("minha-org.openai.azure.com", urls[0])

    def test_a_proxied_anthropic_key_never_reaches_api_anthropic_com(self):
        urls = self.urls_sondadas("anthropic", "k", "https://proxy.interno.example/v1")
        self.assertNotIn("api.anthropic.com", urls[0])
        self.assertIn("proxy.interno.example", urls[0])

    def test_the_vendor_endpoint_is_still_used_when_no_address_is_declared(self):
        urls = self.urls_sondadas("anthropic", "k", None)
        self.assertIn("api.anthropic.com", urls[0])

    def test_a_base_url_on_the_vendor_host_keeps_the_specific_probe(self):
        # Mesmo host: continua valendo a sonda especifica do fornecedor.
        urls = self.urls_sondadas("openrouter", "k", "https://openrouter.ai/api/v1")
        self.assertIn("openrouter.ai", urls[0])


if __name__ == "__main__":
    unittest.main()
