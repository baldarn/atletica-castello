# Sito istituzionale Società atletica castello

## Sviluppo

Consiglio di usare [mise](https://mise.jdx.dev/) configurando come variabili di ambiente i file `.env`

Per installare Hugo, esegui:

```sh
mise i
```

Per sviluppo, esegui:

```sh
make dev
```

## Deploy

Devi aver configurato le variabili di ambiente nel file `.env`

Lancia:

```sh
cp .env-sample .env
```

e configura le variabili.

Per rilasciare, esegui:

```sh
make deploy
```
