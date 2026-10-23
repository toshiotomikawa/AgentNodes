param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$project = Split-Path $PSScriptRoot -Parent
$url = 'http://127.0.0.1:5199/'
$mutex = [Threading.Mutex]::new($false, 'Local\AgentNotes-5199-Launcher')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(30000) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'Another Agent Notes launch is still in progress.' }

    function Test-AgentNotes {
        try {
            $page = Invoke-WebRequest $url -TimeoutSec 2 -UseBasicParsing
            return $page.StatusCode -eq 200 -and $page.Content -match '<title>Agent Nodes</title>'
        } catch { return $false }
    }

    if (!(Test-AgentNotes)) {
        $probe = [Net.Sockets.TcpClient]::new()
        try { $probe.Connect('127.0.0.1', 5199); $occupied = $true }
        catch { $occupied = $false }
        finally { $probe.Dispose() }
        if ($occupied) { throw 'Port 5199 is already occupied by a server that is not responding as Agent Notes.' }
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $vite = Join-Path $project 'node_modules\vite\bin\vite.js'
        if (!(Test-Path -LiteralPath $vite)) { throw 'Install the project dependencies with npm install first.' }
        $logs = Join-Path $project '.local'
        New-Item -ItemType Directory -Path $logs -Force | Out-Null
        $server = Start-Process -FilePath $node -ArgumentList @(('"' + $vite + '"'), '--host', '127.0.0.1', '--port', '5199', '--strictPort') -WorkingDirectory $project -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'server.stdout.log') -RedirectStandardError (Join-Path $logs 'server.stderr.log') -PassThru
        $ready = $false
        for ($attempt = 0; $attempt -lt 60; $attempt++) {
            if (Test-AgentNotes) { $ready = $true; break }
            if ($server.HasExited) { throw 'Agent Notes exited during startup. See .local/server.stderr.log.' }
            Start-Sleep -Milliseconds 250
        }
        if (!$ready) { throw 'Agent Notes did not become ready. See .local/server.stderr.log.' }
    }
    if (!$NoBrowser) { Start-Process $url }
} catch {
    if ($NoBrowser) { throw }
    $shell = New-Object -ComObject WScript.Shell
    $shell.Popup($_.Exception.Message, 0, 'Agent Notes', 16) | Out-Null
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
