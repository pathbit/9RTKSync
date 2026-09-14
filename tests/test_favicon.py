"""Toda página servida declara o ícone da aba.

`/favicon.ico` responde 401 atrás do Basic Auth, então o navegador não consegue
buscá-lo: sem um `<link rel="icon">` embutido, a aba fica com o quadrado
genérico. O painel é uma aba que o operador deixa aberta o dia inteiro, e três
abas genéricas lado a lado são indistinguíveis.

O ícone vai como data URI justamente por isso — não depende de requisição, e
por isso funciona também na página de erro, que é servida antes de qualquer
autenticação.
"""

import pathlib
import re
import sys
import unittest

RAIZ = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(RAIZ / "src"))

from nine_rtksync import render  # noqa: E402

RENDER = RAIZ / "src" / "nine_rtksync" / "render.py"


class TodaPaginaTemIcone(unittest.TestCase):
    def setUp(self):
        self.fonte = RENDER.read_text(encoding="utf-8")

    def test_o_icone_e_uma_constante_unica(self):
        """Duplicar o SVG em cada página é como as duas cópias divergem."""
        self.assertIsNotNone(
            re.search(r"^FAVICON = ", self.fonte, re.M),
            "o ícone tem de ser uma constante no topo do módulo",
        )
        self.assertEqual(
            self.fonte.count("data:image/svg+xml"),
            1,
            "o SVG do ícone aparece mais de uma vez: é assim que as cópias divergem",
        )

    def test_todo_documento_servido_declara_o_icone(self):
        """Conta os <head> e exige um <link rel=icon> para cada um."""
        heads = self.fonte.count("<head>")
        icones = len(re.findall(r'<link rel="icon" href="\{FAVICON\}">', self.fonte))
        self.assertEqual(
            icones,
            heads,
            f"{heads} documentos servidos e {icones} declarações de ícone: "
            "a aba de algum deles fica com o ícone genérico",
        )

    def test_o_icone_nao_depende_de_requisicao(self):
        """Um href para arquivo seria buscado, e /favicon.ico responde 401."""
        self.assertTrue(
            render.FAVICON.startswith("data:"),
            "o ícone precisa ser data URI: qualquer URL seria buscada e levaria 401",
        )


if __name__ == "__main__":
    unittest.main()
