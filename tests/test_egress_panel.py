"""A saída de rede de cada conta precisa aparecer na tela.

O risco de bloqueio não vem de várias sessões na mesma conta — os provedores
convivem com isso — e sim de **várias contas saindo pelo mesmo endereço**, que
é o estado natural de um gateway com todas elas cadastradas. O modelo já sabia
calcular esse vínculo e nada no painel o mostrava, então o operador só
descobriria o problema depois do provedor.

Estes testes fixam duas decisões:

- compartilhar o endereço só vira aviso a partir da **segunda** conta: sozinha,
  ela é a única dona daquele IP e não há o que sinalizar;
- o painel é somente leitura — quem roteia a requisição é o gateway.
"""

import json
import unittest

from nine_rtksync.models import ConnectionRecord
from nine_rtksync import render


def conexao(nome: str, **dados) -> ConnectionRecord:
    return ConnectionRecord(
        id=nome,
        provider=dados.pop("provider", "groq"),
        name=nome,
        created_at="2026-01-01",
        updated_at="2026-01-01",
        data_raw=json.dumps(dados),
    )


def vinculada(nome: str, pool: str) -> ConnectionRecord:
    return conexao(
        nome,
        apiKey="gsk_x",
        providerSpecificData={"proxyPoolId": pool, "connectionProxyEnabled": True},
    )


def compartilhada(nome: str) -> ConnectionRecord:
    return conexao(nome, apiKey="gsk_x", providerSpecificData={})


class TestVinculoAparece(unittest.TestCase):
    def html(self, conexoes):
        return render.render_connections_table(conexoes, refresh_margin=900, lang="pt")

    def test_a_bound_account_shows_its_own_pool(self):
        h = self.html([vinculada("Conta A", "pool-a")])
        self.assertIn("pool-a", h)
        self.assertIn("saída própria", h)

    def test_two_accounts_on_the_gateway_address_raise_a_warning(self):
        h = self.html([compartilhada("Conta A"), compartilhada("Conta B")])
        self.assertIn("divide o endereço do gateway", h)
        # bg-warning-subtle, e nao text-bg-warning-subtle: a segunda NAO existe
        # no Bootstrap 5.3.3 (so ha text-bg-warning, sem o sufixo), entao o
        # badge renderizava sem fundo nenhum -- texto solto onde devia haver
        # destaque. O teste travava a classe inexistente e por isso o defeito
        # atravessou verde.
        self.assertIn("bg-warning-subtle", h, "o estado que importa precisa se destacar")

    def test_a_single_account_sharing_is_not_a_warning(self):
        # Uma conta sozinha e a unica dona daquele IP: nao ha nada a alertar.
        h = self.html([compartilhada("Conta unica")])
        self.assertIn("única conta", h)
        self.assertNotIn("bg-warning-subtle", h)

    def test_a_bound_account_does_not_count_toward_the_warning(self):
        # Duas contas, mas so uma compartilha: ainda nao ha duas no mesmo IP.
        h = self.html([vinculada("Conta A", "pool-a"), compartilhada("Conta B")])
        self.assertNotIn("divide o endereço do gateway", h)

    def test_three_sharing_accounts_report_the_real_count(self):
        h = self.html([compartilhada("A"), compartilhada("B"), compartilhada("C")])
        self.assertIn("3", h)

    def test_a_local_instance_has_no_egress_mark(self):
        # Instancia local nao sai para o provedor: a marca nao se aplica.
        local = conexao(
            "Ollama",
            provider="openai-compatible-chat-ollama-local",
            baseUrl="http://127.0.0.1:11434/v1",
            apiKey="fachada",
        )
        h = self.html([local])
        self.assertNotIn("saída própria", h)
        self.assertNotIn("divide o endereço", h)


class TestPainelNaoEscreve(unittest.TestCase):
    def test_the_pool_name_is_escaped(self):
        # O nome vem do banco do gateway: tratar como texto, nunca como HTML.
        h = render.render_connections_table(
            [vinculada("Conta", '<img src=x onerror=alert(1)>')], refresh_margin=900, lang="pt"
        )
        self.assertNotIn("<img src=x", h)
        self.assertIn("&lt;img", h)


if __name__ == "__main__":
    unittest.main()
