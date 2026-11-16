$ErrorActionPreference = 'Stop'
$bridge = Join-Path $PSScriptRoot '..\LimitlessBridge.ps1'
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($bridge, [ref]$null, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
# Load function definitions only: no listener, browser launch, or network.
foreach ($definition in $ast.FindAll({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  Invoke-Expression $definition.Extent.Text
}
$LimitlessBase = 'https://limitlesstcg.com'
$script:requests = [System.Collections.Generic.List[string]]::new()
$script:failEnglish = $false
$script:failAll = $false
$script:page = @'
<div class="card-text">
<div class="card-text-section"><p class="card-text-title"><span class="card-text-name">Tornadus</span> - Colorless - 110 HP</p><p class="card-text-type">Pokemon - Basic</p></div>
<div class="card-text-ability"><p class="card-text-ability-info">Ability: Incarnate Union</p><p class="card-text-ability-effect">If you have Tornadus, Thundurus, Landorus, and Enamorus in play, ignore all <span class="ptcg-symbol">C</span> Energy in the costs of attacks used by this Pokemon.</p></div>
<div class="card-text-attack"><p class="card-text-attack-info"><span class="ptcg-symbol">CCC</span> Corkscrew Dive 70</p><p class="card-text-attack-effect">You may draw cards until you have 6 cards in your hand.</p></div>
<div class="card-text-wrr">Weakness: Lightning x2 Resistance: Fighting 30 Retreat: 1</div>
<div class="card-legality"></div></div>
<img class="card shadow" data-src="https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/M6/M6_59_R_JP.png">
'@
function Get-PageHtml([string]$Uri) {
  $script:requests.Add($Uri)
  if ($script:failAll -or ($script:failEnglish -and $Uri -match '/en/')) { throw 'Test lookup unavailable' }
  return $script:page
}
$results = [System.Collections.Generic.List[object]]::new()
function Assert-Test([string]$Name, [bool]$Passed) {
  if (-not $Passed) { throw "Failed: $Name" }
  $results.Add([pscustomobject]@{ name = $Name; passed = $Passed })
}
$detail = Get-CardDetails 'M6' '59' 'ja'
Assert-Test 'explicit Japanese route requests the English translation' ($script:requests.Count -eq 1 -and $script:requests[0] -eq 'https://limitlesstcg.com/cards/jp/M6/59?translate=en')
Assert-Test 'Japanese identity and translation provenance remain separate' ($detail.language -eq 'ja' -and $detail.textLanguage -eq 'en' -and $detail.translationSource -eq 'Limitless' -and $detail.translationStatus -eq 'unofficial')
Assert-Test 'original Japanese artwork is preserved' ($detail.image -eq 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc/M6/M6_59_R_JP.png')
Assert-Test 'translated stats, ability, cost, damage and effect are parsed' ($detail.hp -eq 110 -and $detail.stage -eq 'Basic' -and $detail.types[0] -eq 'Colorless' -and $detail.retreat -eq 1 -and $detail.weaknesses[0].type -eq 'Lightning' -and $detail.resistances[0].type -eq 'Fighting' -and $detail.abilities[0].name -eq 'Incarnate Union' -and $detail.attacks[0].cost.Count -eq 3 -and $detail.attacks[0].damage -eq 70 -and $detail.attacks[0].effect -match '6 cards')
$script:requests.Clear(); $script:failEnglish = $true
$detail = Get-CardDetails 'M6' '59'
Assert-Test 'unavailable English print falls back to translated Japanese print' ($script:requests.Count -eq 2 -and $script:requests[0] -match '/en/M6/59$' -and $script:requests[1] -match '/jp/M6/59\?translate=en$' -and $detail.language -eq 'ja')
$script:requests.Clear(); $script:failEnglish = $false
$detail = Get-CardDetails 'OBF' '1'
Assert-Test 'available English print does not invoke Japanese fallback' ($script:requests.Count -eq 1 -and $detail.language -eq 'en' -and $detail.translationSource -eq '')
$originalPage = $script:page
foreach ($part in @('name','attack','ability','rule','trainer')) {
  $japaneseText = [string][char]0x65E5 + [char]0x672C
  $script:page = switch ($part) {
    name { $originalPage.Replace('>Tornadus<',">$japaneseText<") }
    attack { $originalPage.Replace('You may draw cards',"$japaneseText draw cards") }
    ability { $originalPage.Replace('If you have Tornadus',"$japaneseText have Tornadus") }
    rule { $originalPage.Replace('<div class="card-legality">',"<div class=`"card-text-section`">$japaneseText</div><div class=`"card-legality`">") }
    trainer { $originalPage.Replace('Pokemon - Basic','Trainer - Item').Replace('<div class="card-legality">',"<div class=`"card-text-section`">$japaneseText</div><div class=`"card-legality`">") }
  }
  $rejected = $false
  try { $null = Get-CardDetails 'M6' '59' 'ja' } catch { $rejected = $_.Exception.Message -match 'complete English translation' }
  Assert-Test "untranslated $part text is rejected" $rejected
}
$script:page = $originalPage; $script:failAll = $true
$rejected = $false
try { $null = Get-CardDetails 'M6' '59' } catch { $rejected = $_.Exception.Message -match 'Japanese translation fallback' }
Assert-Test 'both lookup failures remain a failure' $rejected
$script:requests.Clear(); $script:failAll = $false
$rejected = $false
try { $null = Get-CardDetails '../invalid' '59' 'ja' } catch { $rejected = $true }
Assert-Test 'invalid print input is rejected before a request' ($rejected -and $script:requests.Count -eq 0)
ConvertTo-Json -InputObject $results.ToArray() -Depth 8 -Compress
