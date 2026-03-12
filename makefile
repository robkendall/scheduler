up:
	sudo docker compose up --build

down:
	sudo docker compose down

re:
	sudo docker compose down
	sudo docker compose up --build

logs:
	sudo docker compose logs -f