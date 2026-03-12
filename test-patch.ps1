Import-Module ./src/powershell/ZeroTrustAssessment.psd1 -Force
& (Get-Module ZeroTrustAssessment) {
    if (-not (Get-Item -Path "Function:\Connect-Database_Original" -ErrorAction SilentlyContinue)) {
        Rename-Item "Function:\Connect-Database" "Connect-Database_Original"
        function Connect-Database {
            param ([string]$Path = ":memory:", [switch]$PassThru, [switch]$Transient)
            $db = Connect-Database_Original -Path $Path -PassThru:$PassThru -Transient:$Transient
            try {
                $actualDb = if ($db) { $db } else { $script:_DatabaseConnection }
                if ($actualDb) {
                    Write-Host "PATCH TRIGGERED"
                    $cmd = $actualDb.CreateCommand()
                    $cmd.CommandText = "SET max_memory='500MB';"
                    $null = $cmd.ExecuteNonQuery()
                    $cmd.Dispose()
                }
            } catch { Write-Host "PATCH FAILED: $($_)" }
            if ($PassThru -or $Transient) { return $db }
        }
    }
}
$db = Connect-Database -PassThru -Transient
if ($db) {
    Write-Host "Connected"
    $cmd = $db.CreateCommand()
    $cmd.CommandText = "SELECT current_setting('max_memory');"
    $reader = $cmd.ExecuteReader()
    if ($reader.Read()) {
        Write-Host "DuckDB Max Memory: $($reader.GetString(0))"
    }
    $cmd.Dispose()
    $reader.Dispose()
    # The module has a Disconnect-Database function:
    Disconnect-Database -Database $db -ErrorAction SilentlyContinue
} else {
    Write-Host "Db is null"
}
