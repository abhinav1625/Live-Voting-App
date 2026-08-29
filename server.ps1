<#
.SYNOPSIS
    Lightweight Native PowerShell HTTP Server for Live Voting App.
    Auto-detects local LAN IP so phones on the same Wi-Fi can scan the QR code and vote!
#>

$port = 8080
$rootPath = $PSScriptRoot

# Detect Local IPv4 Address
$localIp = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { 
    $_.InterfaceAlias -notmatch 'Loopback|vEthernet|Virtual' -and $_.IPAddress -notmatch '^169\.254' 
} | Select-Object -First 1).IPAddress

if (-not $localIp) {
    $localIp = "localhost"
}

$prefixes = @("http://localhost:$port/", "http://127.0.0.1:$port/")
if ($localIp -ne "localhost") {
    $prefixes += "http://${localIp}:${port}/"
}

$listener = New-Object System.Net.HttpListener
foreach ($p in $prefixes) {
    try {
        $listener.Prefixes.Add($p)
    } catch {
        # Catch potential permission bounds for non-admin url reservations
    }
}

try {
    $listener.Start()
} catch {
    # Fallback to localhost only if LAN prefix requires elevation
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "           LIVE VOTING APP - LOCAL SERVER" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "Local Browser URL:  http://localhost:$port" -ForegroundColor Yellow
if ($localIp -ne "localhost") {
    Write-Host "Wi-Fi Mobile URL:   http://${localIp}:$port" -ForegroundColor Green
    Write-Host "(Phones on the same Wi-Fi can scan the QR code directly!)" -ForegroundColor Gray
}
Write-Host "Serving from:       $rootPath" -ForegroundColor Gray
Write-Host "Press Ctrl+C to stop server..." -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

# Open default browser
Start-Process "http://localhost:$port"

# MIME Type mappings
$mimeTypes = @{
    ".html" = "text/html; charset=utf-8";
    ".css"  = "text/css; charset=utf-8";
    ".js"   = "application/javascript; charset=utf-8";
    ".json" = "application/json; charset=utf-8";
    ".png"  = "image/png";
    ".jpg"  = "image/jpeg";
    ".svg"  = "image/svg+xml";
    ".ico"  = "image/x-icon";
    ".txt"  = "text/plain; charset=utf-8"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $rawPath = $request.Url.LocalPath
        if ($rawPath -eq "/" -or $rawPath -eq "") {
            $rawPath = "/index.html"
        }

        # Clean relative file path
        $cleanPath = $rawPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $filePath = Join-Path $rootPath $cleanPath

        if (Test-Path $filePath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
            $contentType = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            
            $response.ContentType = $contentType
            $response.AddHeader("Access-Control-Allow-Origin", "*")
            $response.AddHeader("Cache-Control", "no-cache, no-store, must-revalidate")

            $bytes = [System.IO.File]::ReadAllBytes($filePath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.StatusCode = 200
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }

        $response.OutputStream.Close()
    } catch {
        # Handle client connection aborts or listener shutdown gracefully
    }
}

