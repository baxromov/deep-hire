# ============================================================
#  deploy.ps1 - deep-hire loyihasini serverga yuklash
#  Ishlatish:
#    .\deploy.ps1              -- Docker cache ishlatadi (tez, ~2 daqiqa)
#    .\deploy.ps1 -NoCache     -- To'liq fresh build (ishonchli, ~8-10 daqiqa)
# ============================================================
param(
    [switch]$NoCache   # Muammo bo'lsa ishlatish uchun: .\deploy.ps1 -NoCache
)

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
$NginxPort = 8385

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  deep-hire deploy" -ForegroundColor Cyan
Write-Host "  Project : $ProjectName" -ForegroundColor Cyan
Write-Host "  Server  : ${ServerUser}@${ServerIP}" -ForegroundColor Cyan
Write-Host "  Path    : $RemotePath" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# -------- STEP 1: Containerlarni to'xtatish + eski volumelarni tozalash --------
Write-Host ">>> [1/7] Containerlarni to'xtatish..." -ForegroundColor Yellow
# --volumes: backend_venv volumeni ham o'chiradi - yangi deploy da fresh Python deps
ssh "${ServerUser}@${ServerIP}" "cd ~/$ProjectName && docker compose down --volumes 2>/dev/null; true"

# -------- STEP 2: Eski deploy ni backup qilish --------
Write-Host ">>> [2/7] Eski versiyani backup qilish..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" "if [ -d ~/$ProjectName ]; then mv ~/$ProjectName ~/${ProjectName}_backup_`$(date +%Y%m%d_%H%M) && echo 'Backup yaratildi'; fi"

# -------- STEP 3: Fayllarni arxivlash va yuklash --------
Write-Host ">>> [3/7] Fayllarni yuklash..." -ForegroundColor Yellow
$TempArchive = "$env:TEMP\${ProjectName}_deploy.tar.gz"

tar -czf $TempArchive `
    --exclude="./.git" `
    --exclude="./.env" `
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

ssh "${ServerUser}@${ServerIP}" "mkdir -p ~/$ProjectName && tar xzf ~/${ProjectName}_deploy.tar.gz -C ~/$ProjectName && rm ~/${ProjectName}_deploy.tar.gz && echo 'Fayllar muvaffaqiyatli kochiriildi'"

Remove-Item $TempArchive -ErrorAction SilentlyContinue

# -------- STEP 4: .env faylni serverga yuklash --------
Write-Host ">>> [4/7] .env faylni serverga yuklash..." -ForegroundColor Yellow

# Lokal .env mavjudligini tekshiramiz (skript boshida $EnvFile allaqachon aniqlangan)
if (Test-Path $EnvFile) {
    scp $EnvFile "${ServerUser}@${ServerIP}:~/$ProjectName/.env"
    if ($LASTEXITCODE -ne 0) {
        Write-Error ".env faylini serverga yuklashda xato (scp)!"
        exit 1
    }
    Write-Host "    .env yuklandi: $EnvFile" -ForegroundColor Green
} else {
    Write-Warning "  [!]  Lokal .env topilmadi - .env.example dan nusxa olinyapti..."
    ssh "${ServerUser}@${ServerIP}" "cp ~/$ProjectName/.env.example ~/$ProjectName/.env"
    Write-Warning ""
    Write-Warning "  MUHIM: Serverda ~/$ProjectName/.env ni to'ldiring:"
    Write-Warning "     ssh ${ServerUser}@${ServerIP}"
    Write-Warning "     nano ~/$ProjectName/.env"
    Write-Warning ""
    Write-Warning "  Kerakli qiymatlar:"
    Write-Warning "    MONGO_PASSWORD  (haqiqiy MongoDB paroli)"
    Write-Warning "    JWT_SECRET      (32+ tasodifiy belgi)"
    Write-Warning "    MINIO_ACCESS/SECRET_KEY"
    Write-Warning "    HH_CLIENT_ID, HH_CLIENT_SECRET"
    Write-Warning "    FRONTEND_URL, NEXT_PUBLIC_API_URL"
    Write-Warning ""
    Write-Warning "  To'ldirgach qayta deploy qiling: .\deploy.ps1"
}

# -------- STEP 5: Shared Docker network --------
Write-Host ">>> [5/7] Shared Docker network tekshirish..." -ForegroundColor Yellow
ssh "${ServerUser}@${ServerIP}" "docker network inspect shared_services_shared-services-net >/dev/null 2>&1 && echo 'Network mavjud' || (docker network create shared_services_shared-services-net && echo 'Network yaratildi')"

# -------- STEP 6: Docker build --------
Write-Host ">>> [6/7] Docker image build qilish (server tomonida)..." -ForegroundColor Yellow
# --progress=plain: to'liq log (muammo bo'lsa aniq ko'rish uchun, ~/build_log.txt ga yoziladi)
$BuildFlags = "--progress=plain"
if ($NoCache) {
    Write-Host "    [!] -NoCache rejimi: to'liq fresh build (~8-10 daqiqa)..." -ForegroundColor Magenta
    $BuildFlags = "--no-cache --progress=plain"
} else {
    Write-Host "    Docker cache ishlatiladi (tez). Muammo bo'lsa: .\deploy.ps1 -NoCache" -ForegroundColor DarkGray
}
ssh "${ServerUser}@${ServerIP}" "cd ~/$ProjectName && docker compose build $BuildFlags 2>&1 | tee ~/build_log.txt; exit `${PIPESTATUS[0]}"
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker build muvaffaqiyatsiz! To'liq log: ~/build_log.txt"
    Write-Host "  Qayta urinish: .\deploy.ps1 -NoCache" -ForegroundColor Yellow
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
