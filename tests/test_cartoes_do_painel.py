"""Os seis cartões existem, sempre, e na mesma ordem dos painéis irmãos.

A regra do dono é uma só: "as telas têm cards diferentes entre LiteLlmRTKSync,
OminiRTkSync e etc, tem que ter todos os cards iguais". O que pode mudar é o
CONTEÚDO; a existência e a ordem, não.

Isto já quebrou uma vez em silêncio: este painel listava conexões e combos e não
tinha "chaves virtuais" nem "modelos cadastrados", enquanto o LiteLlmRTKSync
tinha os dois e nenhum dos outros. Ninguém viu no diff — cada repositório,
sozinho, parecia coerente. Quem descobriu foi quem abriu as três telas lado a
lado.

Quando o gateway não tem o dado, o cartão continua na tela com o estado vazio
explicando por quê. É por isso que a guarda confere o cartão VAZIO também: a
tentação, ao portar, é esconder o que não tem dado.
"""

import unittest

from nine_rtksync.gateway import build_registered_models, fetch_gateway_models
from nine_rtksync.i18n import LANGUAGES, translate
from nine_rtksync.models import ConnectionRecord, VirtualKeyRecord
from nine_rtksync import render

# A ordem acordada para os três painéis. A chave é o título traduzido de cada
# cartão, porque é isso que o operador vê.
ORDEM_DOS_CARTOES = (
    "gateway.title",       # 1. Conexão com o gateway
    "cron.title",          # 2. Agendador
    "connections.title",   # 3. Conexões monitoradas
    "keys.title",          # 4. Chaves virtuais
    "models.title",        # 5. Modelos cadastrados
    "combos.title",        # 6. Combos de resiliência
)


def cabecalho_do_cartao(chave, lang):
    """O título como ele aparece no CABEÇALHO do cartão, e não em qualquer lugar.

    Procurar só pelo texto traduzido acusa o lugar errado: "Chaves de API" é
    também o rótulo de um cartão de métrica lá no topo, que vem antes de todos
    os seis e faria a ordem parecer trocada. O que identifica o cabeçalho é o
    ícone imediatamente antes do texto.
    """
    return f'aria-hidden="true"></i>{translate(chave, lang)}'


def pagina(lang="pt", **extra):
    base = dict(
        connections=[],
        combos=[],
        cron={"active": False},
        gateway={"url": "http://9rtk-router:20128", "online": True, "latencyMs": 3},
        db_path="/app/data/db/data.sqlite",
        router_url="http://9rtk-router:20128",
        current_user="admin",
        is_default_password=False,
        refresh_margin=900,
        lang=lang,
    )
    base.update(extra)
    return render.render_dashboard(**base)


class OsSeisCartoes(unittest.TestCase):
    def test_todos_os_seis_aparecem_em_qualquer_idioma(self):
        for idioma in LANGUAGES:
            html = pagina(idioma)
            for chave in ORDEM_DOS_CARTOES:
                with self.subTest(idioma=idioma, cartao=chave):
                    self.assertIn(cabecalho_do_cartao(chave, idioma), html)

    def test_a_ordem_na_pagina_e_a_ordem_acordada(self):
        html = pagina("pt")
        posicoes = [html.find(cabecalho_do_cartao(c, "pt")) for c in ORDEM_DOS_CARTOES]
        self.assertNotIn(-1, posicoes, "algum cartão não foi desenhado")
        self.assertEqual(
            posicoes,
            sorted(posicoes),
            "a ordem dos cartões saiu trocada: "
            + ", ".join(f"{c}@{p}" for c, p in zip(ORDEM_DOS_CARTOES, posicoes)),
        )

    def test_sem_dado_nenhum_o_cartao_fica_vazio_em_vez_de_sumir(self):
        """Estado vazio honesto é melhor que assimetria — e o vazio diz por quê."""
        html = pagina("pt")
        self.assertIn(translate("keys.title", "pt"), html)
        self.assertIn(translate("keys.empty", "pt"), html)
        self.assertIn(translate("models.title", "pt"), html)
        self.assertIn(translate("models.empty", "pt"), html)

    def test_o_vazio_do_catalogo_diz_qual_dos_tres_motivos_foi(self):
        """"Nenhum modelo" e "não deu para perguntar" não podem desenhar igual."""
        sem_chave = pagina("pt", models_state="no_key")
        self.assertIn(translate("models.no_key", "pt"), sem_chave)

        mudo = pagina("pt", models_state="unreachable")
        self.assertIn(translate("models.unreachable", "pt"), mudo)


class ChavesVirtuais(unittest.TestCase):
    def chave(self, **campos):
        base = {"id": "uuid-1", "name": "litellm-bridge", "machineId": "f19dff0d",
                "isActive": True, "createdAt": "2026-09-13T20:21:07.765Z"}
        base.update(campos)
        return VirtualKeyRecord.from_row(base)

    def test_a_tabela_tem_as_mesmas_sete_colunas_dos_irmaos(self):
        html = render.render_keys_table([self.chave()], "pt")
        self.assertEqual(html.count("<th "), 7)

    def test_a_chave_desativada_aparece_recusada(self):
        html = render.render_keys_table([self.chave(isActive=False)], "pt")
        self.assertIn(translate("health.invalid", "pt"), html)
        self.assertIn(translate("keys.disabled", "pt"), html)

    def test_a_emissao_ocupa_a_coluna_de_ultima_renovacao(self):
        """Chave virtual não se renova: o único carimbo que ela tem é o de emissão."""
        html = render.render_keys_table([self.chave()], "pt")
        self.assertIn("13/09 20:21", html)


class ModelosCadastrados(unittest.TestCase):
    CATALOGO = {"data": [
        {"id": "arsenal-supremo", "owned_by": "combo"},
        {"id": "groq/llama-3.3-70b", "owned_by": "groq"},
        {"id": "gemini/gemini-3.8-flash", "owned_by": "gemini"},
    ]}

    def ler(self, payload=None, status=200):
        import io
        import json

        class Resposta(io.BytesIO):
            def __enter__(self_):
                return self_

            def __exit__(self_, *a):
                return False

        corpo = json.dumps(payload if payload is not None else self.CATALOGO).encode()
        return fetch_gateway_models("http://gw:20128", "chave", opener=lambda *a, **k: Resposta(corpo))

    def test_o_combo_nao_entra_no_catalogo_de_modelos(self):
        """Ele já tem cartão próprio: contá-lo aqui faria a contagem mentir."""
        estado, entradas = self.ler()
        self.assertEqual(estado, "ok")
        self.assertEqual([e["id"] for e in entradas],
                         ["gemini/gemini-3.8-flash", "groq/llama-3.3-70b"])

    def test_sem_chave_ativa_o_estado_diz_isso_em_vez_de_mentir_vazio(self):
        estado, entradas = fetch_gateway_models("http://gw:20128", "")
        self.assertEqual((estado, entradas), ("no_key", []))

    def test_gateway_mudo_nao_derruba_a_pagina(self):
        def recusa(*a, **k):
            raise OSError("connection refused")

        estado, entradas = fetch_gateway_models("http://gw:20128", "chave", opener=recusa)
        self.assertEqual((estado, entradas), ("unreachable", []))

    def test_o_modelo_herda_status_da_conexao_que_o_serve(self):
        conexao = ConnectionRecord(
            id="c1", provider="groq", name="Groq Cloud PathBit",
            created_at="", updated_at="",
            data_raw='{"apiKey": "x", "credentialState": "invalid"}',
        )
        _, entradas = self.ler()
        modelos = build_registered_models(entradas, [conexao])
        por_id = {m.id: m for m in modelos}
        self.assertEqual(por_id["groq/llama-3.3-70b"].health_status, "invalid")
        self.assertEqual(por_id["groq/llama-3.3-70b"].connection_name, "Groq Cloud PathBit")
        # Sem conexão dona, não se inventa veredito nenhum.
        self.assertEqual(por_id["gemini/gemini-3.8-flash"].health_status, "not_checked")

    def test_a_tabela_tem_as_mesmas_sete_colunas_dos_irmaos(self):
        _, entradas = self.ler()
        html = render.render_models_table(build_registered_models(entradas, []), "pt")
        self.assertEqual(html.count("<th "), 7)

    def test_catalogo_grande_e_truncado_e_a_tela_diz_que_truncou(self):
        entradas = [{"id": f"p/m{n}", "provider": "p"} for n in range(render.MAX_LINHAS_DE_MODELO + 7)]
        html = render.render_models_table(build_registered_models(entradas, []), "pt")
        self.assertIn(
            translate("models.showing", "pt",
                      shown=render.MAX_LINHAS_DE_MODELO, total=len(entradas)),
            html,
        )


class NenhumSegredoNaTela(unittest.TestCase):
    """O material do token não pode chegar à página por nenhum dos cartões novos."""

    def test_o_token_da_chave_virtual_nunca_e_desenhado(self):
        segredo = "sk-SEGREDO-QUE-NAO-PODE-VAZAR"
        # Mesmo que alguém passe a linha inteira do banco, incluindo a coluna
        # `key` que get_all_api_keys não lê, nada dela chega ao HTML.
        chave = VirtualKeyRecord.from_row(
            {"id": "uuid-1", "name": "ponte", "key": segredo, "isActive": True}
        )
        html = render.render_keys_table([chave], "pt")
        self.assertNotIn(segredo, html)


if __name__ == "__main__":
    unittest.main()
