# backend/app/services/worker_runner.py
# Runner do worker de extração, para executar em uma Fly Machine agendada.
#
# Por que existe: Fly.io Machine schedules NÃO aceitam cron expressions.
# Os únicos valores aceitos são: hourly, daily, weekly, monthly.
# Ou seja, o wake-up mínimo é de 1 hora. Para ter o worker a cada 5 min,
# esta máquina acorda de hora em hora e roda um loop interno de N iterações
# com 5 min de intervalo entre elas.
#
# Uso (CMD da máquina worker):
#   python -m app.services.worker_runner
#
# Variáveis de ambiente:
#   WORKER_INTERVAL_SECONDS  intervalo entre execuções (padrão: 300 = 5 min)
#   WORKER_RUNS              número de iterações por wake-up (padrão: 12 = 1h)
#
# Observação: este runner NÃO é controlado por RUN_WORKER. Essa variável pertence
# ao APScheduler da API (app.main), que precisa ficar desligado para não duplicar
# o trabalho. O fly.toml injeta RUN_WORKER=false em todas as máquinas, então o
# runner ignora essa variável de propósito.

import asyncio
import logging
import os
import sys

from app.services.extraction_worker import process_pending_extractions

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [worker_runner] %(levelname)s %(message)s",
)
logger = logging.getLogger("worker_runner")

INTERVAL_SECONDS = int(os.getenv("WORKER_INTERVAL_SECONDS", "300"))
RUNS = int(os.getenv("WORKER_RUNS", "12"))


async def main() -> int:
    logger.info(
        "Iniciando worker runner: %d execucoes com %ds de intervalo",
        RUNS,
        INTERVAL_SECONDS,
    )

    for i in range(1, RUNS + 1):
        try:
            results = await process_pending_extractions()
            logger.info("Execucao %d/%d concluida: %s", i, RUNS, results)
        except Exception:
            logger.exception("Falha na execucao %d/%d", i, RUNS)

        if i < RUNS:
            await asyncio.sleep(INTERVAL_SECONDS)

    logger.info("Worker runner finalizado (%d execucoes).", RUNS)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(0)
