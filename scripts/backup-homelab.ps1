<#
.SYNOPSIS
  Copia de seguridad de la memoria de Shiro (P-11a; apartado 8.1 del plan de mejora).

.DESCRIPTION
  Saca una instantánea de memory.db y después, si Letta está en marcha, un
  volcado de su Postgres. Escribe un manifiesto con los hashes, lo envía todo a una
  carpeta con fecha en el destino, comprueba allí los hashes, anota la fecha en
  last-backup.json (al lado de memory.db) y conserva las últimas copias.

  El destino es una de dos cosas:
    -Destination <carpeta>   una carpeta de este equipo o de otra unidad
    -RemoteHost <equipo>     otro equipo con Windows y OpenSSH (el homelab)

  Lo que no se copia: los modelos de Ollama y de Whisper (se vuelven a
  descargar; el manifiesto anota cuáles eran) ni las claves de `.env`.

  Si el volcado de Letta falla, o Letta no está en marcha, la copia se hace
  igual con la memoria local y queda marcada como parcial. Con -RequireLetta
  eso es un error.

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
  # Ruta de memory.db. Por defecto, la de desarrollo (packages/core-host/data).
  [string]$MemoryDb,
  # Copia la memoria de la app instalada, no la de desarrollo.
  [switch]$Installed,
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
  # Falla si no se puede incluir el volcado de Letta, en vez de hacer una copia parcial.
  [switch]$RequireLetta,
  [string]$LettaContainer,
  # Copia también una memoria sin ningún turno. Sin esto es un error: lo normal
  # es que la ruta de memory.db esté mal.
  [switch]$AllowEmpty,
  [int]$Keep = 7
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$helper = Join-Path $PSScriptRoot 'backup\memory-backup.mjs'
# Filas de cada tabla del Postgres de Letta, una línea `tabla=n` por tabla.
$lettaRowsSql = Join-Path $PSScriptRoot 'backup\letta-rows.sql'
$backupName = '^\d{8}T\d{6}Z$'
if ($Installed) {
  # La app instalada guarda sus datos en la carpeta local de la aplicación.
  $tauri = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\packages\desktop\src-tauri\tauri.conf.json') -Raw -Encoding UTF8 |
    ConvertFrom-Json
  $MemoryDb = Join-Path $env:LOCALAPPDATA "$($tauri.identifier)\data\memory.db"
} elseif (-not $MemoryDb) {
  $MemoryDb = Join-Path $PSScriptRoot '..\packages\core-host\data\memory.db'
}
$isRemote = -not $Destination
$sshTarget = "$RemoteUser@$RemoteHost"
$sshCommon = @('-i', $KeyFile, '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10')
$script:exitCode = 1
$script:tmp = $null
$script:partial = $null

# El hash de un archivo, con .NET y no con la función de PowerShell: lanzado desde
# PowerShell 7, Windows PowerShell hereda su lista de módulos y deja de
# reconocer esa función. Va como texto porque se ejecuta también en el destino.
$sha256Function = 'function Get-Sha256([string]$Path) { $stream = [System.IO.File]::OpenRead($Path); ' +
  'try { ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream))).Replace(''-'', '''').ToLower() } ' +
  'finally { $stream.Dispose() } }; '

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

# Filas por tabla del Postgres de Letta, o $null si no se pudieron contar. El
# SQL viaja en base64 dentro de la orden: por una tubería, Windows PowerShell
# le pone delante una marca BOM.
function Get-LettaRows([string]$Container) {
  $sql = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($lettaRowsSql))
  $lines = Invoke-Quiet {
    docker exec $Container sh -c ("echo $sql | base64 -d | " +
      'psql -U $POSTGRES_USER -d $POSTGRES_DB -At -v ON_ERROR_STOP=1 -f -')
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  $rows = @($lines | Where-Object { $_ -match '^\w+=\d+$' })
  if ($rows.Count -eq 0) { return $null }
  return $rows
}

# El volcado del Postgres de Letta. Devuelve la imagen del contenedor y, si se
# pudieron contar, el archivo con las filas por tabla. Lanza si algo falla:
# quien llama decide si la copia sigue sin Letta.
function Get-LettaDump([string]$Container, [string]$Folder) {
  Write-Step "volcando el Postgres de Letta ($Container)"
  # El volcado se escribe dentro del contenedor y se saca con `docker cp`: por
  # la salida de PowerShell un archivo binario llegaría estropeado. El usuario
  # y la base son los del propio contenedor (las comillas simples dejan que
  # los resuelva su intérprete, no PowerShell).
  $inside = '/tmp/shiro-letta.dump'
  $rows = $null
  $counted = $true
  try {
    # Las filas se cuentan antes y después: si coinciden, valen para comparar
    # al restaurar. Si Letta escribió entretanto, se repite una vez.
    foreach ($attempt in 1, 2) {
      $before = Get-LettaRows $Container
      & docker exec $Container sh -c ('pg_dump -U $POSTGRES_USER -Fc -f ' + $inside + ' $POSTGRES_DB') | Out-Host
      if ($LASTEXITCODE -ne 0) { throw 'pg_dump falló dentro del contenedor de Letta' }
      $after = Get-LettaRows $Container
      if (-not $before -or -not $after) { $counted = $false; break }
      if (($before -join '|') -eq ($after -join '|')) { $rows = $after; break }
    }
    Invoke-Quiet { docker cp "${Container}:$inside" (Join-Path $Folder 'letta.dump') } | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'no se pudo sacar el volcado del contenedor de Letta' }
  } finally {
    Invoke-Quiet { docker exec $Container rm -f $inside } | Out-Null
  }
  $image = "$(Invoke-Quiet { docker inspect --format '{{.Config.Image}}' $Container })".Trim()
  if (-not $rows) {
    if ($counted) { Write-Step 'Letta estaba escribiendo durante el volcado: la copia va sin el recuento de filas' }
    else { Write-Step 'no se pudieron contar las filas de Letta: la copia va sin el recuento' }
    return @{ Image = $image }
  }
  $rowsFile = Join-Path $script:tmp 'letta-filas.txt'
  [System.IO.File]::WriteAllLines($rowsFile, [string[]]$rows)
  return @{ Image = $image; RowsFile = $rowsFile }
}

# Qué lleva la copia de Letta: el volcado, o el motivo por el que va sin él.
# La memoria local es lo que no se puede regenerar, así que un fallo de Letta
# no tumba la copia: la deja parcial y lo dice. Con -RequireLetta sí es un error.
function Get-LettaPart([string]$Folder) {
  if ($SkipLetta) { return @{ Reason = 'se pidió no incluirlo (-SkipLetta)' } }
  $reason = $null
  $containers = @($LettaContainer | Where-Object { $_ })
  if ($containers.Count -eq 0 -and (Get-Command docker -ErrorAction SilentlyContinue)) {
    $containers = @(Invoke-Quiet { docker ps --filter 'label=com.docker.compose.service=letta' --format '{{.Names}}' } |
        Where-Object { $_ })
  }
  if ($containers.Count -eq 0) { $reason = 'Letta no estaba en marcha' }
  elseif ($containers.Count -gt 1) {
    $reason = "hay más de un contenedor de Letta ($($containers -join ', ')): indica cuál con -LettaContainer"
  } else {
    try {
      return Get-LettaDump $containers[0] $Folder
    } catch {
      $reason = "el volcado de Letta falló: $($_.Exception.Message)"
      # Un volcado a medias no viaja con la copia.
      Remove-Item -LiteralPath (Join-Path $Folder 'letta.dump') -Force -ErrorAction SilentlyContinue
    }
  }
  if ($RequireLetta) { throw "$reason, y se pidió una copia completa (-RequireLetta)" }
  Write-Step "AVISO: la copia va sin Letta: $reason"
  return @{ Reason = $reason }
}

# Retira las copias que sobran: solo carpetas con nombre de copia y con su
# manifiesto, y solo dentro de la carpeta de las copias. De cada una se dice si
# es completa: la última completa no se retira nunca, ni la recién hecha.
function Remove-OldCopies([string]$Root, [string]$Current) {
  $rootQ = ConvertTo-Quoted $Root
  $present = Invoke-AtDestination ("Get-ChildItem -LiteralPath $rootQ -Directory | ForEach-Object { " +
    "`$state = 'sin-manifiesto'; `$file = Join-Path `$_.FullName 'manifest.json'; " +
    "if (Test-Path -LiteralPath `$file) { try { " +
    "if ((Get-Content -LiteralPath `$file -Raw -Encoding UTF8 | ConvertFrom-Json).complete) " +
    "{ `$state = 'completa' } else { `$state = 'parcial' } } catch { } }; " +
    "`$_.Name + '=' + `$state }")
  $extra = @($present) | & node $helper rotate --keep $Keep
  if ($LASTEXITCODE -ne 0) { throw 'no se pudo decidir qué copias sobran' }
  foreach ($old in @($extra)) {
    if ($old -notmatch $backupName -or $old -eq $Current) { continue }
    Invoke-AtDestination "Remove-Item -LiteralPath $(ConvertTo-Quoted (Join-Path $Root $old)) -Recurse -Force" | Out-Null
    Write-Step "retirada la copia antigua $old"
  }
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
      # que no depende del idioma de Windows): lleva el historial en claro. Si
      # los permisos no se pueden poner, la carpeta no se deja abierta.
      $create += "; `$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value" +
        "; & icacls $rootQ /inheritance:r /grant:r ('*' + `$sid + ':(OI)(CI)F') | Out-Null" +
        "; if (`$LASTEXITCODE -ne 0) { Remove-Item -LiteralPath $rootQ -Recurse -Force; throw 'icacls' }"
    }
    Invoke-AtDestination $create | Out-Null
    Write-Step "carpeta $root creada en el destino"
  }

  # 1. La copia se prepara en un temporal de este equipo: la carpeta `copia`
  #    es lo que viaja; lo demás son archivos de paso.
  $name = "$(Invoke-Helper name)".Trim()
  if ($name -notmatch $backupName) { throw "nombre de copia inesperado: $name" }
  $script:tmp = Join-Path ([System.IO.Path]::GetTempPath()) "shiro-backup-$name"
  $copy = Join-Path $script:tmp 'copia'
  New-Item -ItemType Directory -Path $copy | Out-Null
  # La memoria va antes que el volcado de Letta: un turno que se envíe a
  # Letta entre los dos pasos queda en la copia como pendiente, y al restaurar
  # se reenvía. Al revés constaría como enviado sin estar en el volcado.
  Write-Step 'sacando la instantánea de la memoria'
  $snapshotArgs = @('snapshot', '--db', $MemoryDb, '--out', $copy)
  if ($AllowEmpty) { $snapshotArgs += '--allow-empty' }
  Invoke-Helper @snapshotArgs | Out-Null
  $createArgs = @('create', '--out', $copy, '--name', $name)

  $letta = Get-LettaPart $copy
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

  $summary = "$(Invoke-Helper @createArgs)" | ConvertFrom-Json
  $manifestFile = Join-Path $copy 'manifest.json'
  $manifest = Get-Content -LiteralPath $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json

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

  $hashes = Invoke-AtDestination ($sha256Function + "Get-ChildItem -LiteralPath $partialQ -File | " +
    "ForEach-Object { `$_.Name + '=' + (Get-Sha256 `$_.FullName) }")
  $expected = @($manifest.files | ForEach-Object { "$($_.name)=$($_.sha256)" })
  $expected += 'manifest.json=' + (& ([scriptblock]::Create($sha256Function + 'Get-Sha256 $args[0]')) $manifestFile)
  foreach ($line in $expected) {
    if (@($hashes) -notcontains $line) {
      throw "$($line.Split('=')[0]) no llegó igual al destino: la copia no se da por buena"
    }
  }
  Invoke-AtDestination "Rename-Item -LiteralPath $partialQ -NewName $(ConvertTo-Quoted $name)" | Out-Null
  $script:partial = $null

  # 3. La copia ya está hecha y comprobada: se anota antes que nada.
  Invoke-Helper mark --db $MemoryDb --dir $copy | Out-Null
  $kind = if ($summary.complete) { 'completa' } else { "sin el volcado de Letta ($($letta.Reason))" }
  Write-Step "copia $name hecha: $($summary.turns) turnos, $kind"
  $script:exitCode = 0

  # 4. Se retiran las copias que sobran. Si esto falla, la copia sigue siendo
  #    buena: se avisa y ya.
  try {
    Remove-OldCopies $root $name
  } catch {
    Write-Step "AVISO: no se pudieron retirar las copias antiguas: $($_.Exception.Message)"
  }
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
