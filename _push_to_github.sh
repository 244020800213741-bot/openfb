#!/usr/bin/env bash
set -e

cd /mnt/c/Users/santy/openfb

echo "=== 1. Configurar identidad git ==="
git config --global user.name "244020800213741-bot"
git config --global user.email "244020800213741@cecytebc.edu.mx"

echo "=== 2. Inicializar repositorio ==="
git init
git add -A
git commit -m "feat: initial openfb release — Camoufox-powered Facebook API gateway with Marketplace search"

echo "=== 3. Configurar gh como credential helper ==="
"/mnt/c/Program Files/GitHub CLI/gh.exe" auth setup-git 2>&1 || true

echo "=== 4. Crear repo en GitHub y pushear ==="
"/mnt/c/Program Files/GitHub CLI/gh.exe" repo create openfb --public --source=. --remote=origin --push 2>&1

echo "=== 5. Configurar upstream tracking ==="
git branch -M main 2>&1 || true
git push -u origin main 2>&1 || true

echo "=== DONE ==="
