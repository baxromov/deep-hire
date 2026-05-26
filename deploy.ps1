# ============================================================
#  deploy.ps1 - deep-hire loyihasini serverga yuklash
#  Ishlatish: .\deploy.ps1
# ============================================================

# -------- SERVER CONFIG --------
$ServerUser = "bakhromovshb"
$ServerIP   = "172.31.174.11"

# -------- O'QI .env --------
$EnvFile = Join-Path $PSScriptRoot ".env"
if (-not (Test-Path $EnvFile)) {
    Write-Error ".env fayli topilmadi! Avval nusxa oling:`n  Copy-Item .env.example .env`nKeyin PROJECT_NAME va boshqa qiymatlarni to'ldiring."
    exit 1
}

$ProjectName = (Get-Content $EnvFile |
    Where-Object { $_ -match "^PROJECT_NAME\s*=" } |
    Select-Object -First 1) -replace "^PROJECT_NAME\s*=\s*", "" `
                             -replace "\s*#.*", "" `
                             -replace '"', '' `
                             -replace "'", "" |
    ForEach-Object { $_.Trim() }

if (-not $ProjectName) {
    Write-Error ".env faylida PROJECT_NAME topilmadi yoki bo'sh!"
    exit 1
}

$RemotePath = "/home/$ServerUser/$ProjectName"
$LocalPath  = $PSScriptRoot

# Faqat nginx host portini ochadi - backend/frontend ichki (conflict yo'q)
$NginxPort = 8085

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  deep-hire deploy" -ForegroundColor Cyan
Write-Host "  Project : $ProjectName" -ForegroundColor Cyan
Write-Host "  Server  : ${ServerUser}@${ServerIP}" -ForegroundColor Cyan
Write-Host "  Path    : $RemotePath" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# -------- STEP 1: Containerlarni to'xtatish --------
Write-Host ">>> [1/7] Containerlarni to'xtatish..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" "cd ~/$ProjectName && docker compose down 2>/dev/null; true"

# -------- STEP 2: Eski deploy ni backup qilish --------
Write-Host ">>> [2/7] Eski versiyani backup qilish..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" @"
if [ -d ~/$ProjectName ]; then
    mv ~/$ProjectName ~/${ProjectName}_backup_`$(date +%Y%m%d_%H%M)
    echo "Backup yaratildi: ${ProjectName}_backup_`$(date +%Y%m%d_%H%M)"
fi
"@

# -------- STEP 3: Fayllarni arxivlash va yuklash --------
Write-Host ">>> [3/7] Fayllarni yuklash..." -ForegroundColor Yellow
$TempArchive = "$env:TEMP\${ProjectName}_deploy.tar.gz"

tar -czf $TempArchive `
    --exclude="./.git" `
    --exclude="./backend/.venv" `
    --exclude="./backend/__pycache__" `
    --exclude="./backend/app/__pycache__" `
    --exclude="./backend/.pytest_cache" `
    --exclude="./frontend/node_modules" `
    --exclude="./frontend/.next" `
    --exclude="./data" `
    -C "$LocalPath" .

if ($LASTEXITCODE -ne 0) {
    Write-Error "Arxiv yaratishda xato!"
    exit 1
}

scp $TempArchive "${ServerUser}@${ServerIP}:~/${ProjectName}_deploy.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Fayllarni yuklashda xato (scp)!"
    Remove-Item $TempArchive -ErrorAction SilentlyContinue
    exit 1
}

ssh "${ServerUser}@${ServerIP}" @"
mkdir -p ~/$ProjectName
tar xzf ~/${ProjectName}_deploy.tar.gz -C ~/$ProjectName
rm ~/${ProjectName}_deploy.tar.gz
echo "Fayllar muvaffaqiyatli ko'chirildi"
"@

Remove-Item $TempArchive -ErrorAction SilentlyContinue

# -------- STEP 4: .env faylni tekshirish --------
Write-Host ">>> [4/7] .env faylni tekshirish..." -ForegroundColor Yellow
$EnvExists = ssh "${ServerUser}@${ServerIP}" "[ -f ~/$ProjectName/.env ] && echo yes || echo no"

if ($EnvExists.Trim() -eq "no") {
    Write-Warning ".env fayli serverda topilmadi - .env.example dan nusxa olinyapti..."
    ssh "${ServerUser}@${ServerIP}" "cp ~/$ProjectName/.env.example ~/$ProjectName/.env"
    Write-Warning ""
    Write-Warning "  [!]  MUHIM: Serverda ~/$ProjectName/.env ni to'ldiring:"
    Write-Warning "     ssh ${ServerUser}@${ServerIP} 'nano ~/$ProjectName/.env'"
    Write-Warning ""
    Write-Warning "  Kerakli qiymatlar:"
    Write-Warning "    MONGO_PASSWORD, MINIO_ACCESS/SECRET_KEY"
    Write-Warning "    HH_CLIENT_ID, HH_CLIENT_SECRET, HH_REDIRECT_URI"
    Write-Warning "    JWT_SECRET (32+ tasodifiy belgi)"
    Write-Warning "    FRONTEND_URL, NEXT_PUBLIC_API_URL"
    Write-Warning ""
    Write-Warning "  To'ldirgach qayta deploy qiling: .\deploy.ps1"
}

# -------- STEP 5: Shared Docker network --------
Write-Host ">>> [5/7] Shared Docker network tekshirish..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" "docker network inspect shared_services_shared-services-net >/dev/null 2>&1 && echo 'Network mavjud' || (docker network create shared_services_shared-services-net && echo 'Network yaratildi')"

# -------- STEP 6: Docker build --------
Write-Host ">>> [6/7] Docker image build qilish (server tomonida)..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" "cd ~/$ProjectName && docker compose build"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build muvaffaqiyatsiz!"
    exit 1
}

# -------- STEP 7: Containerlarni ishga tushirish --------
Write-Host ">>> [7/7] Containerlarni ishga tushirish..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" "cd ~/$ProjectName && docker compose up -d"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker compose up muvaffaqiyatsiz!"
    exit 1
}

# -------- NATIJA --------
Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  [OK]  DEPLOY MUVAFFAQIYATLI YAKUNLANDI" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Asosiy URL  : http://${ServerIP}:${NginxPort}"         -ForegroundColor Cyan
Write-Host "  API docs    : http://${ServerIP}:${NginxPort}/api/docs" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend/Frontend portlari host ga ochilmagan (faqat Docker ichki)." -ForegroundColor DarkGray
Write-Host "  Barcha traffic nginx:${NginxPort} orqali o'tadi - port conflict yo'q." -ForegroundColor DarkGray
Write-Host ""
Write-Host "  Container holati:" -ForegroundColor White
ssh "${ServerUser}@${ServerIP}" "cd ~/$ProjectName && docker compose ps"
Write-Host ""
Write-Host "  Loglarni ko'rish:" -ForegroundColor Gray
Write-Host "    ssh ${ServerUser}@${ServerIP} 'cd ~/$ProjectName && docker compose logs -f backend'"  -ForegroundColor Gray
Write-Host "    ssh ${ServerUser}@${ServerIP} 'cd ~/$ProjectName && docker compose logs -f frontend'" -ForegroundColor Gray
Write-Host ""
