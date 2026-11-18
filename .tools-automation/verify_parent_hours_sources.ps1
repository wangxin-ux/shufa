param(
    [string]$Project = 'F:\学习项目组\小程序开发1\frontend',
    [ValidateSet(375, 390, 430)][int]$ExpectedWidth = 390,
    [ValidatePattern('^runtime-(375|390|430)-v\d+$')][string]$EvidenceName = 'runtime-390-v1'
)

$ErrorActionPreference = 'Stop'
if ($EvidenceName -notmatch "^runtime-$ExpectedWidth-v\d+$") { throw 'Capture name must match width' }
$Root = Split-Path -Parent $Project
$Evidence = Join-Path $Root "docs\verification\parent-hours-source-2026-10-12\$EvidenceName"
if (Test-Path -LiteralPath $Evidence) { throw "Preserve existing evidence: $Evidence" }
[void][System.IO.Directory]::CreateDirectory($Evidence)
$Events = [System.Collections.Generic.List[object]]::new()
$Failure = $null
$BaselineInstalled = $false
$BaselineAttempted = $false
$RunOwner = [Guid]::NewGuid().ToString('N')
$LastToolErrorCode = $null
$Inputs = @(
    'frontend/app.wxss',
    'frontend/pages/parent/hours/index.ts',
    'frontend/pages/parent/hours/index.wxml',
    'frontend/pages/parent/hours/index.wxss',
    'frontend/pages/parent/styles/pdf-typography.wxss',
    'frontend/styles/parent-pdf.wxss',
    'frontend/styles/tokens.wxss',
    'frontend/components/parent-page-shell/parent-page-shell.ts',
    'frontend/components/parent-page-shell/parent-page-shell.wxml',
    'frontend/components/parent-page-shell/parent-page-shell.wxss',
    'frontend/components/parent-page-mark/parent-page-mark.ts',
    'frontend/components/parent-page-mark/parent-page-mark.wxml',
    'frontend/components/parent-page-mark/parent-page-mark.wxss',
    'frontend/components/parent-primary-button/parent-primary-button.ts',
    'frontend/components/parent-primary-button/parent-primary-button.wxml',
    'frontend/components/parent-primary-button/parent-primary-button.wxss',
    'frontend/components/parent-record-card/parent-record-card.ts',
    'frontend/components/parent-record-card/parent-record-card.wxml',
    'frontend/components/parent-record-card/parent-record-card.wxss',
    'frontend/services/parent-hours.presenter.ts',
    'frontend/services/parent-runtime.ts',
    'frontend/pages/parent/runtime/parent-pdf-font.ts',
    'frontend/pages/parent/assets/fonts/pdf-display-font.ts',
    'frontend/pages/parent/assets/fonts/pdf-display-subset.woff',
    'frontend/pages/parent/assets/hours-mascot.png',
    'frontend/pages/parent/assets/hours-ledger-mascot.png',
    'frontend/pages/parent/assets/icon-mark-hours.png',
    '.tools-automation/verify_parent_hours_sources.ps1'
) | ForEach-Object {
    @{ path = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $Root $_) -Algorithm SHA256).Hash }
}
$ReportStream = [System.IO.File]::Open(
    (Join-Path $Evidence 'runtime.json'), [System.IO.FileMode]::CreateNew,
    [System.IO.FileAccess]::Write, [System.IO.FileShare]::Read
)

function Save-Report {
    $Json = [ordered]@{
        expectedWidth = $ExpectedWidth
        scope = 'Read-only original Mock P3 source mapping; no fixture, runtime storage or business writes'
        inputs = $Inputs
        events = $Events.ToArray()
        failure = $Failure
    } | ConvertTo-Json -Depth 30
    $Bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Json)
    $ReportStream.Position = 0
    $ReportStream.Write($Bytes, 0, $Bytes.Length)
    $ReportStream.SetLength($Bytes.Length)
    $ReportStream.Flush()
}

function Invoke-Ide {
    param([string]$Label, [string[]]$Arguments)
    $script:LastToolErrorCode = $null
    $Output = (& wechatide -c Codex @Arguments 2>&1 | Out-String)
    $Start = $Output.IndexOf('{')
    if ($Start -lt 0) {
        $Events.Add(@{ label = $Label; failure = $Output })
        Save-Report
        throw 'No JSON result from official tool'
    }
    $Value = $Output.Substring($Start) | ConvertFrom-Json
    $Events.Add(@{ label = $Label; tool = $Arguments[0]; response = $Value })
    Save-Report
    if (!$Value.ok -or $Value.result.success -eq $false) {
        $script:LastToolErrorCode = $Value.code
        throw $Output
    }
    return $Value.result
}

function Evaluate {
    param([string]$Label, [string]$Source)
    $Source = $Source.Replace("`r", '').Replace("`n", ' ')
    return (Invoke-Ide $Label @(
        'automation_evaluate', '--project', $Project, '--fn-source', $Source
    )).result.result
}

function Capture {
    param([string]$Name, [string]$Route)
    $Nodes = Evaluate "nodes:$Name" @'
function(){
    var pages=getCurrentPages(),p=pages[pages.length-1];
    if(!p)throw Error('Missing page');
    var selectors=['.hours','.hours__title','.balance-card','.balance-card__label',
        '.balance-card__value-row','.balance-card__value','.balance-card__unit',
        '.balance-card__meta','.balance-card__meta-label','.balance-card__meta-value',
        '.balance-card__mascot-frame','.balance-card__mascot','.balance-card__renew',
        '.balance-card__renew >>> .primary-btn','.balance-card__renew >>> .primary-btn__line',
        '.hour-cards','.hour-card','.hour-card__label','.hour-card__value-row',
        '.hour-card__value','.hour-card__unit','.hour-card__sub','.hour-cards__plus',
        '.ledger','.ledger__title','.ledger__filter-toggle','.ledger__card','.ledger__panel',
        '.ledger__mascot','.ledger__divider','.ledger__panel >>> .record-card',
        '.ledger__panel >>> .record-card__dot','.ledger__panel >>> .record-card__title',
        '.ledger__panel >>> .record-card__subtitle','.ledger__panel >>> .record-card__tag',
        '.hours-shell >>> .page-mark__circle','.hours-shell >>> .page-mark__icon',
        '.hours-shell >>> .page-mark__title'];
    return new Promise(function(resolve,reject){
        var q=wx.createSelectorQuery();
        selectors.forEach(function(s){
            q.selectAll(s).fields({rect:true,size:true,computedStyle:
                ['font-family','font-size','font-weight','line-height','opacity','color',
                 'background-color','border-radius','box-shadow','overflow']});
        });
        q.selectViewport().fields({scrollOffset:true,size:true});
        q.exec(function(nodes){
            if(p.route==='pages/parent/hours/index'){
                var counts=[1,1,1,1,1,1,1,1,2,2,1,1,1,1,2,1,2,2,2,2,2,2,1,1,1,1,1,1,1,2,3,3,3,3,3,1,1,1];
                if(nodes.length!==selectors.length+1||
                    counts.some(function(count,i){return !Array.isArray(nodes[i])||nodes[i].length!==count||
                        nodes[i].some(function(n){return ![n.left,n.top,n.width,n.height].every(Number.isFinite)||
                            n.width<=0||n.height<=0;});}))
                    return reject(Error('Invalid native nodes'));
            }
            resolve({route:p.route,viewState:p.data.viewState,
            balance:p.data.remainingTotal,cards:p.data.hourCards,paidAmount:p.data.paidAmountLabel,
            validUntil:p.data.validUntilLabel,entries:p.data.entries,
            window:wx.getWindowInfo(),selectors:selectors,nodes:nodes});});
    });
}
'@
    if ($Nodes.route -ne $Route -or $Nodes.viewState -ne 'ready') { throw "Unexpected route/state: $Name" }
    if ($Route -eq 'pages/parent/hours/index' -and
        ($Nodes.cards.Count -ne 2 -or $Nodes.entries.Count -ne 3)) { throw 'Expected original standard Mock P3' }
    $Image = Join-Path $Evidence "$Name.png"
    if (Test-Path -LiteralPath $Image) { throw 'Preserve existing screenshot' }
    [void](Invoke-Ide "screenshot:$Name" @(
        'simulator_screenshot', '--project', $Project, '--path', $Image,
        '--optimize', 'false', '--wait', '0.5'
    ))
    Write-Output "Captured $Name"
}

try {
    $BaselineAttempted = $true
    [void](Evaluate 'original-home-baseline' @"
function(){
    var a=getApp(),pages=getCurrentPages(),p=pages[pages.length-1];
    var r=wx.getStorageSync('education.runtime')||{};
    var window=wx.getWindowInfo(),appid=wx.getAccountInfoSync().miniProgram.appId;
    if(Object.keys(a).some(function(k){return /Verification/.test(k);}))
        throw Error('Existing verification marker');
    if(!p||r.dataDriver!=='mock'||p.route!=='pages/parent/home/index'||
        p.data.viewState!=='ready'||p.data.menuExpanded||p.data.activeSheet||
        !p.visible||p.disposed||p.refreshTimer===null)throw Error('Expected original ready collapsed Mock home');
    if(window.windowWidth!==$ExpectedWidth)throw Error('Unexpected width');
    a.__hoursSourceVerification={owner:'$RunOwner',runtime:JSON.stringify(r),home:JSON.stringify(p.data),
        homePage:p,pageCount:pages.length,
        readHours:require('services/parent-runtime.js').parentService.loadHoursView};
    return {route:p.route,viewState:p.data.viewState,driver:r.dataDriver,
        window:window,appid:appid,owner:'$RunOwner'};
}
"@)
    $BaselineInstalled = $true
    [void](Invoke-Ide 'navigate-hours' @(
        'automation_navigate', '--project', $Project, '--action', 'navigateTo',
        '--url', '/pages/parent/hours/index'
    ))
    [void](Evaluate 'load-original-hours-and-font' @"
function(){
    var p=getCurrentPages().slice(-1)[0],b=getApp().__hoursSourceVerification;
    if(!b||b.owner!=='$RunOwner')throw Error('Foreign source baseline; preserve');
    if(!p||p.route!=='pages/parent/hours/index'||p.disposed)throw Error('Unexpected hours page');
    return require('pages/parent/runtime/parent-pdf-font.js').loadParentPdfDisplayFont()
        .then(function(loaded){
            if(!loaded)throw Error('Private font did not load');
            return p.loadHours();
        }).then(function(){
            if(p.data.viewState!=='ready'||p.data.remainingTotal!==37||
                p.data.hourCards.length!==2||p.data.hourCards[0].grantedLabel!=='48'||
                p.data.hourCards[1].grantedLabel!=='12')throw Error('Expected original visual Mock facts');
            return {route:p.route,fontLoaded:true,balance:p.data.remainingTotal};
        });
}
"@)
    [void](Invoke-Ide 'scroll-top' @(
        'automation_viewport_action', '--project', $Project,
        '--action', 'pageScrollTo', '--scroll-top', '0'
    ))
    Capture 'standard-top' 'pages/parent/hours/index'
    [void](Invoke-Ide 'scroll-bottom' @(
        'automation_viewport_action', '--project', $Project,
        '--action', 'pageScrollTo', '--scroll-top', '10000'
    ))
    Capture 'standard-bottom' 'pages/parent/hours/index'
} catch {
    $Failure = $_.Exception.Message
    if (!$BaselineInstalled -and $LastToolErrorCode -in @(
        'APPID_ERROR', 'PROJECT_PATH_NOT_FOUND', 'PROJECT_CONFIG_JSON_ERROR'
    )) { $BaselineAttempted = $false }
} finally {
    if ($BaselineAttempted) {
        $HomeRestored = $false
        $OwnBaselineDetected = $false
        try {
            $Ownership = Evaluate 'restoration-owned-baseline' @"
function(){
    var b=getApp().__hoursSourceVerification;
    if(!b)return {ownedBaseline:false};
    if(b.owner!=='$RunOwner')throw Error('Foreign source baseline; preserve');
    return {ownedBaseline:true,owner:b.owner};
}
"@
            $OwnBaselineDetected = $Ownership.ownedBaseline
            if ($BaselineInstalled -and !$OwnBaselineDetected) { throw 'Owned baseline disappeared; preserve current state' }
        } catch {
            $Failure = "$Failure`nBaseline ownership: $($_.Exception.Message)"
        }
        if ($OwnBaselineDetected) {
            try {
                $Navigation = Evaluate 'restoration-navigation-state' @"
function(){
    var b=getApp().__hoursSourceVerification,pages=getCurrentPages(),p=pages[pages.length-1];
    if(!b)throw Error('Missing source baseline');
    if(b.owner!=='$RunOwner')throw Error('Foreign source baseline; preserve');
    if(p===b.homePage&&pages.length===b.pageCount)return {needsBack:false};
    if(p&&p.route==='pages/parent/hours/index'&&pages.length===b.pageCount+1&&
        pages[pages.length-2]===b.homePage)return {needsBack:true};
    throw Error('Unexpected stack; preserve current navigation');
}
"@
                if ($Navigation.needsBack) {
                    [void](Invoke-Ide 'return-original-home' @(
                        'automation_navigate', '--project', $Project, '--action', 'navigateBack', '--delta', '1'
                    ))
                }
                [void](Evaluate 'original-home-restored' @"
function(){
    var b=getApp().__hoursSourceVerification,pages=getCurrentPages(),p=pages[pages.length-1];
    if(b&&b.owner!=='$RunOwner')throw Error('Foreign source baseline; preserve');
    if(!b||p!==b.homePage||pages.length!==b.pageCount||p.route!=='pages/parent/home/index'||
        p.data.viewState!=='ready'||!p.visible||p.disposed||p.refreshTimer===null)
        throw Error('Original home did not resume');
    var sameHome=JSON.stringify(p.data)===b.home;
    var sameRuntime=JSON.stringify(wx.getStorageSync('education.runtime')||{})===b.runtime;
    var sameReader=require('services/parent-runtime.js').parentService.loadHoursView===b.readHours;
    if(!sameHome||!sameRuntime||!sameReader)throw Error('Original home/runtime/reader changed');
    return {sameHome:true,viewState:'ready',timerRunning:true,readerUnchanged:true,runtimeUnchanged:true};
}
"@)
                $HomeRestored = $true
            } catch {
                $Failure = "$Failure`nHome restoration: $($_.Exception.Message)"
            }
            try {
                [void](Evaluate 'verification-marker-removed' @"
function(){
    var a=getApp(),b=a.__hoursSourceVerification;
    if(b&&b.owner!=='$RunOwner')throw Error('Foreign source baseline; preserve');
    delete a.__hoursSourceVerification;
    return {markerRemoved:!a.__hoursSourceVerification,owner:'$RunOwner'};
}
"@)
            } catch {
                $Failure = "$Failure`nMarker restoration: $($_.Exception.Message)"
            }
            if ($HomeRestored) {
                try { Capture 'restored-parent-home' 'pages/parent/home/index' }
                catch { $Failure = "$Failure`nHome screenshot: $($_.Exception.Message)" }
            }
        }
    }
    try { Save-Report } finally { $ReportStream.Dispose() }
}
if ($Failure) { throw $Failure }
