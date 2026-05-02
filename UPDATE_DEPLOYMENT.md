# Deployment Update & Maintenance Guide

This guide explains how to redeploy and update both the **CLIKS Backend (CLIKS-BE)** and **CLIKS Frontend (CLIKS-FE)** on your Hetzner server when you add new features or make code modifications.

---

## Part 1: Updating the Backend (CLIKS-BE)

When you make changes to your local backend codebase, follow these steps to upload the changes and restart the application.

### 1. Upload Local Changes
Open your local terminal and run the `rsync` command from your local `CLIKS-BE` project directory:

```bash
# In your local CLIKS-BE directory:
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude '.env' ./ root@204.168.244.118:/var/www/CLIKS-BE/
```

*This updates the server with your latest code but safely leaves the server-side `.env` file and database files untouched.*

### 2. Update Production Dependencies (If any new packages were added)
SSH into your server and install any new NPM packages:

```bash
ssh root@204.168.244.118 "cd /var/www/CLIKS-BE && npm install --omit=dev"
```

### 3. Restart the PM2 Process
To apply the code updates, restart the backend in PM2:

```bash
ssh root@204.168.244.118 "pm2 restart cliks-be"
```

---

## Part 2: Updating the Frontend (CLIKS-FE)

Since your frontend files are on the Hetzner server under `/var/www/cliks-FE`, you have two options to update the frontend.

### Option A: Using Git (Recommended)

If your local changes are pushed to GitHub, simply pull them on the server and rebuild.

```bash
# 1. SSH into the server
ssh root@204.168.244.118

# 2. Go to the frontend folder
cd /var/www/cliks-FE

# 3. Pull latest changes from git
git pull origin main

# 4. Rebuild the frontend
npm run build
```

---

### Option B: Using Rsync (From Local Machine)

If you have not pushed to GitHub, you can rsync the changes directly from your local `CLIKS-FE` directory.

```bash
# 1. In your local CLIKS-FE folder, sync files to the server:
rsync -avz --exclude 'node_modules' --exclude '.git' --exclude '.env' ./ root@204.168.244.118:/var/www/cliks-FE/

# 2. SSH into the server to rebuild the project:
ssh root@204.168.244.118 "cd /var/www/cliks-FE && npm run build"
```

*Because Nginx is already configured to point directly to the `/var/www/cliks-FE/dist` folder, you don't need to restart Nginx when updating frontend files.*

---

## Helpful Commands

### Checking Server Health
You can always verify both the frontend and backend are working by tailing backend logs:

```bash
# Check PM2 backend logs
ssh root@204.168.244.118 "pm2 logs cliks-be"

# Check Nginx status
ssh root@204.168.244.118 "systemctl status nginx"
```
