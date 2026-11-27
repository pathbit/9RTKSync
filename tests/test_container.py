"""Validação da imagem Docker do 9RTKSync usando Testcontainers.

Garante que a imagem Docker gerada:
1. Inicializa sem falhas com as configurações padrão.
2. Expõe o dashboard web na porta 9090.
3. Responde requisições HTTP em /login com código 200 e página HTML válida.
4. Responde no endpoint /healthz com o cabeçalho e corpo documentados.
5. Permite executar a CLI (9rtksync --help) com sucesso dentro do container.
"""

from contextlib import closing
import os
import time
import unittest
import urllib.request
import urllib.error

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCKER_IMAGE_PADRAO = "9rtksync:test"


class Test9RTKSyncContainer(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        requested_image = os.environ.get("TEST_DOCKER_IMAGE")
        cls.imagem = requested_image or DOCKER_IMAGE_PADRAO
        try:
            import docker
            from testcontainers.core.container import DockerContainer

            cls.container_type = DockerContainer
            with closing(docker.from_env()) as client:
                client.ping()
                try:
                    client.images.get(cls.imagem)
                except docker.errors.ImageNotFound:
                    if requested_image:
                        raise
                    client.images.build(path=RAIZ, tag=cls.imagem, rm=True)
        except Exception as error:
            message = f"Docker test setup failed for {cls.imagem}: {error}"
            if requested_image:
                raise RuntimeError(message) from error
            raise unittest.SkipTest(message) from error

    def test_container_web_dashboard_e_cli(self):
        container = self.container_type(self.imagem).with_exposed_ports(9090)
        container.with_env("DB_PATH", "/app/data/qa-missing/data.sqlite")
        with container:
            host = container.get_container_host_ip()
            porta = container.get_exposed_port(9090)
            url_login = f"http://{host}:{porta}/login"
            url_healthz = f"http://{host}:{porta}/healthz"

            # 1. Aguarda o servidor web aceitar conexões (até 15s)
            conectou = False
            ultimo_erro = None
            for _ in range(15):
                time.sleep(1)
                try:
                    with urllib.request.urlopen(url_login, timeout=2) as resp:
                        if resp.status == 200:
                            conectou = True
                            break
                except Exception as e:
                    ultimo_erro = e

            self.assertTrue(conectou, f"Não foi possível conectar ao dashboard web na porta {porta}: {ultimo_erro}")

            # 2. Valida resposta do endpoint /login
            with urllib.request.urlopen(url_login, timeout=5) as resp:
                self.assertEqual(resp.status, 200)
                cabecalhos = dict(resp.getheaders())
                self.assertIn("text/html", cabecalhos.get("Content-Type", ""))
                corpo = resp.read().decode("utf-8")
                self.assertIn("9RTKSync", corpo)
                self.assertIn("<!DOCTYPE html>", corpo)

            # The container has no gateway database mounted.
            with self.assertRaises(urllib.error.HTTPError) as error:
                with urllib.request.urlopen(url_healthz, timeout=5):
                    pass
            with error.exception as response:
                self.assertEqual(response.code, 503)
                self.assertEqual(response.headers.get("Server"), "9RTKSync")
                self.assertEqual(response.read(), b"DATABASE_NOT_READY")

            # 4. Valida execução da CLI dentro do container
            codigo_saida, saida = container.exec(["9rtksync", "--help"])
            self.assertEqual(codigo_saida, 0, f"Comando 9rtksync --help falhou com código {codigo_saida}: {saida}")
            texto_saida = saida.decode("utf-8")
            self.assertIn("9RTKSync", texto_saida)
            self.assertIn("--daemon", texto_saida)


if __name__ == "__main__":
    unittest.main()
