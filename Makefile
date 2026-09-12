.PHONY: test run status docker-build docker-run clean

test:
	PYTHONPATH=src python3 -m unittest discover -s tests -p "test_*.py"

run:
	PYTHONPATH=src python3 -m nine_rtksync.cli --daemon

status:
	PYTHONPATH=src python3 -m nine_rtksync.cli --status

docker-build:
	docker build -t ghcr.io/pathbit/9rtksync:latest .

docker-run:
	docker run --rm -it -p 9190:9190 ghcr.io/pathbit/9rtksync:latest

clean:
	find . -type d -name "__pycache__" -exec rm -rf {} +
	find . -type f -name "*.pyc" -delete
