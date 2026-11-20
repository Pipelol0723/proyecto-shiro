<#
.SYNOPSIS
  Copia de seguridad de la memoria de Shiro (P-11a; apartado 8.1 del plan de mejora).

.DESCRIPTION
  Saca una instantánea de memory.db y, si Letta está en marcha, un volcado de
  su Postgres. Escribe un manifiesto con los hashes, lo envía todo a una
  carpeta con fecha en el destino, comprueba allí los hashes, conserva las
  últimas copias y anota la fecha en last-backup.json, al lado de memory.db.

  El destino es una de dos cosas:
    -Destination <carpeta>   una carpeta de este equipo o de otra unidad
    -RemoteHost <equipo>     otro equipo con Windows y OpenSSH (el homelab)

  Lo que no se copia: los modelos de Ollama y de Whisper (se vuelven a
  descargar; el manifiesto anota cuáles eran) ni las claves de `.env`.

  Códigos de salida:
    0  copia hecha
    1  error
    2  el destino no responde (apagado o sin cable): no se copió nada y no es
       un error; se repite otro día
    3  la carpeta de destino no existe y no se pidió crearla

.EXAMPLE
  npm run backup -- -Destination E:\shiro-backup -CreateDestination

.EXAMPLE
  $env:SHIRO_BACKUP_HOST = '<equipo>'
  $env:SHIRO_BACKUP_USER = '<usuario>'
  $env:SHIRO_BACKUP_KEY = '<ruta de la clave SSH>'
  npm run backup
#>
[CmdletBinding()]
param(
  # Ruta de memory.db. En desarrollo, la de core-host; en la app instalada,
  # la carpeta de datos de la aplicación.
  [string]$MemoryDb,
  [string]$Destination,
  [string]$RemoteHost = $env:SHIRO_BACKUP_HOST,
  [string]$RemoteUser = $env:SHIRO_BACKUP_USER,
  [string]$KeyFile = $env:SHIRO_BACKUP_KEY,
  [int]$RemotePort = 22,
  [string]$RemoteDir = 'C:\shiro-backup',
  # Crea la carpeta de destino si no existe. Hay que pedirlo: la primera copia
  # la decide una persona.
  [switch]$CreateDestination,
  [switch]$SkipLetta,
  # Falla si Letta no está en marcha, en vez de hacer una copia parcial.
  [switch]$RequireLetta,
  [string]$LettaContainer,
  [int]$Keep = 7
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$helper = Join-Path $PSScriptRoot 'backup\memory-backup.mjs'
if (-not $MemoryDb) { $MemoryDb = Join-Path $PSScriptRoot '..\packages\core-host\data\memory.db' }
$isRemote = -not $Destination
$sshTarget = "$RemoteUser@$RemoteHost"
$sshCommon = @('-i', $KeyFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
$script:exitCode = 1
$script:tmp = $null
$script:partial = $null

# Filas de cada tabla del Postgres de Letta, una línea `tabla=n` por tabla.
$lettaRowsSql = @'
SELECT table_name || '=' || (xpath('/row/n/text()', query_to_xml(
  format('select count(*) as n from %I.%I', table_schema, table_name), false, true, '')))[1]::text
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY 1;
'@

function Write-Step([string]$Message) { Write-Host "[copia] $Message" }

function ConvertTo-Quoted([string]$Text) { "'" + $Text.Replace("'", "''") + "'" }

function Invoke-Helper {
  $output = & node $helper @args
  if ($LASTEXITCODE -ne 0) { throw "falló el paso «$($args[0])» de la copia" }
  return $output
}

# Una orden cuyo mensaje de error no interesa. En Windows PowerShell 5.1,
# redirigir el error de un programa con ErrorActionPreference = 'Stop' lo
# convierte en un fallo del script: aquí se baja a 'Continue' mientras dura.
function Invoke-Quiet([scriptblock]$Command) {
  $ErrorActionPreference = 'Continue'
  & $Command 2>$null
}

function Test-Port([string]$HostName, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(3000)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

# Ejecuta un trozo de PowerShell donde está la carpeta de las copias: aquí
# mismo, o en el otro equipo por SSH. Allí va codificado, para no depender de
# las comillas ni de qué intérprete arranca OpenSSH.
function Invoke-AtDestination([string]$Script) {
  if (-not $isRemote) { return & ([scriptblock]::Create($Script)) }
  $full = "`$ErrorActionPreference = 'Stop'; `$ProgressPreference = 'SilentlyContinue'; $Script"
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::Unicode.GetBytes($full))
  $output = & ssh @sshCommon -p $RemotePort $sshTarget powershell -NoProfile -NonInteractive -EncodedCommand $encoded
  if ($LASTEXITCODE -ne 0) { throw "una orden en el destino falló (código $LASTEXITCODE)" }
  return $output
}

# El volcado del Postgres de Letta, si Letta está en marcha. Devuelve la imagen
# del contenedor, o el motivo por el que la copia va sin el volcado.
function Get-LettaDump([string]$Folder) {
  if ($SkipLetta) { return @{ Reason = 'se pidió no incluirlo (-SkipLetta)' } }
  $container = $LettaContainer
  if (-not $container -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    $container = Invoke-Quiet { docker ps --filter 'label=com.docker.compose.service=letta' --format '{{.Names}}' } |
      Select-Object -First 1
  }
  if (-not $container) {
    if ($RequireLetta) { throw 'Letta no está en marcha y se pidió una copia completa (-RequireLetta)' }
    return @{ Reason = 'Letta no estaba en marcha' }
  }

  Write-Step "volcando el Postgres de Letta ($container)"
  # El volcado se escribe dentro del contenedor y se saca con `docker cp`: por
  # la salida de PowerShell un archivo binario llegaría estropeado. El usuario
  # y la base son los del propio contenedor (las comillas simples dejan que
  # los resuelva su intérprete, no PowerShell).
  $inside = '/tmp/shiro-letta.dump'
  $rows = $null
  try {
    # Las filas se cuentan antes y después: si coinciden, valen para comparar
    # al restaurar. Si Letta escribió entretanto, se repite una vez.
    foreach ($attempt in 1, 2) {
      $before = Get-LettaRows $container
      & docker exec $container sh -c ('pg_dump -U $POSTGRES_USER -Fc -f ' + $inside + ' $POSTGRES_DB') | Out-Host
      if ($LASTEXITCODE -ne 0) {
        throw 'pg_dump falló dentro del contenedor de Letta (¿la imagen no lo trae? Mira RESTORE.md)'
      }
      $after = Get-LettaRows $container
      if ($before -and (($before -join '|') -eq ($after -join '|'))) { $rows = $after; break }
    }
    Invoke-Quiet { docker cp "${container}:$inside" (Join-Path $Folder 'letta.dump') } | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'no se pudo sacar el volcado del contenedor de Letta' }
  } finally {
    Invoke-Quiet { docker exec $container rm -f $inside } | Out-Null
  }
  $image = "$(Invoke-Quiet { docker inspect --format '{{.Config.Image}}' $container })".Trim()
  if (-not $rows) {
    Write-Step 'Letta estaba escribiendo durante el volcado: la copia va sin el recuento de filas'
    return @{ Image = $image }
  }
  $rowsFile = Join-Path $script:tmp 'letta-filas.txt'
  [System.IO.File]::WriteAllLines($rowsFile, [string[]]$rows)
  return @{ Image = $image; RowsFile = $rowsFile }
}

function Get-LettaRows([string]$Container) {
  $lines = $lettaRowsSql | & docker exec -i $Container sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -At -f -'
  if ($LASTEXITCODE -ne 0) { return $null }
  return @($lines | Where-Object { $_ -match '^\w+=\d+$' })
}

function Invoke-Backup {
  if ($Keep -lt 1) { throw 'hay que conservar al menos una copia (-Keep)' }
  if (-not (Test-Path -LiteralPath $MemoryDb -PathType Leaf)) {
    throw "no existe la base de la memoria: $MemoryDb"
  }
  if ($isRemote) {
    if (-not $RemoteHost -or -not $RemoteUser -or -not $KeyFile) {
      throw ('falta el destino: -Destination <carpeta>, o el equipo remoto con -RemoteHost, -RemoteUser y ' +
        '-KeyFile (o las variables SHIRO_BACKUP_HOST, SHIRO_BACKUP_USER y SHIRO_BACKUP_KEY)')
    }
    if (-not (Test-Port $RemoteHost $RemotePort)) {
      Write-Step "el equipo de destino no responde en el puerto $RemotePort (apagado o sin cable). No se ha copiado nada."
      $script:exitCode = 2
      return
    }
  }

  $root = if ($isRemote) { $RemoteDir } else { $Destination }
  $rootQ = ConvertTo-Quoted $root
  if ("$(Invoke-AtDestination "Test-Path -LiteralPath $rootQ -PathType Container")".Trim() -ne 'True') {
    if (-not $CreateDestination) {
      Write-Step "la carpeta $root no existe en el destino. Si es la primera copia, repite con -CreateDestination."
      $script:exitCode = 3
      return
    }
    $create = "New-Item -ItemType Directory -Path $rootQ | Out-Null"
    if ($isRemote) {
      # En el otro equipo solo la lee el usuario que hace la copia (por SID,
      # que no depende del idioma de Windows): lleva el historial en claro.
      $create += "; `$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value" +
        "; & icacls $rootQ /inheritance:r /grant:r ('*' + `$sid + ':(OI)(CI)F') | Out-Null" +
        "; if (`$LASTEXITCODE -ne 0) { throw 'icacls' }"
    }
    Invoke-AtDestination $create | Out-Null
    Write-Step "carpeta $root creada en el destino"
  }

  # 1. La copia se prepara en un temporal de este equipo: la carpeta `copia`
  #    es lo que viaja; lo demás son archivos de paso.
  $name = "$(Invoke-Helper name)".Trim()
  $script:tmp = Join-Path ([System.IO.Path]::GetTempPath()) "shiro-backup-$name"
  $copy = Join-Path $script:tmp 'copia'
  New-Item -ItemType Directory -Path $copy | Out-Null
  $createArgs = @('create', '--db', $MemoryDb, '--out', $copy, '--name', $name)

  $letta = Get-LettaDump $copy
  if ($letta.Reason) { $createArgs += @('--no-letta', $letta.Reason) }
  elseif ($letta.Image) { $createArgs += @('--letta-image', $letta.Image) }
  if ($letta.RowsFile) { $createArgs += @('--letta-rows', $letta.RowsFile) }

  if (Get-Command ollama -ErrorAction SilentlyContinue) {
    $models = Invoke-Quiet { ollama list }
    if ($LASTEXITCODE -eq 0 -and $models) {
      $listFile = Join-Path $script:tmp 'ollama.txt'
      [System.IO.File]::WriteAllLines($listFile, [string[]]$models)
      $createArgs += @('--ollama-list', $listFile)
    }
  }

  Write-Step 'sacando la instantánea de la memoria'
  $summary = "$(Invoke-Helper @createArgs)" | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath (Join-Path $copy 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json

  # 2. Se envía a una carpeta provisional y allí se comprueban los hashes.
  $final = Join-Path $root $name
  $script:partial = "$final.partial"
  $partialQ = ConvertTo-Quoted $script:partial
  Write-Step "enviando la copia a $final"
  if ($isRemote) {
    Invoke-AtDestination "New-Item -ItemType Directory -Path $partialQ | Out-Null" | Out-Null
    $files = Get-ChildItem -LiteralPath $copy -File | ForEach-Object { $_.FullName }
    $target = "${sshTarget}:$($script:partial.Replace('\', '/'))/"
    & scp @sshCommon -P $RemotePort -q @files $target
    if ($LASTEXITCODE -ne 0) { throw "scp falló (código $LASTEXITCODE)" }
  } else {
    Copy-Item -LiteralPath $copy -Destination $script:partial -Recurse
  }

  $hashes = Invoke-AtDestination ("Get-ChildItem -LiteralPath $partialQ -File | ForEach-Object { " +
    "`$_.Name + '=' + (Get-FileHash -LiteralPath `$_.FullName -Algorithm SHA256).Hash.ToLower() }")
  foreach ($file in $manifest.files) {
    if (@($hashes) -notcontains "$($file.name)=$($file.sha256)") {
      throw "$($file.name) no llegó igual al destino: la copia no se da por buena"
    }
  }
  Invoke-AtDestination "Rename-Item -LiteralPath $partialQ -NewName $(ConvertTo-Quoted $name)" | Out-Null
  $script:partial = $null

  # 3. Se retiran las copias que sobran: solo carpetas con nombre de copia, y
  #    solo dentro de la carpeta de las copias.
  $present = Invoke-AtDestination "Get-ChildItem -LiteralPath $rootQ -Directory | ForEach-Object { `$_.Name }"
  $extra = @($present) | & node $helper rotate --keep $Keep
  if ($LASTEXITCODE -ne 0) { throw 'no se pudo decidir qué copias sobran' }
  foreach ($old in @($extra)) {
    if ($old -notmatch '^\d{8}T\d{6}Z$') { continue }
    Invoke-AtDestination "Remove-Item -LiteralPath $(ConvertTo-Quoted (Join-Path $root $old)) -Recurse -Force" | Out-Null
    Write-Step "retirada la copia antigua $old"
  }

  # 4. Se anota la última copia correcta.
  Invoke-Helper mark --db $MemoryDb --dir $copy | Out-Null
  $kind = if ($summary.complete) { 'completa' } else { "sin el volcado de Letta ($($letta.Reason))" }
  Write-Step "copia $name hecha: $($summary.turns) turnos, $kind"
  $script:exitCode = 0
}

try {
  Invoke-Backup
} catch {
  Write-Host "[copia] ERROR: $($_.Exception.Message)"
  $script:exitCode = 1
} finally {
  # El temporal lleva el historial en claro: no se queda en el equipo.
  if ($script:tmp -and (Test-Path -LiteralPath $script:tmp)) {
    Remove-Item -LiteralPath $script:tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
  # Una copia a medias en el destino tampoco: la creó esta ejecución.
  if ($script:partial) {
    try {
      Invoke-AtDestination "Remove-Item -LiteralPath $(ConvertTo-Quoted $script:partial) -Recurse -Force -ErrorAction SilentlyContinue" | Out-Null
    } catch {
      Write-Host "[copia] quedó una copia a medias en el destino: $($script:partial)"
    }
  }
}
exit $script:exitCode
