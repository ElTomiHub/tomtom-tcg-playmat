param(
  [int]$Port = 8765
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$LimitlessBase = 'https://limitlesstcg.com'
$HtmlCache = @{}

function Get-PageHtml([string]$Uri) {
  if ($HtmlCache.ContainsKey($Uri)) { return $HtmlCache[$Uri] }
  $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 20 -Uri $Uri -Headers @{
    'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36'
    'Accept' = 'text/html,application/xhtml+xml'
  }
  $HtmlCache[$Uri] = [string]$response.Content
  return $HtmlCache[$Uri]
}

function Get-Text([string]$Markup) {
  $value = [regex]::Replace($Markup, '(?is)<span[^>]*class="[^"]*copy-only[^"]*"[^>]*>.*?</span>', '')
  $value = [regex]::Replace($value, '(?is)<span[^>]*data-tooltip="(?<name>[^"]+)"[^>]*>.*?</span>', [System.Text.RegularExpressions.MatchEvaluator]{ param($match) $match.Groups['name'].Value })
  $value = [regex]::Replace($value, '(?i)<br\s*/?>', ' ')
  $value = [regex]::Replace($value, '(?is)<[^>]+>', ' ')
  $value = [System.Net.WebUtility]::HtmlDecode($value)
  $value = $value -replace '[\[\]]', ''
  return ([regex]::Replace($value, '\s+', ' ')).Trim()
}

function Get-ClassBlock([string]$Markup, [string]$ClassName) {
  $escaped = [regex]::Escape($ClassName)
  return [regex]::Match($Markup, "(?is)<([a-z0-9]+)[^>]*class=""[^""]*\b$escaped\b[^""]*""[^>]*>(?<body>.*?)</\1>")
}

function Get-Cost([string]$Markup) {
  $symbols = [System.Collections.Generic.List[string]]::new()
  $symbolMatches = [regex]::Matches($Markup, '(?is)<span[^>]*class="[^"]*ptcg-symbol[^"]*"[^>]*>(.*?)</span>')
  $map = @{ C = 'Colorless'; W = 'Water'; L = 'Lightning'; R = 'Fire'; G = 'Grass'; P = 'Psychic'; F = 'Fighting'; D = 'Darkness'; M = 'Metal'; Y = 'Fairy' }
  foreach ($match in $symbolMatches) {
    $raw = Get-Text $match.Groups[1].Value
    foreach ($letter in $raw.ToUpperInvariant().ToCharArray()) {
      $key = [string]$letter
      if ($map.ContainsKey($key)) { $symbols.Add($map[$key]) }
    }
  }
  return $symbols.ToArray()
}

function Get-CardDetailsForLanguage([string]$SetCode, [string]$Number, [string]$Language) {
  $set = $SetCode.Trim().ToUpperInvariant()
  $num = $Number.Trim().ToUpperInvariant()
  if ($set -notmatch '^[A-Z0-9.]{2,10}$' -or $num -notmatch '^[A-Z0-9]+$') { throw 'The set code or collector number has an unsupported format.' }
  # Card detail pages use the locale segment; omitting /en can resolve to a
  # non-card route and return a page that looks like an unrecognized print.
  $japanese = $Language -eq 'ja'
  $routeSet = if ($japanese -and $set -cmatch '^(?:SV|M|S)\d+A$') { $set -creplace 'A$', 'a' } else { $set }
  $route = "$routeSet/$num"
  $pageUrl = if ($japanese) { "$LimitlessBase/cards/jp/${route}?translate=en" } else { "$LimitlessBase/cards/en/$route" }
  $html = Get-PageHtml $pageUrl
  $textBlock = [regex]::Match($html, '(?is)<div class="card-text">(?<body>.*?)<div class="card-legality">')
  if (-not $textBlock.Success) { throw "Limitless did not return card text for $route." }
  $cardText = $textBlock.Groups['body'].Value

  $titleBlock = Get-ClassBlock $cardText 'card-text-title'
  $titleText = Get-Text $titleBlock.Groups['body'].Value
  $nameBlock = Get-ClassBlock $cardText 'card-text-name'
  $name = Get-Text $nameBlock.Groups['body'].Value
  if (-not $name) { $name = ($titleText -split '\s+-\s+')[0].Trim() }
  if (-not $name) { throw "Limitless could not read the card name for $route." }

  $typeBlock = Get-ClassBlock $cardText 'card-text-type'
  $typeText = Get-Text $typeBlock.Groups['body'].Value
  $plainCardText = Get-Text $cardText
  $category = 'Unknown'
  if ($typeText -match '^Pok[eé]mon') { $category = 'Pokemon' }
  elseif ($typeText -match '^Trainer') { $category = 'Trainer' }
  elseif ($typeText -match '^Energy') { $category = 'Energy' }
  if ($category -eq 'Unknown') {
    if ($plainCardText -match '(?i)Pok[eé]mon\s*-\s*(?:Basic|Stage\s+[12])') { $category = 'Pokemon'; $typeText = $Matches[0] }
    elseif ($plainCardText -match '(?i)Trainer\s*-\s*(?:Item|Supporter|Pok[eé]mon Tool|Tool|Stadium)') { $category = 'Trainer'; $typeText = $Matches[0] }
    elseif ($plainCardText -match '(?i)(?:Basic|Special) Energy') { $category = 'Energy'; $typeText = $Matches[0] }
  }
  $trainerType = ''
  if ($category -eq 'Trainer' -and $typeText -match 'Trainer\s*-\s*(Item|Supporter|Pok[eé]mon Tool|Tool|Stadium)') { $trainerType = $Matches[1] }

  $stage = ''
  $evolveFrom = ''
  if ($category -eq 'Pokemon') {
    if ($typeText -match '\b(Basic|Stage\s+[12])\b') { $stage = [regex]::Replace($Matches[1], '\s+', ' ').Trim() }
    if ($typeText -match 'Evolves from\s+(.+?)\s*$') { $evolveFrom = $Matches[1].Trim() }
  }
  $hp = ''
  $types = @()
  if ($titleText -match '(?i)-\s*((?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)(?:\s*,\s*(?:Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless))*)\s*-\s*(\d+)\s*HP') {
    $types = @($Matches[1] -split '\s*,\s*')
    $hp = $Matches[2]
  }
  $energyType = ''
  if ($category -eq 'Energy') {
    if ($name -match '^(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Colorless) Energy$') { $energyType = $Matches[1] }
    elseif ($typeText -match 'Energy\s*-\s*(Basic|Special)') { $energyType = $Matches[1] }
    elseif ($typeText -match '(?i)(Basic|Special)\s+Energy') { $energyType = $Matches[1] }
  }

  $attacks = @()
  foreach ($attackMatch in [regex]::Matches($cardText, '(?is)<div class="card-text-attack">(?<body>.*?)</div>')) {
    $attackHtml = $attackMatch.Groups['body'].Value
    $infoBlock = Get-ClassBlock $attackHtml 'card-text-attack-info'
    $infoHtml = $infoBlock.Groups['body'].Value
    $infoText = Get-Text $infoHtml
    $damage = ''
    if ($infoText -match '(\d+(?:×|x|\+)?)\s*$') { $damage = $Matches[1] }
    $labelHtml = [regex]::Replace($infoHtml, '(?is)<span[^>]*class="[^"]*ptcg-symbol[^"]*"[^>]*>.*?</span>', ' ')
    $label = Get-Text $labelHtml
    if ($damage) { $label = [regex]::Replace($label, '\s*' + [regex]::Escape($damage) + '\s*$', '').Trim() }
    $effectBlock = Get-ClassBlock $attackHtml 'card-text-attack-effect'
    $effect = Get-Text $effectBlock.Groups['body'].Value
    if ($label) { $attacks += [pscustomobject]@{ name = $label; cost = @(Get-Cost $infoHtml); damage = $damage; effect = $effect } }
  }

  $abilities = @()
  foreach ($abilityMatch in [regex]::Matches($cardText, '(?is)<div class="card-text-ability">(?<body>.*?)</div>')) {
    $abilityHtml = $abilityMatch.Groups['body'].Value
    $infoBlock = Get-ClassBlock $abilityHtml 'card-text-ability-info'
    $abilityName = (Get-Text $infoBlock.Groups['body'].Value) -replace '(?i)^Ability:\s*', ''
    $effectBlock = Get-ClassBlock $abilityHtml 'card-text-ability-effect'
    $effect = Get-Text $effectBlock.Groups['body'].Value
    if ($abilityName) { $abilities += [pscustomobject]@{ name = $abilityName; type = 'Ability'; effect = $effect } }
  }

  $rules = @()
  $genericText = [regex]::Replace($cardText, '(?is)<div class="card-text-section">\s*<p class="card-text-title">.*?</div>', '')
  $genericText = [regex]::Replace($genericText, '(?is)<div class="card-text-(?:attack|ability)">.*?</div>', '')
  $genericText = [regex]::Replace($genericText, '(?is)<div class="card-text-section card-text-artist">.*?</div>', '')
  foreach ($sectionMatch in [regex]::Matches($genericText, '(?is)<div class="card-text-section(?:\s+[^\"]*)?">(?<body>.*?)</div>')) {
    $rule = Get-Text $sectionMatch.Groups['body'].Value
    if ($rule -and $rule -notmatch '(?i)^(Weakness:|Resistance:|Retreat:)') { $rules += $rule }
  }
  $effect = ''
  if ($category -eq 'Trainer' -or $category -eq 'Energy') { $effect = $rules -join ' ' ; $rules = @() }

  $retreat = $null
  $weaknesses = @()
  $resistances = @()
  $wrrBlock = Get-ClassBlock $cardText 'card-text-wrr'
  $wrr = Get-Text $wrrBlock.Groups['body'].Value
  if ($wrr -match '(?i)Retreat:\s*(\d+)') { $retreat = [int]$Matches[1] }
  foreach ($kind in @('Weakness', 'Resistance')) {
    $pattern = "(?i)${kind}:\s*(.*?)(?:Resistance:|Retreat:|$)"
    $part = [regex]::Match($wrr, $pattern)
    if ($part.Success -and $part.Groups[1].Value -notmatch '^none') {
      if ($part.Groups[1].Value -match '(Grass|Fire|Water|Lightning|Psychic|Fighting|Darkness|Metal|Fairy|Dragon|Colorless)\s*(?:×|x)?\s*(\d+)?') {
        $value = $Matches[2]
        if (-not $value) { $value = if ($kind -eq 'Weakness') { '×2' } else { '-30' } }
        elseif ($kind -eq 'Weakness') { $value = "×$value" }
        else { $value = "-$value" }
        $entry = [pscustomobject]@{ type = $Matches[1]; value = $value }
        if ($kind -eq 'Weakness') { $weaknesses += $entry } else { $resistances += $entry }
      }
    }
  }

  $imageMatch = [regex]::Match($html, '(?is)<img[^>]*class="[^"]*card shadow[^\"]*"[^>]*data-src="(?<image>[^"]+)"')
  if (-not $imageMatch.Success) { $imageMatch = [regex]::Match($html, '(?is)<img[^>]*class="[^"]*card shadow[^\"]*"[^>]*src="(?<image>[^"]+)"') }
  if (-not $imageMatch.Success) { $imageMatch = [regex]::Match($html, '(?is)(?:data-src|src)="(?<image>https://limitlesstcg\.nyc3\.cdn\.digitaloceanspaces\.com/[^" ]+\.png)"') }
  $image = if ($imageMatch.Success) { [System.Net.WebUtility]::HtmlDecode($imageMatch.Groups['image'].Value) } else { '' }
  if (-not $japanese -and $image -match '\.png$') { $image = $image -replace '\.png$', '_SM.png' }

  if ($japanese -and (($name + $evolveFrom + $effect + ($rules | ConvertTo-Json) + ($attacks | ConvertTo-Json -Depth 5) + ($abilities | ConvertTo-Json -Depth 5)) -match '[\u3040-\u30ff\u3400-\u9fff]')) {
    throw "Limitless has not supplied a complete English translation for Japanese print $route."
  }
  return [pscustomobject]@{
    source = 'Limitless'; id = $route; limitlessId = $route; name = $name; setCode = $set; cardNumber = $num
    category = $category; stage = $stage; evolveFrom = $evolveFrom; trainerType = $trainerType; energyType = $energyType
    hp = $hp; types = @($types); retreat = $retreat; weaknesses = @($weaknesses); resistances = @($resistances)
    image = $image; effect = $effect; rules = @($rules); attacks = @($attacks); abilities = @($abilities)
    language = $(if ($japanese) { 'ja' } else { 'en' }); textLanguage = 'en'; sourceUrl = $pageUrl
    translationSource = $(if ($japanese) { 'Limitless' } else { '' }); translationStatus = $(if ($japanese) { 'unofficial' } else { '' })
  }
}

function Get-CardDetails([string]$SetCode, [string]$Number, [string]$Language = 'en') {
  if ($Language -in @('ja','jp')) { return Get-CardDetailsForLanguage $SetCode $Number 'ja' }
  try { return Get-CardDetailsForLanguage $SetCode $Number 'en' }
  catch {
    $englishError = $_.Exception.Message
    try { return Get-CardDetailsForLanguage $SetCode $Number 'ja' }
    catch { throw "$englishError Japanese translation fallback: $($_.Exception.Message)" }
  }
}

function Write-BytesResponse($Context, [int]$Status, [string]$ContentType, [byte[]]$Bytes) {
  $statusText = switch ($Status) { 200 { 'OK' } 204 { 'No Content' } 404 { 'Not Found' } 502 { 'Bad Gateway' } default { 'Error' } }
  $headers = @(
    "HTTP/1.1 $Status $statusText",
    "Content-Type: $ContentType",
    "Content-Length: $($Bytes.Length)",
    'Access-Control-Allow-Origin: *',
    'Access-Control-Allow-Methods: GET, OPTIONS',
    'Access-Control-Allow-Headers: Accept, Content-Type',
    'Access-Control-Allow-Private-Network: true',
    'Cache-Control: no-store',
    'Connection: close',
    '', ''
  ) -join "`r`n"
  $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
  $Context.Stream.Write($headerBytes, 0, $headerBytes.Length)
  if ($Bytes.Length) { $Context.Stream.Write($Bytes, 0, $Bytes.Length) }
  $Context.Stream.Flush()
  $Context.Client.Close()
}

function Write-Response($Context, [int]$Status, [string]$ContentType, [string]$Body) {
  Write-BytesResponse $Context $Status $ContentType ([System.Text.Encoding]::UTF8.GetBytes($Body))
}

function Handle-Request($Context) {
  $path = $Context.Url.AbsolutePath
  if ($Context.HttpMethod -eq 'OPTIONS') { Write-Response $Context 204 'text/plain; charset=utf-8' ''; return }
  try {
    if ($path -eq '/api/limitless/card') {
      $details = Get-CardDetails $Context.Query['set'] $Context.Query['number'] $Context.Query['language']
      Write-Response $Context 200 'application/json; charset=utf-8' (ConvertTo-Json -InputObject $details -Depth 8 -Compress)
      return
    }
    if ($path -eq '/api/limitless/search') {
      $query = [string]$Context.Query['q']
      if (-not $query.Trim()) { throw 'Enter a card name to search.' }
      $searchHtml = Get-PageHtml "$LimitlessBase/cards?q=$([uri]::EscapeDataString($query))"
      $routes = [System.Collections.Generic.List[string]]::new()
      foreach ($match in [regex]::Matches($searchHtml, '(?i)href="/cards/(?:en/)?(?<set>[A-Z0-9.]+)/(?<number>[A-Z0-9]+)"')) {
        $route = "$($match.Groups['set'].Value.ToUpperInvariant())/$($match.Groups['number'].Value.ToUpperInvariant())"
        if (-not $routes.Contains($route)) { $routes.Add($route) }
        if ($routes.Count -ge 16) { break }
      }
      $details = @()
      foreach ($route in $routes) {
        $parts = $route.Split('/')
        try { $details += Get-CardDetails $parts[0] $parts[1] } catch { }
      }
      Write-Response $Context 200 'application/json; charset=utf-8' (ConvertTo-Json -InputObject @($details) -Depth 8 -Compress)
      return
    }
    $anniversaryEnergyAsset = $path -cmatch '^/assets/energy-30th/(grass|fire|water|lightning|psychic|fighting|darkness|metal).webp$'
    if ($anniversaryEnergyAsset -or $path -in @('/', '/index.html', '/logo.png', '/README.md')) {
      $fileName = if ($path -eq '/') { 'index.html' } else { $path.TrimStart('/') }
      $filePath = Join-Path $ProjectRoot $fileName
      if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) { throw 'The requested app file was not found.' }
      $bytes = [System.IO.File]::ReadAllBytes($filePath)
      $type = switch ([System.IO.Path]::GetExtension($filePath).ToLowerInvariant()) { '.html' { 'text/html; charset=utf-8' } '.png' { 'image/png' } '.webp' { 'image/webp' } '.md' { 'text/plain; charset=utf-8' } default { 'application/octet-stream' } }
      Write-BytesResponse $Context 200 $type $bytes
      return
    }
    Write-Response $Context 404 'application/json; charset=utf-8' '{"error":"Not found."}'
  } catch {
    $message = [System.Net.WebUtility]::HtmlEncode($_.Exception.Message)
    Write-Response $Context 502 'application/json; charset=utf-8' (ConvertTo-Json -InputObject @{ error = [System.Net.WebUtility]::HtmlDecode($message) } -Compress)
  }
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try {
  $listener.Start()
} catch {
  Write-Error "Could not start the local Pokémon TCG server on port $Port. Close another copy using this port, then retry. $($_.Exception.Message)"
  return
}

$appUrl = "http://127.0.0.1:$Port/"
$appFile = Join-Path $ProjectRoot 'index.html'
Write-Host "Pokémon TCG Playmat is opening from its local file. The card lookup bridge is bound to $appUrl"
Write-Host 'Keep this window open while using Limitless lookup; press Ctrl+C to stop the bridge.'
Start-Process $appFile
try {
  while ($true) {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    try {
      $reader = [System.IO.StreamReader]::new($stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $requestLine = $reader.ReadLine()
      if (-not $requestLine) { $client.Close(); continue }
      while ($null -ne ($header = $reader.ReadLine()) -and $header.Length -gt 0) { }
      $parts = $requestLine.Split(' ')
      if ($parts.Length -lt 2) { $client.Close(); continue }
      $uri = [uri]::new("http://127.0.0.1:$Port$($parts[1])")
      $query = @{}
      foreach ($pair in $uri.Query.TrimStart('?').Split('&')) {
        if (-not $pair) { continue }
        $pieces = $pair.Split('=', 2)
        $key = [uri]::UnescapeDataString($pieces[0].Replace('+', ' '))
        $value = if ($pieces.Length -gt 1) { [uri]::UnescapeDataString($pieces[1].Replace('+', ' ')) } else { '' }
        $query[$key] = $value
      }
      $context = [pscustomobject]@{ Client = $client; Stream = $stream; HttpMethod = $parts[0]; Url = $uri; Query = $query }
      Handle-Request $context
    } catch {
      if (-not $client.Connected) { continue }
      try { Write-Response ([pscustomobject]@{ Client = $client; Stream = $stream }) 502 'application/json; charset=utf-8' '{"error":"Could not read the local request."}' } catch { $client.Close() }
    }
  }
} finally {
  $listener.Stop()
}
