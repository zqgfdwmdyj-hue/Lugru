.PHONY: test bau windows linux docker alles

test:
	CGO_ENABLED=0 go test ./...

bau:
	CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o lugru-deals ./cmd/lugru-deals

windows:
	CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
		go build -trimpath -ldflags="-s -w" -o dist/lugru-deals.exe ./cmd/lugru-deals

linux:
	CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
		go build -trimpath -ldflags="-s -w" -o dist/lugru-deals ./cmd/lugru-deals

docker:
	docker build -t lugru-deals:neu .

alles: test windows linux
