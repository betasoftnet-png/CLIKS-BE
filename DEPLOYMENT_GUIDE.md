# Hetzner Cloud (CCX23) Deployment Guide

This guide details the steps required to deploy the **Books & Finance API** backend on a Hetzner Cloud `ccx23` dedicated vCPU instance running **Ubuntu 22.04 LTS** or **Ubuntu 24.04 LTS**.

---

## 1. Initial Server Setup & Security

Connect to your server via SSH:

```bash
ssh root@<your-server-ip>
```

### Update System Packages
Keep your OS repositories up to date and install critical system tools:
```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ufw build-essential
```

### Configure the UFW Firewall
Allow only standard and required ports:
```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow http
sudo ufw allow https
sudo ufw --force enable
```

---

## 2. Install Runtime Environment (Node.js & PM2)

The backend requires Node.js v18 or higher. Use the official NodeSource script to install the LTS version:

```bash
# Download and install Node.js LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Verify installation
node -v
npm -v

# Install PM2 Process Manager globally
sudo npm install -g pm2
```

---

## 3. Clone and Setup the Repository

### Create App Directory & Clone Repo
```bash
mkdir -p /var/www
cd /var/www

# Clone your backend repository
git clone <your-repo-url> books-finance-api
cd books-finance-api

# Install production dependencies
npm install --omit=dev
```

### Environment Variables (`.env`)
Create the `.env` file and customize the configurations:
```bash
cp .env.example .env
nano .env
```

Here is a recommended production configuration:

```env
PORT=3000
NODE_ENV=production
CORS_ORIGIN=https://yourdomain.com

# ── Database Choice ─────────────────────────────────────────────────────────
# Option A: Local SQLite Database
DB_TYPE=sqlite
DB_PATH=./db/books_finance.db

# Option B: Local PostgreSQL Database (Alternative)
# DB_TYPE=postgres
# DB_HOST=localhost
# DB_PORT=5432
# DB_USER=books_user
# DB_PASSWORD=your_strong_password_here
# DB_NAME=books_finance

# ── Authentication ──────────────────────────────────────────────────────────
JWT_SECRET=your_32+character_random_jwt_secret_key_here
JWT_REFRESH_SECRET=your_different_random_jwt_refresh_secret_key_here

# ── Redis (optional) ────────────────────────────────────────────────────────
REDIS_ENABLED=false
REDIS_URL=redis://127.0.0.1:6379

# ── Observability ────────────────────────────────────────────────────────────
LOG_LEVEL=info
LOG_REQUESTS=true
SLOW_THRESHOLD_MS=500
```

---

## 4. (Optional) Setup PostgreSQL Database

If you want to use PostgreSQL instead of SQLite, follow these steps to set it up locally:

```bash
# Install PostgreSQL server
sudo apt install -y postgresql postgresql-contrib

# Access psql console
sudo -u postgres psql
```

Inside the PostgreSQL console, create your user and database:
```sql
CREATE DATABASE books_finance;
CREATE USER books_user WITH ENCRYPTED PASSWORD 'your_strong_password_here';
GRANT ALL PRIVILEGES ON DATABASE books_finance TO books_user;
\q
```

*Don't forget to update the `DB_TYPE=postgres` and the respective variables in your `.env` file if using this.*

---

## 5. Running the Application with PM2

Start the API and configure PM2 to keep the process alive across system reboots:

```bash
# Start the backend via PM2
pm2 start index.js --name "books-finance-api"

# Ensure PM2 starts automatically on server startup
pm2 startup

# (Optional) Follow terminal output instructions from the command above to complete startup setup.
# Save current process list
pm2 save
```

### Useful PM2 Commands:
```bash
pm2 logs "books-finance-api"       # View application logs
pm2 status                         # Check API status
pm2 restart "books-finance-api"    # Restart API
```

---

## 6. Reverse Proxy Setup using Nginx

Install and configure Nginx to proxy incoming traffic from your domain to the running backend application (`localhost:3000`).

```bash
# Install Nginx
sudo apt install -y nginx
```

### Create Nginx Server Block
Create a new configuration file for the backend:
```bash
sudo nano /etc/nginx/sites-available/books-finance-api
```

Insert the following server block, replacing `api.yourdomain.com` with your domain:
```nginx
server {
    listen 80;
    server_name api.yourdomain.com;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### Enable Configuration & Test Nginx
```bash
# Link config to enable the site
sudo ln -s /etc/nginx/sites-available/books-finance-api /etc/nginx/sites-enabled/

# Remove default site if present
sudo rm -f /etc/nginx/sites-enabled/default

# Test Nginx configuration for syntax errors
sudo nginx -t

# Restart Nginx
sudo systemctl restart nginx
```

---

## 7. Setup SSL/TLS Certificates (Let's Encrypt Certbot)

To secure your backend with HTTPS, use Let's Encrypt Certbot to automatically fetch and configure an SSL certificate.

```bash
# Install Certbot via Snap
sudo snap install core; sudo snap refresh core
sudo snap install --classic certbot

# Symlink Certbot to make it available as a global command
sudo ln -s /snap/bin/certbot /usr/bin/certbot

# Request SSL Certificate
sudo certbot --nginx -d api.yourdomain.com
```

Certbot will automatically update your Nginx configuration with SSL redirection. Follow the prompts on screen, then test Nginx one last time:

```bash
sudo nginx -t
sudo systemctl restart nginx
```

Your backend is now fully hosted on your **Hetzner ccx23** server securely with HTTPS!
