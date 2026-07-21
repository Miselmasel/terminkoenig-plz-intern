# PLZ-Listen Extraktion fuer Terminkoenig-Import
# Liest alle plz_Xxxxx.xlsx aus dem Quellordner und erzeugt import-plz-data.json

param(
    [string]$SourceDir = "T:\Adressen\PLZ-Listen Übersicht",
    [string]$OutFile   = "$PSScriptRoot\import-plz-data.json"
)

$excel = New-Object -ComObject Excel.Application
$excel.Visible        = $false
$excel.DisplayAlerts  = $false
$excel.ScreenUpdating = $false

$contacts    = [System.Collections.Generic.Dictionary[string,object]]::new()
$assignments = [System.Collections.Generic.List[object]]::new()
$skipped     = 0

function Parse-GermanDate($str) {
    if ($str -match '^(\d{2})\.(\d{2})\.(\d{4})$') {
        try { return [datetime]"$($Matches[3])-$($Matches[2])-$($Matches[1])" }
        catch {}
    }
    return [datetime]::MinValue
}

function Parse-Contact($raw) {
    $raw = $raw.Trim()
    $parts = $raw -split '_'
    $typ    = 'bbm'
    $blWert = $null
    foreach ($p in $parts) {
        if ($p -match '^BL(\d+)$') { $typ = 'bl'; $blWert = [int]$Matches[1] }
    }
    # Rohstring als Notiz; Typ/BL-Wert aus Kuerzel
    $info = ($parts | Where-Object { $_ -notmatch '^(BL\d+|BSV|RSV|BSC|BBM|LS|BL\d*)$' }) -join ' '
    return @{ suchbegriff = $raw; typ = $typ; bl_wert = $blWert; info = $info }
}

$files = Get-ChildItem "$SourceDir\plz_*.xlsx" |
         Where-Object { $_.Name -notlike '~$*' } |
         Sort-Object Name

foreach ($file in $files) {
    Write-Host "Datei: $($file.Name)" -ForegroundColor Cyan
    $wb = $excel.Workbooks.Open($file.FullName, $false, $true)  # ReadOnly

    foreach ($ws in $wb.Sheets) {
        Write-Host "  Sheet: $($ws.Name)" -ForegroundColor Gray
        $maxRow = $ws.UsedRange.Rows.Count
        $maxCol = $ws.UsedRange.Columns.Count

        # ── Kopfzeile lesen (Zeile 5) ───────────────────────────────
        $headerRow  = 5
        $plzCol     = 3   # Standardposition
        $firstDatum = 5   # Standardposition erster Datum-Eintrag

        # Erste "Datum"-Spalte dynamisch finden
        for ($c = 4; $c -le [Math]::Min($maxCol, 20); $c++) {
            $h = $ws.Cells.Item($headerRow, $c).Text.Trim()
            if ($h -eq 'Datum') { $firstDatum = $c; break }
        }

        # ── Daten ab Zeile 6 ────────────────────────────────────────
        $currentBlock = ''
        $currentCity  = ''

        for ($r = $headerRow + 1; $r -le $maxRow; $r++) {

            # Block/Stadt-Kontext tracken
            $blockText = $ws.Cells.Item($r, 2).Text.Trim()
            if ($blockText) {
                $currentBlock = $blockText
                # Stadtname: kein reiner PLZ-Bereich (z.B. "01001-01330")
                if ($blockText -notmatch '^\d') {
                    $currentCity = $blockText
                } else {
                    $currentCity = ''
                }
            }

            # ── Farbcheck (Spalte A = Ampel) ────────────────────────
            $ampelCell = $ws.Cells.Item($r, 1)
            # Pattern -4142 = xlPatternNone = keine Fuellfarbe
            if ($ampelCell.Interior.Pattern -eq -4142) { $skipped++; continue }

            # ── PLZ ermitteln ────────────────────────────────────────
            $plzRaw = $ws.Cells.Item($r, $plzCol).Text.Trim()
            if (-not $plzRaw) { continue }

            $plz3 = $null
            $plz5 = $plzRaw

            if ($plzRaw -match '^\d{5}$') {
                $plz3 = $plzRaw.Substring(0, 3)
            } elseif ($plzRaw -match '^(\d{5})-\d{5}') {
                # PLZ-Bereich: erste PLZ als Referenz
                $plz3 = $Matches[1].Substring(0, 3)
                $plz5 = $Matches[1]
            } else {
                # Stadtname in PLZ-Spalte -> Block-Spalte versuchen
                if ($currentBlock -match '^(\d{5})') {
                    $plz3 = $Matches[1].Substring(0, 3)
                    $plz5 = $Matches[1]
                } else {
                    continue  # PLZ nicht bestimmbar
                }
            }

            # Notiz-Prefix mit Stadt falls vorhanden
            $plzLabel = if ($currentCity) { "$plz5 $currentCity" } else { $plz5 }

            # ── Datum/Kunde-Paare sammeln ────────────────────────────
            $pairs = [System.Collections.Generic.List[object]]::new()
            $emptyRun = 0

            $col = $firstDatum
            while ($col + 1 -le $maxCol -and $emptyRun -lt 4) {
                $d = $ws.Cells.Item($r, $col    ).Text.Trim()
                $k = $ws.Cells.Item($r, $col + 1).Text.Trim()

                if ($d -match '\d{2}\.\d{2}\.\d{4}' -and $k) {
                    $pairs.Add(@{ datum = $d; kunde = $k; dt = (Parse-GermanDate $d) })
                    $emptyRun = 0
                } else {
                    $emptyRun++
                }
                $col += 2
            }

            if ($pairs.Count -eq 0) { continue }

            # Neuestes Datum = belegt, ältere = wunsch
            $sorted = $pairs | Sort-Object { $_.dt } -Descending
            $isFirst = $true

            foreach ($pair in $sorted) {
                $sg = $pair.kunde
                if (-not $sg) { continue }

                # Kontakt anlegen falls neu
                if (-not $contacts.ContainsKey($sg)) {
                    $c = Parse-Contact $sg
                    $contacts[$sg] = [PSCustomObject]@{
                        suchbegriff = $c.suchbegriff
                        typ         = $c.typ
                        bl_wert     = $c.bl_wert
                        notizen     = "PLZ-Import | $($c.suchbegriff)"
                    }
                }

                $status = if ($isFirst) { 'belegt' } else { 'wunsch' }

                $assignments.Add([PSCustomObject]@{
                    plz3        = $plz3
                    plz5        = $plz5
                    suchbegriff = $sg
                    status      = $status
                    datum       = $pair.datum
                    notiz       = "$plzLabel | $($pair.datum)"
                })

                $isFirst = $false
            }
        }
    }

    $wb.Close($false)
    Write-Host "  -> $($assignments.Count) Zuweisungen bisher"
}

$excel.Quit()
[System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null

# ── JSON ausgeben ────────────────────────────────────────────────
$result = [PSCustomObject]@{
    meta = [PSCustomObject]@{
        erstellt    = (Get-Date -Format 'dd.MM.yyyy HH:mm')
        kontakte    = $contacts.Count
        zuweisungen = $assignments.Count
        ignoriert   = $skipped
    }
    contacts    = @($contacts.Values)
    assignments = @($assignments)
}

[System.IO.File]::WriteAllText($OutFile, ($result | ConvertTo-Json -Depth 10), [System.Text.UTF8Encoding]::new($false))
Write-Host "`nFertig!" -ForegroundColor Green
Write-Host "Kontakte   : $($contacts.Count)"
Write-Host "Zuweisungen: $($assignments.Count)"
Write-Host "Ignoriert  : $skipped (keine Farbe)"
Write-Host "JSON       : $OutFile"
