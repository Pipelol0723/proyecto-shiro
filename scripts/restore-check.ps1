<#
.SYNOPSIS
  Ensayo de restauración de una copia de seguridad de la memoria (P-11a y P-43).

.DESCRIPTION
  Comprueba que una copia se puede restaurar, sin tocar la memoria ni el Letta
  de verdad:

    1. Los archivos coinciden con el manifiesto.
    2. La memoria copiada se abre, pasa la comprobación de SQLite y tiene los
       turnos que dice el manifiesto.
    3. Si la copia lleva el volcado de Letta, arranca un Letta temporal con la
       misma imagen y sin puertos, restaura el volcado en una base aparte y
       compara las filas de cada tabla con las que había al copiar. Al terminar
       borra ese contenedor y su volumen.

  La restauración de verdad (poner la copia en el sitio de la memoria y del
  Letta en uso) no la hace este script: ver RESTORE.md.

  Códigos de salida:
    0  todo lo que lleva la copia se ha comprobado y se restaura bien
    1  algo no cuadra o falló
    2  lo comprobado está bien, pero quedó una parte sin comprobar: se pidió
       -SkipLetta, o la copia no lleva el recuento de filas de Letta

.EXAMPLE
  npm run backup:check -- -Backup E:\shiro-backup\20261120T083005Z
#>
[CmdletBinding()]
param(
  # Carpeta de la copia: la que tiene manifest.json.
  [Parameter(Mandatory = $true)][string]$Backup,
  # Comprueba solo la memoria, sin arrancar el Letta temporal.
  [switch]$SkipLetta,
  # Cuánto se espera a que arranque el Postgres del Letta temporal.
  [int]$StartTimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$helper = Join-Path $PSScriptRoot 'backup\memory-backup.mjs'
$lettaRowsSql = Join-Path $PSScriptRoot 'backup\letta-rows.sql'
# Un nombre que no pueda coincidir con ningún otro contenedor: al terminar se
# borra por nombre, y solo puede ser el de esta ejecución.
$container = "shiro-restore-check-$PID-$([guid]::NewGuid().ToString('N').Substring(0, 8))"
$script:started = $false
$script:rowsFile = $null
$script:partial = $null

function Write-Step([string]$Message) { Write-Host "[ensayo] $Message" }

function Invoke-Helper {
  $output = & node $helper @args
  if ($LASTEXITCODE -ne 0) { throw "falló el paso «$($args[0])» del ensayo" }
  return $output
}

# Igual que en backup-homelab.ps1: una orden cuyo mensaje de error no interesa.
function Invoke-Quiet([scriptblock]$Command) {
  $ErrorActionPreference = 'Continue'
  & $Command 2>$null
}

function Invoke-Check {
  $summary = "$(Invoke-Helper check --dir $Backup)" | ConvertFrom-Json
  Write-Step "memoria: $($summary.turns) turnos, como dice el manifiesto; los archivos coinciden"
  if (-not $summary.complete) {
    Write-Step 'la copia no lleva el volcado de Letta: lo que lleva, la memoria, está comprobado'
    return
  }
  if ($SkipLetta) {
    $script:partial = 'el volcado de Letta no se ha ensayado (-SkipLetta)'
    return
  }
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw 'hace falta Docker para ensayar el volcado de Letta (o -SkipLetta para comprobar solo la memoria)'
  }
  if (-not $summary.lettaImage) { throw 'el manifiesto no dice con qué imagen de Letta se hizo la copia' }

  # Un Letta aparte: sin puertos publicados y con un volumen propio, que se
  # borra al terminar. No toca el contenedor ni el volumen del Letta en uso.
  # Se da por arrancado antes de pedirlo: si Docker lo crea y falla al
  # arrancarlo, también hay que borrarlo. El error de Docker se deja ver.
  Write-Step "arrancando un Letta temporal ($container)"
  $script:started = $true
  & docker run -d --name $container $summary.lettaImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'no se pudo arrancar el Letta temporal' }

  $deadline = (Get-Date).AddSeconds($StartTimeoutSeconds)
  while ($true) {
    Invoke-Quiet { docker exec $container sh -c 'pg_isready -U $POSTGRES_USER -d $POSTGRES_DB' } | Out-Null
    if ($LASTEXITCODE -eq 0) { break }
    if ((Get-Date) -gt $deadline) { throw "el Postgres del Letta temporal no arrancó en $StartTimeoutSeconds segundos" }
    Start-Sleep -Seconds 2
  }

  Write-Step 'restaurando el volcado en una base aparte'
  Invoke-Quiet { docker cp (Join-Path $Backup 'letta.dump') "${container}:/tmp/letta.dump" } | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'no se pudo llevar el volcado al Letta temporal' }
  & docker exec $container sh -c ('createdb -U $POSTGRES_USER restore_check && ' +
    'pg_restore -U $POSTGRES_USER -d restore_check --no-owner /tmp/letta.dump') | Out-Host
  if ($LASTEXITCODE -ne 0) { throw 'pg_restore falló: el volcado no se restaura' }

  if ($null -eq $summary.lettaTables) {
    # Sin el recuento de cuando se copió, restaurar sin errores es todo lo que
    # se puede decir: no hay con qué comparar.
    $script:partial = 'el volcado de Letta se restaura sin errores, pero la copia no lleva el recuento de filas: no se ha podido comparar'
    return
  }

  # El SQL viaja en base64 dentro de la orden: por una tubería, Windows
  # PowerShell le pone delante una marca BOM.
  $sql = [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($lettaRowsSql))
  $rows = Invoke-Quiet {
    docker exec $container sh -c ("echo $sql | base64 -d | " +
      'psql -U $POSTGRES_USER -d restore_check -At -v ON_ERROR_STOP=1 -f -')
  }
  if ($LASTEXITCODE -ne 0) { throw 'no se pudieron contar las filas de la base restaurada' }
  $script:rowsFile = Join-Path ([System.IO.Path]::GetTempPath()) "$container-filas.txt"
  [System.IO.File]::WriteAllLines($script:rowsFile, [string[]]@($rows))
  Write-Step "Letta: $(Invoke-Helper compare-rows --dir $Backup --rows $script:rowsFile)"
}

$exitCode = 1
try {
  Invoke-Check
  if ($script:partial) {
    Write-Step "lo comprobado está bien, pero falta una parte: $($script:partial)"
    $exitCode = 2
  } else {
    Write-Step 'todo lo que lleva la copia se restaura bien'
    $exitCode = 0
  }
} catch {
  Write-Host "[ensayo] ERROR: $($_.Exception.Message)"
} finally {
  if ($script:rowsFile) { Remove-Item -LiteralPath $script:rowsFile -Force -ErrorAction SilentlyContinue }
  if ($script:started) {
    # Con -v se va también su volumen: lleva una copia del Letta restaurado.
    Invoke-Quiet { docker rm -f -v $container } | Out-Null
  }
}
exit $exitCode
