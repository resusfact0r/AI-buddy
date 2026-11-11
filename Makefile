.PHONY: up down test coverage lint seed
up:
	docker compose up --build -d
down:
	docker compose down
test:
	docker compose -p buddy-tests -f docker-compose.test.yml up --abort-on-container-exit --exit-code-from tests
coverage: test
lint:
	docker compose -p buddy-lint -f docker-compose.lint.yml run --rm lint
seed:
	docker compose stop api corp-mock
	docker compose run --rm --no-deps api api --reset-demo
	docker compose start corp-mock api
