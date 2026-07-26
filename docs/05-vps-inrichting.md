# VPS-inrichting — Hetzner CX23

Gekozen 26-07: Hetzner CX23 (2 vCPU, 4 GB, 40 GB NVMe), datacenter
Falkenstein/Neurenberg. Doel: het brein (Claude Code + Homey-cloudscripts +
dashboard) en later websites.

> **Uitgevoerd 26-07-2026.** De VPS draait en is ingericht volgens dit
> document. Afwijkingen t.o.v. het oorspronkelijke plan: image is **Ubuntu
> 26.04 LTS** (niet 24.04) en **Node 24** (niet 22 — `homey-api` eist ≥24).
> Zie de checklist onderaan voor de actuele stand.

## 1. Bestellen (console.hetzner.cloud)

- Account aanmaken -> nieuw project (bv. `prive`).
- Server: **CX23**, image **Ubuntu 26.04**, locatie **Falkenstein (fsn1)** of Neurenberg.
- **SSH-key toevoegen** bij het bestellen (niet met wachtwoord werken):
  lokaal `ssh-keygen -t ed25519 -C "cris-vps"` als je er nog geen hebt;
  publieke key = `~/.ssh/id_ed25519.pub`.
- Opties: **Backups aanzetten** (+20%, ~1 euro/mnd). IPv4 aan laten staan.

## 2. Eerste login en basisbeveiliging

```bash
ssh root@<server-ip>
apt update && apt -y upgrade
adduser cris && usermod -aG sudo cris
```

Zorg dat je key ook voor `cris` werkt. Als Hetzner de root-key niet in
`/root/.ssh/authorized_keys` heeft gezet (bij ons was die leeg), zet 'm dan
handmatig voor `cris` — met de juiste rechten, anders weigert ssh 'm:

```bash
install -d -m 700 -o cris -g cris /home/cris/.ssh
echo '<jouw-publieke-key>' > /home/cris/.ssh/authorized_keys
chown cris:cris /home/cris/.ssh/authorized_keys && chmod 600 /home/cris/.ssh/authorized_keys
```

**Test in een tweede venster dat `ssh cris@<ip>` zónder wachtwoord werkt
vóórdat je root uitzet** — anders sluit je jezelf buiten.

SSH-hardening als drop-in (wint van cloud-init doordat `00-` eerst wordt
gelezen):

```bash
sudo tee /etc/ssh/sshd_config.d/00-hardening.conf >/dev/null <<'EOF'
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
EOF
sudo sshd -t && sudo sshd -T | grep -iE '^(passwordauthentication|permitrootlogin) '
sudo systemctl restart ssh
```

Firewall (host-niveau):
```bash
sudo apt -y install ufw
sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp
sudo ufw --force enable
```
Tip: zet in de Hetzner-console ook een Cloud Firewall met dezelfde regels.

## 3. Software

```bash
sudo apt -y install git python3 python3-venv make curl
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt -y install nodejs
sudo npm install -g @anthropic-ai/claude-code
claude   # eenmalig inloggen/autoriseren
```

## 4. Repo + geheimen overzetten

De repo is privé (`crisvandalen/Huis`). De VPS cloont via een eigen **deploy
key** (read-only), niet via je account-key:

```bash
# op de VPS: deploy key maken en tonen
ssh-keygen -t ed25519 -C "vps-huis-deploy" -f ~/.ssh/id_ed25519 -N ""
cat ~/.ssh/id_ed25519.pub
# -> toevoegen op github.com/crisvandalen/Huis/settings/keys (zonder write access)

git clone git@github.com:crisvandalen/Huis.git ~/projects/huis
cd ~/projects/huis && npm install && make setup

# vanaf de MacBook (geheimen gaan NIET via git):
scp ~/projects/Prive/huis/.env cris@<ip>:~/projects/huis/.env
scp ~/projects/Prive/huis/scripts/homey/.homey-cloud-token.json cris@<ip>:~/projects/huis/scripts/homey/
```

Check: `node scripts/homey/cloud-test.mjs` -> moet het aantal apparaten tonen.

## 5. Persistentie

- `tmux` voor interactieve Claude Code-sessies vanaf iPhone/MacBook
  (`tmux new -s huis`, loskoppelen met Ctrl+b d, terug met `tmux attach -t huis`).
- Cron voor de periodieke export + dashboard. **Let op:** op de VPS werkt alleen
  de **cloud**-export (`export-cloud.mjs`); de lokale `make homey` niet (geen
  LAN). Zie `automatiseringen/003-homey-cloud-export.md`.

  ```bash
  crontab -e
  # elk uur: cloud-export + dashboard bouwen
  0 * * * * cd ~/projects/huis && /usr/bin/make cloud-dashboard >> ~/cron-huis.log 2>&1
  ```

## 6. Later

- Websites / dashboard serveren: nginx of Caddy (poort 80/443 staat al open) + Cloudflare ervoor.
- Vault-sync second brain: git of Syncthing (Obsidian Sync draait hier niet).
- Optioneel Tailscale als je SSH niet publiek wilt laten luisteren.

## Checklist na inrichting

- [x] SSH alleen met key, root-login uit
- [x] ufw actief (OpenSSH + 80/443); Hetzner Cloud Firewall optioneel nog te doen
- [ ] Backups aan in de console
- [x] `cloud-test.mjs` draait groen op de VPS (29 apparaten, ook na reboot)
- [ ] Eerste snapshot gemaakt (console -> Snapshots) als schone basis
- [ ] Cron voor `cloud-dashboard` geactiveerd
