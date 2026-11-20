<#
.SYNOPSIS
  Restauración de verdad de una copia de seguridad de la memoria (P-11a).

.DESCRIPTION
  Pone una copia en el sitio de la memoria local (-Memory), del Letta en uso
  (-Letta), o de los dos. Sin -Yes solo dice lo que haría.

  Antes de tocar nada comprueba la copia (archivos, memoria y turnos) y que
  Shiro está cerrado.

  La memoria local: aparta la que hay (el archivo y sus dos archivos de al
  lado, `-wal` y `-shm`) a una carpeta `antes-<fecha>`, comprueba que no queda
  ninguno y copia la de la copia. Si quedara al lado un archivo de la memoria
  anterior, SQLite lo aplicaría encima de la restaurada. Si la copia no se
  puede poner, la memoria que había vuelve a su sitio.

  Letta: restaura el volcado en una base aparte del Letta en marcha, compara
  las filas con las de la copia, cambia esa base por la que hay en una sola
  transacción, comprueba que el cambio se hizo y reinicia Letta. La base
  anterior queda guardada con el nombre `letta_antes_<fecha>`. No restaura
  encima de la base en uso: eso la deja sin tablas.

  Nada se borra: lo anterior queda apartado. Para volver a la base anterior
  de Letta, -LettaUndo <nombre con el que quedó guardada>.

  Códigos de salida: 0 hecho (o, sin -Yes, dicho lo que haría); 1 error, o
  hecho con un aviso que hay que mirar.

.EXAMPLE
  npm run backup:restore -- -Backup E:\shiro-backup\20261120T083005Z -Memory -Letta

.EXAMPLE
  npm run backup:restore -- -Backup E:\shiro-backup\20261120T083005Z -Memory -Letta -Yes

.EXAMPLE
  npm run backup:restore -- -LettaUndo letta_antes_20261120t083005z -Yes
#>
[CmdletBinding()]
param(
  # Carpeta de la copia: la que tiene manifest.json.
  [string]$Backup,
  [switch]$Memory,
  [switch]$Letta,
  # Dónde va la memoria. Por defecto, la de desarrollo (packages/core-host/data).
  [string]$MemoryDb,
  # Restaura la memoria de la app instalada, no la de desarrollo.
  [switch]$Installed,
  # El contenedor de Letta, si hay más de uno.
  [string]$LettaContainer,
  # Vuelve a la base de Letta que la restauración dejó guardada
  # (letta_antes_<fecha>). La que está en uso se guarda a su vez.
  [string]$LettaUndo,
  # Sin esto no se cambia nada.
  [switch]$Yes,
  # Cuánto se espera a que Letta vuelva tras reiniciarlo.
  [int]$StartTimeoutSeconds = 120
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$helper = Join-Path $PSScriptRoot 'backup\memory-backup.mjs'
$lettaRowsSql = Join-Path $PSScriptRoot 'backup\letta-rows.sql'
$lettaSwapSql = Join-Path $PSScriptRoot 'backup\letta-swap.sql'
if ($Installed) {
  $tauri = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\packages\desktop\src-tauri\tauri.conf.json') -Raw -Encoding UTF8 |
    ConvertFrom-Json
  $MemoryDb = Join-Path $env:LOCALAPPDATA "$($tauri.identifier)\data\memory.db"
} elseif (-not $MemoryDb) {
  $MemoryDb = Join-Path $PSScriptRoot '..\packages\core-host\data\memory.db'
}
$script:rowsFile = $null
$script:warnings = @()
$script:lettaOld = $null

function Write-Step([string]$Message) { Write-Host "[restaurar] $Message" }

function Invoke-Helper {
  $output = & node $helper @args
  if ($LASTEXITCODE -ne 0) { throw "falló el paso «$($args[0])» de la restauración" }
  return $output
}

# Igual que en backup-homelab.ps1: una orden cuyo mensaje de error no interesa.
function Invoke-Quiet([scriptblock]$Command) {
  $ErrorActionPreference = 'Continue'
  & $Command 2>$null
}

# El hash con .NET: la función de PowerShell se pierde si esto se lanza desde
# PowerShell 7 (ver backup-homelab.ps1).
function Get-Sha256([string]$Path) {
  $stream = [System.IO.File]::OpenRead($Path)
  try {
    return ([System.BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream))).Replace('-', '').ToLower()
  } finally {
    $stream.Dispose()
  }
}

function Test-Port([string]$HostName, [int]$Port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $pending = $client.BeginConnect($HostName, $Port, $null, $null)
    if (-not $pending.AsyncWaitHandle.WaitOne(1500)) { return $false }
    $client.EndConnect($pending)
    return $true
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

# ¿Hay un core-host escuchando? El puerto sale de la misma variable que usa el
# servidor, o del `.env` de la raíz si está ahí (solo se lee esa línea). La app
# instalada usa siempre el 9876, así que con -Installed se mira también ese.
function Test-ShiroRunning {
  $ports = @()
  $configured = $env:SHIRO_HOST_PORT
  $envFile = Join-Path $PSScriptRoot '..\.env'
  if (-not $configured -and (Test-Path -LiteralPath $envFile)) {
    $line = Select-String -LiteralPath $envFile -Pattern '^\s*SHIRO_HOST_PORT\s*=\s*"?(\d+)' | Select-Object -First 1
    if ($line) { $configured = $line.Matches[0].Groups[1].Value }
  }
  if ($configured) { $ports += [int]$configured } else { $ports += 9876 }
  if ($Installed -and $ports -notcontains 9876) { $ports += 9876 }
  foreach ($port in $ports) {
    foreach ($address in '127.0.0.1', '::1') {
      if (Test-Port $address $port) { return $true }
    }
  }
  return $false
}

# El contenedor de Letta en marcha: uno y solo uno. Con `$Image`, además, de
# esa imagen.
function Get-LettaContainer([string]$Image) {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw 'hace falta Docker para restaurar Letta' }
  $found = @($LettaContainer | Where-Object { $_ })
  if ($found.Count -eq 0) {
    $found = @(Invoke-Quiet { docker ps --filter 'label=com.docker.compose.service=letta' --format '{{.Names}}' } |
        Where-Object { $_ })
  }
  if ($found.Count -eq 0) { throw 'Letta no está en marcha: arráncalo (docker compose up -d) y repite' }
  if ($found.Count -gt 1) {
    throw "hay más de un contenedor de Letta ($($found -join ', ')): indica cuál con -LettaContainer"
  }
  $running = "$(Invoke-Quiet { docker inspect --format '{{.Config.Image}}' $found[0] })".Trim()
  if ($LASTEXITCODE -ne 0 -or -not $running) { throw "no se encuentra el contenedor $($found[0])" }
  if ($Image -and $running -ne $Image) {
    throw ("el Letta en marcha es de otra imagen que el de la copia ($running frente a $Image). " +
      'Restaurar el volcado en otra versión no es seguro: usa la misma imagen, o restaura solo la memoria ' +
      'y rellena Letta con «npm run reindex-memory -- --yes»')
  }
  return $found[0]
}

# Ejecuta SQL en una base del contenedor y devuelve sus líneas, o $null si
# falló. El SQL viaja en base64 dentro de la orden: por una tubería, Windows
# PowerShell le pone delante una marca BOM. El usuario y la base los resuelve
# el intérprete del contenedor (van entre comillas simples).
function Invoke-LettaSql([string]$Container, [string]$Database, [string]$Sql, [string[]]$Options) {
  $encoded = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Sql))
  $lines = Invoke-Quiet {
    docker exec $Container sh -c ("echo $encoded | base64 -d | " + 'psql -U $POSTGRES_USER -d ' + $Database +
      ' -At -v ON_ERROR_STOP=1 ' + ($Options -join ' ') + ' -f -')
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  return @($lines | Where-Object { $_ })
}

# ¿Existe esa base en el Postgres de Letta? Si no se puede saber, cuenta como no.
function Test-LettaDatabase([string]$Container, [string]$Name) {
  $rows = Invoke-LettaSql $Container 'postgres' "SELECT count(*) FROM pg_database WHERE datname = :'name';" @("-v name=$Name")
  return ((@($rows) -join '').Trim() -eq '1')
}

# Cambia la base que usa Letta por otra, en una sola transacción (o entero, o
# nada), y reinicia Letta para que la abra. La que había queda guardada.
function Switch-LettaDatabase([string]$Container, [string]$New, [string]$Old) {
  $sql = [System.IO.File]::ReadAllText($lettaSwapSql)
  $options = @('-v db=$POSTGRES_DB', "-v new=$New", "-v old=$Old", '--single-transaction')
  $swapped = $false
  # Si Letta abre una conexión entre dos pasos, el cambio no entra: se repite.
  foreach ($attempt in 1, 2, 3) {
    Invoke-LettaSql $Container 'postgres' $sql $options | Out-Null
    # Lo que diga psql no basta: lo que cuenta es cómo quedaron las bases.
    if ((Test-LettaDatabase $Container $Old) -and -not (Test-LettaDatabase $Container $New)) {
      $swapped = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $swapped) {
    throw ("no se pudo cambiar la base de Letta por «$New». La base en uso no se ha tocado, y «$New» sigue ahí " +
      '(al repetir la restauración se vuelve a crear)')
  }

  Write-Step 'reiniciando Letta'
  & docker restart $Container | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw ("la base de Letta ya está cambiada (la anterior quedó como «$Old»), pero Letta no se pudo reiniciar. " +
      "Reinícialo a mano (docker restart $Container). Si ibas a restaurar también la memoria, repite solo con -Memory")
  }
  $deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
  while ($true) {
    Invoke-Quiet { docker exec $Container sh -c 'pg_isready -U $POSTGRES_USER -d $POSTGRES_DB' } | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ((Get-Date) -gt $deadline) {
      $script:warnings += "Letta no responde tras $StartTimeoutSeconds segundos de reiniciarlo: mira «docker logs $Container»"
      break
    }
    Start-Sleep -Seconds 2
  }
}

function Restore-Letta([string]$Container, [string]$Stamp, $Summary) {
  $inside = '/tmp/shiro-restore.dump'
  $old = "letta_antes_$($Stamp.ToLower())"
  try {
    # 1. El volcado se restaura en una base aparte. La que está en uso no se toca.
    Write-Step 'restaurando el volcado en una base aparte'
    try {
      Invoke-Quiet { docker cp (Join-Path $Backup 'letta.dump') "${Container}:$inside" } | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'no se pudo llevar el volcado al contenedor de Letta' }
      & docker exec $Container sh -c ('dropdb --if-exists -U $POSTGRES_USER letta_restaurada && ' +
        'createdb -U $POSTGRES_USER letta_restaurada && ' +
        'pg_restore -U $POSTGRES_USER -d letta_restaurada --no-owner ' + $inside) | Out-Host
      if ($LASTEXITCODE -ne 0) { throw 'pg_restore falló: el volcado no se restaura' }

      # Sin tablas no es una restauración, lleve o no la copia su recuento.
      $rows = @(Invoke-LettaSql $Container 'letta_restaurada' ([System.IO.File]::ReadAllText($lettaRowsSql)) @())
      if ($rows.Count -eq 0) { throw 'la base restaurada sale sin tablas' }
      if ($null -ne $Summary.lettaTables) {
        $script:rowsFile = Join-Path ([System.IO.Path]::GetTempPath()) "shiro-restore-$PID-filas.txt"
        [System.IO.File]::WriteAllLines($script:rowsFile, [string[]]$rows)
        Write-Step "Letta restaurado aparte: $(Invoke-Helper compare-rows --dir $Backup --rows $script:rowsFile)"
      } else {
        Write-Step "Letta restaurado aparte: $($rows.Count) tablas. La copia no lleva el recuento de filas: no se puede comparar"
      }
    } catch {
      # Lo restaurado a medias no se queda: la base en uso sigue como estaba.
      Invoke-Quiet { docker exec $Container sh -c 'dropdb --if-exists -U $POSTGRES_USER letta_restaurada' } | Out-Null
      throw "$($_.Exception.Message). La base de Letta en uso no se ha tocado"
    }

    # 2. Se cambia la base en uso por la restaurada y se reinicia Letta.
    Switch-LettaDatabase $Container 'letta_restaurada' $old
    $script:lettaOld = $old
    Write-Step "Letta restaurado. La base anterior queda guardada como «$old»"
  } finally {
    Invoke-Quiet { docker exec $Container rm -f $inside } | Out-Null
  }
}

function Restore-Memory([string]$Stamp, $Manifest) {
  $dataDir = Split-Path -Parent $MemoryDb
  # Los tres archivos de una memoria de SQLite, se llame como se llame.
  $leaf = Split-Path -Leaf $MemoryDb
  $files = $leaf, "$leaf-wal", "$leaf-shm"
  if (-not (Test-Path -LiteralPath $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null }
  $present = @($files | Where-Object { Test-Path -LiteralPath (Join-Path $dataDir $_) })
  $aside = Join-Path $dataDir "antes-$Stamp"

  # Devuelve a su sitio lo que se haya apartado: la memoria anterior no se
  # queda partida entre dos carpetas, ni la carpeta de datos sin memoria.
  $moved = @()
  $putBack = {
    foreach ($name in $moved) { Move-Item -LiteralPath (Join-Path $aside $name) -Destination $dataDir }
    if ((Test-Path -LiteralPath $aside) -and -not (Get-ChildItem -LiteralPath $aside -Force)) {
      Remove-Item -LiteralPath $aside -Force
    }
  }

  if ($present.Count -gt 0) {
    if (Test-Path -LiteralPath $aside) { throw "ya existe ${aside}: no se aparta nada encima" }
    New-Item -ItemType Directory -Path $aside | Out-Null
    try {
      foreach ($name in $present) {
        Move-Item -LiteralPath (Join-Path $dataDir $name) -Destination $aside
        $moved += $name
      }
    } catch {
      $reason = $_.Exception.Message
      & $putBack
      throw "no se pudo apartar la memoria que hay ($reason). No se ha cambiado nada"
    }
  }

  try {
    # Ninguno de los tres puede quedar al lado de la memoria restaurada.
    $left = @($files | Where-Object { Test-Path -LiteralPath (Join-Path $dataDir $_) })
    if ($left.Count -gt 0) { throw "siguen en la carpeta: $($left -join ', ')" }
    Copy-Item -LiteralPath (Join-Path $Backup 'memory.db') -Destination $MemoryDb
    $expected = ($Manifest.files | Where-Object { $_.name -eq 'memory.db' }).sha256
    if ((Get-Sha256 $MemoryDb) -ne $expected) { throw 'la memoria no llegó igual que en la copia' }
  } catch {
    $reason = $_.Exception.Message
    Remove-Item -LiteralPath $MemoryDb -Force -ErrorAction SilentlyContinue
    & $putBack
    throw "no se pudo poner la memoria de la copia ($reason). La memoria que había sigue en su sitio"
  }
  if ($present.Count -gt 0) { Write-Step "memoria restaurada. La anterior queda en $aside" }
  else { Write-Step 'memoria restaurada. No había ninguna antes' }
}

# Vuelve a una base de Letta que la restauración dejó guardada. La que está en
# uso se guarda a su vez: tampoco aquí se borra nada.
function Undo-Letta {
  if ($Backup -or $Memory -or $Letta) { throw 'con -LettaUndo va solo el nombre de la base guardada: sin -Backup, -Memory ni -Letta' }
  # Sin distinguir mayúsculas no vale: el nombre va tal cual a Postgres.
  if ($LettaUndo -cnotmatch '^letta_antes_\d{8}t\d{6}z\z') {
    throw 'con -LettaUndo va el nombre de la base guardada: letta_antes_<fecha>, tal como lo dijo la restauración'
  }
  if (Test-ShiroRunning) { throw 'Shiro está en marcha: ciérralo antes' }
  $container = Get-LettaContainer ''
  if (-not (Test-LettaDatabase $container $LettaUndo)) { throw "no existe la base guardada «$LettaUndo» en ese Letta" }
  Write-Step "Letta: volver a la base «$LettaUndo». La que está en uso se guarda como «letta_descartada_<fecha>»"
  if (-not $Yes) {
    Write-Step 'No se ha cambiado nada. Para hacerlo, repite con -Yes'
    return
  }
  $discarded = "letta_descartada_$("$(Invoke-Helper name)".Trim().ToLower())"
  Switch-LettaDatabase $container $LettaUndo $discarded
  Write-Step "Letta vuelve a usar la base de antes. La que estaba en uso queda guardada como «$discarded»"
}

function Invoke-Restore {
  if ($LettaUndo) { Undo-Letta; return }
  if (-not $Backup) { throw 'falta la copia: -Backup <carpeta de la copia>' }
  if (-not $Memory -and -not $Letta) { throw 'di qué restaurar: -Memory, -Letta o los dos' }

  $summary = "$(Invoke-Helper check --dir $Backup)" | ConvertFrom-Json
  $manifest = Get-Content -LiteralPath (Join-Path $Backup 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
  $kind = if ($summary.complete) { 'con el volcado de Letta' } else { 'sin el volcado de Letta' }
  Write-Step "copia $($summary.name): $($summary.turns) turnos, $kind. Los archivos coinciden con el manifiesto"
  if ($Letta -and -not $summary.complete) { throw 'la copia no lleva el volcado de Letta: no hay nada de Letta que restaurar' }
  if (Test-ShiroRunning) { throw 'Shiro está en marcha: ciérralo antes de restaurar' }

  $container = $null
  if ($Letta) { $container = Get-LettaContainer $summary.lettaImage }

  if ($Letta) { Write-Step "Letta: restaurar el volcado en el contenedor $container. La base de ahora se guarda como «letta_antes_<fecha>»" }
  if ($Memory) { Write-Step "memoria: poner la de la copia en $MemoryDb. La que hay se aparta a «antes-<fecha>», al lado" }
  if (-not $Yes) {
    Write-Step 'No se ha cambiado nada. Para hacerlo, repite con -Yes'
    return
  }
  $stamp = "$(Invoke-Helper name)".Trim()
  if ($stamp -cnotmatch '^\d{8}T\d{6}Z\z') { throw "fecha inesperada: $stamp" }

  # Letta primero: es lo que puede fallar, y si falla no cambia nada.
  if ($Letta) { Restore-Letta $container $stamp $summary }
  if ($Memory) {
    try {
      Restore-Memory $stamp $manifest
    } catch {
      if (-not $script:lettaOld) { throw }
      throw ("Letta ya es el de la copia (la base anterior quedó como «$($script:lettaOld)»), pero la memoria no: " +
        "$($_.Exception.Message). Repite solo con -Memory, o vuelve atrás en Letta con -LettaUndo $($script:lettaOld)")
    }
  }

  if ($Memory -and $Letta) {
    Write-Step 'la memoria y Letta son ahora los de la misma copia'
  } else {
    $other = if ($Memory) { 'Letta no se ha tocado' } else { 'la memoria local no se ha tocado' }
    Write-Step ("$other. Si no es de esta misma copia, no cuadran: «npm run reindex-memory -- --yes» " +
      'vuelve a llenar Letta desde la memoria')
  }
}

$exitCode = 1
try {
  Invoke-Restore
  $exitCode = 0
} catch {
  Write-Host "[restaurar] ERROR: $($_.Exception.Message)"
} finally {
  if ($script:rowsFile) { Remove-Item -LiteralPath $script:rowsFile -Force -ErrorAction SilentlyContinue }
}
# Un aviso no deshace lo hecho, pero tampoco se da por bueno sin mirarlo.
foreach ($warning in $script:warnings) {
  Write-Host "[restaurar] AVISO: $warning"
  $exitCode = 1
}
exit $exitCode
