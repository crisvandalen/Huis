# VPS-inrichting — Hetzner CX23

Gekozen 26-07: Hetzner CX23 (2 vCPU, 4 GB, 40 GB NVMe), Ubuntu 24.04 LTS,
datacenter Falkenstein of Neurenberg. Doel: het brein (Claude Code +
Homey-cloudscripts + dashboard) en later websites.

## 1. Bestellen (console.hetzner.cloud)

- Account aanmaken -> nieuw project (bv. `prive`).
- Server: **CX23**, image **Ubuntu 24.04**, locatie **Falkenstein (fsn1)** of Neurenberg.
- **SSH-key toevoegen** bij het bestellen (niet met wachtwoord werken):
  lokaal `ssh-keygen -t ed25519 -C "cris-vps"` als je er nog geen hebt;
  publieke key = `~/.ssh/id_ed25519.pub`.
- Opties: **Backups aanzetten** (+20%, ~1 euro/mnd). IPv4 aan laten staan.

## 2. Eerste login en basisbeveiliging

```bash
ssh root@<server-ip>
apt update && apt -y upgrade
adduser cris && usermod -aG sudo cris
rsync --archive --chown=cris:cris ~/.ssh /home/cris/   # key meenemen
```

Daarna in `/etc/ssh/sshd_config`: `PermitRootLogin no` en
`PasswordAuthentication no`, dan `systemctl restart ssh`.
Verder inloggen als `cris`.

Firewall (host-niveau):
```bash
sudo apt -y install ufw
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp
sudo ufw enable
```
Tip: zet in de Hetzner-console ook een Cloud Firewall met dezelfde regels.

## 3. Software

```bash
sudo apt -y install git python3 python3-venv curl
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt -y install nodejs
sudo npm install -g @anthropic-ai/claude-code
claude   # eenmalig inloggen/autoriseren
```

## 4. Repo + geheimen overzetten

```bash
# op de VPS
git clone <git-remote> ~/projects/huis && cd ~/projects/huis && npm install
# vanaf de MacBook (geheimen gaan NIET via git):
scp ~/projects/Prive/huis/.env cris@<ip>:~/projects/huis/.env
scp ~/projects/Prive/huis/scripts/homey/.homey-cloud-token.json     cris@<ip>:~/projects/huis/scripts/homey/
```

Check: `node scripts/homey/cloud-test.mjs` -> moet het aantal apparaten tonen.

## 5. Persistentie (zoals op de Capestone-server)

- `tmux` voor interactieve Claude Code-sessies vanaf iPhone/MacBook.
- systemd-timers of cron voor periodieke taken (flow-export, dashboard-build).
- Voorbeeld cron: `crontab -e` -> `0 * * * * cd ~/projects/huis && node scripts/homey/export-flows.mjs`

## 6. Later

- Websites: nginx of Caddy (poort 80/443 staat al open) + Cloudflare ervoor.
- Vault-sync second brain: git of Syncthing (Obsidian Sync draait hier niet).
- Optioneel Tailscale als je SSH niet publiek wilt laten luisteren.

## Checklist na inrichting

- [ ] SSH alleen met key, root-login uit
- [ ] ufw + Hetzner Cloud Firewall actief
- [ ] Backups aan in de console
- [ ] `cloud-test.mjs` draait groen op de VPS
- [ ] Eerste snapshot gemaakt (console -> Snapshots) als schone basis
