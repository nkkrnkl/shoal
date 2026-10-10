#!/bin/sh
# Starts the demo router: Jev `reasoning` score, interim MT-Bench calibration, and the KAPPA that fits it.
# KAPPA=50 puts the full-budget threshold at 18%, which is a reasoning level of about 1.5 of 3.
cd "$(dirname "$0")" || exit 1
: "${JEV_API_KEY:?Set JEV_API_KEY first, for example: export JEV_API_KEY=your-key}"
ROUTER=jev CALIBRATION=data/calibration_mtbench.json KAPPA="${KAPPA:-50}" \
  exec "${PYTHON:-python3}" -m uvicorn server:app --host 127.0.0.1 --port "${PORT:-8000}"
