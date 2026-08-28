$ErrorActionPreference = "Stop"
$HUB_LOCAL = Split-Path -Parent $PSScriptRoot
$REMOTE = "huago-cone"
$REMOTE_DIR = "wechat-linux-research/hub"
$TAR = Join-Path $env:TEMP "hub-v01.tar.gz"

Write-Host "== 1. package local hub/ =="
Remove-Item -Force $TAR -ErrorAction SilentlyContinue
tar -czf $TAR -C $HUB_LOCAL --exclude=.git --exclude=data --exclude=logs --exclude=node_modules --exclude=*.tar.gz .

Write-Host "== 2. upload =="
scp $TAR "${REMOTE}:/tmp/hub-v01.tar.gz"

$script = @'
set -e
mkdir -p ~/wechat-linux-research/hub
tar -xzf /tmp/hub-v01.tar.gz -C ~/wechat-linux-research/hub
rm -f /tmp/hub-v01.tar.gz
cd ~/wechat-linux-research/hub
[ -f config/config.json ] || cp config/config.example.json config/config.json
mkdir -p data logs
mkdir -p ~/.config/systemd/user
cp scripts/personal-hub.service ~/.config/systemd/user/personal-hub.service
cp scripts/personal-hub-selftest.service ~/.config/systemd/user/personal-hub-selftest.service
cp scripts/personal-hub-selftest.timer ~/.config/systemd/user/personal-hub-selftest.timer
systemctl --user daemon-reload
systemctl --user enable personal-hub
systemctl --user enable --now personal-hub-selftest.timer
systemctl --user restart personal-hub
sleep 3
systemctl --user status personal-hub --no-pager | head -n 8
'@

Write-Host "== 3. install on remote =="
$script = $script.Replace("`r`n", "`n")
$script | ssh $REMOTE "bash -s"

Write-Host "== done =="
