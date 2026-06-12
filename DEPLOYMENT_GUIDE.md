# 📚 ROMIKU MEDIA — PRODUCTION DEPLOYMENT GUIDE

**Last Updated:** June 9, 2026  
**Version:** 2.0.0 (Production Ready)

---

## 🚀 QUICK START

### Prerequisites
- Node.js 14+ 
- NPM or Yarn
- SQLite3
- Git (for version control)

### Installation

```bash
# 1. Install dependencies
npm install

# 2. Set environment variables
cp .env.example .env
# Edit .env with your configuration

# 3. Run database migrations
npm run seed

# 4. Start the server
npm start
```

**Server will be running on:** `http://localhost:3000`  
**Admin Panel:** `http://localhost:3000/admin.html`  
**Default Admin:** `admin` / `admin123` (change immediately!)

---

## 🔐 SECURITY CONFIGURATION

### Environment Variables (.env)

Create a `.env` file in the root directory:

```bash
# Server
PORT=3000
NODE_ENV=production

# Security
JWT_SECRET=your-super-secure-random-key-here-min-32-chars
ADMIN_PASSWORD=your-secure-admin-password-min-16-chars
CORS_ORIGIN=https://yourdomain.com

# Database
DB_PATH=./data/romiku.db

# Backup (optional)
BACKUP_ENABLED=true
BACKUP_INTERVAL=daily
BACKUP_DESTINATION=s3://your-bucket/backups
```

### Generating Secure Keys

```bash
# Generate JWT secret (minimum 32 characters)
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

# Generate admin password
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

### HTTPS/SSL Configuration

For production, always use HTTPS:

```javascript
// If behind a reverse proxy (nginx, Apache):
app.use(require('trust-proxy')(['loopback', 'linklocal', 'uniquelocal']));

// Let's Encrypt with Certbot:
sudo certbot certonly --standalone -d yourdomain.com
```

---

## 📦 DATABASE SETUP

### SQLite Installation (Development)

```bash
npm install sqlite3
```

### Schema Initialization

The database schema is automatically loaded on first run. To manually initialize:

```bash
sqlite3 data/romiku.db < schema.sql
```

### Backup & Recovery

#### Automated Backups

```bash
# Manual backup
npm run backup

# Outputs: data/backups/romiku-YYYY-MM-DD-HH-mm-ss.db
```

#### Restore from Backup

```bash
cp data/backups/romiku-2026-06-09-14-30-00.db data/romiku.db
npm start
```

---

## 🔧 DEPLOYMENT SCENARIOS

### Scenario 1: Small Business / Development (Single Server)

**Tech Stack:**
- SQLite (file-based database)
- Node.js + Express
- Let's Encrypt SSL
- Nginx reverse proxy

**Setup:**

```bash
# 1. SSH into server
ssh user@yourserver.com

# 2. Clone repository
git clone https://github.com/yourorg/romiku-media.git
cd romiku-media

# 3. Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# 4. Install dependencies
npm install --production

# 5. Create .env file
nano .env
# Add configuration

# 6. Start with PM2
npm install -g pm2
pm2 start server.js --name "romiku-media"
pm2 startup
pm2 save

# 7. Configure Nginx
sudo cp nginx.conf /etc/nginx/sites-available/romiku.conf
sudo ln -s /etc/nginx/sites-available/romiku.conf /etc/nginx/sites-enabled/
sudo systemctl restart nginx

# 8. Set up SSL
sudo certbot certonly --nginx -d yourdomain.com
```

**Nginx Configuration:**

```nginx
upstream romiku_backend {
  server localhost:3000;
  keepalive 64;
}

server {
  listen 80;
  server_name yourdomain.com;
  return 301 https://$server_name$request_uri;
}

server {
  listen 443 ssl http2;
  server_name yourdomain.com;

  ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  ssl_ciphers HIGH:!aNULL:!MD5;
  ssl_prefer_server_ciphers on;

  gzip on;
  gzip_types text/plain text/css application/json application/javascript;

  client_max_body_size 10M;

  location / {
    proxy_pass http://romiku_backend;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }

  location ~* \.(jpg|jpeg|png|gif|ico|css|js)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

---

### Scenario 2: Enterprise / High Traffic (AWS)

**Tech Stack:**
- RDS PostgreSQL (database)
- ECS Fargate (container orchestration)
- Application Load Balancer
- CloudFront CDN
- S3 for backups

**Infrastructure as Code (Terraform):**

```hcl
# AWS RDS PostgreSQL
resource "aws_db_instance" "romiku" {
  identifier     = "romiku-media-db"
  engine         = "postgres"
  engine_version = "14.7"
  instance_class = "db.t3.medium"
  allocated_storage = 100
  
  db_name  = "romiku"
  username = "admin"
  password = random_password.db_password.result

  skip_final_snapshot = false
  backup_retention_period = 30
}

# ECS Fargate Service
resource "aws_ecs_service" "romiku" {
  name            = "romiku-media"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.romiku.arn
  desired_count   = 3
  launch_type     = "FARGATE"

  network_configuration {
    subnets         = aws_subnet.private[*].id
    security_groups = [aws_security_group.ecs.id]
  }
}
```

---

## 📊 MONITORING & MAINTENANCE

### Error Tracking

#### Sentry Setup

```javascript
// In server.js
const Sentry = require("@sentry/node");

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: NODE_ENV,
  tracesSampleRate: 0.1,
});

app.use(Sentry.Handlers.requestHandler());
app.use(Sentry.Handlers.errorHandler());
```

### Logging

#### Winston Logger

```javascript
const winston = require('winston');

const logger = winston.createLogger({
  level: 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
});
```

### Health Checks

```bash
# Health endpoint
curl http://localhost:3000/health

# Response:
# { "status": "ok", "uptime": 3600, "database": "connected" }
```

---

## 🔄 SCALING CONSIDERATIONS

### Horizontal Scaling (Multiple Servers)

**Load Balancer Configuration:**

```javascript
// Sticky sessions for auth tokens
// Session store: Redis (shared across instances)

const redis = require('redis');
const store = require('connect-redis');

const client = redis.createClient({
  host: 'redis-endpoint',
  port: 6379,
});

app.use(session({
  store: new store({ client }),
  secret: process.env.SESSION_SECRET,
  cookie: { secure: true, sameSite: 'strict' }
}));
```

### Database Scaling

#### Read Replicas

```javascript
// Primary DB for writes
const primaryDB = new sqlite3.Database('data/romiku-primary.db');

// Read replicas for queries
const replicaDB = new sqlite3.Database('data/romiku-replica.db');

// Route reads to replica
app.get('/api/reviews', async (req, res) => {
  const reviews = await dbAll(
    'SELECT * FROM public_reviews',
    [],
    replicaDB  // Use replica
  );
  res.json(reviews);
});
```

---

## 🧪 TESTING

### Unit Tests

```bash
npm test
```

### Integration Tests

```bash
npm run test:integration
```

### Load Testing

```bash
# Using Apache Bench
ab -n 1000 -c 10 http://localhost:3000/api/reviews

# Using Artillery
artillery quick --count 100 --num 1000 http://localhost:3000/api/reviews
```

---

## 📋 COMPLIANCE CHECKLIST

### GDPR
- [x] Privacy Policy page
- [x] Data retention policy
- [x] User data export functionality
- [x] User data deletion functionality
- [x] Consent management

### CCPA
- [x] "Do Not Sell" link
- [x] Data collection disclosure
- [x] Consumer rights information

### Security
- [x] SSL/TLS encryption
- [x] Security headers (Helmet)
- [x] CSRF protection
- [x] Rate limiting
- [x] Input validation
- [x] SQL injection prevention (parameterized queries)
- [x] XSS prevention (input sanitization)

### Data Protection
- [x] Email hashing
- [x] Password hashing (bcrypt)
- [x] Secure session management
- [x] Audit logging
- [x] Backup & recovery

---

## 🚨 INCIDENT RESPONSE

### Database Corruption

```bash
# 1. Stop server
pm2 stop romiku-media

# 2. Restore from backup
cp data/backups/romiku-latest.db data/romiku.db

# 3. Verify integrity
sqlite3 data/romiku.db "PRAGMA integrity_check;"

# 4. Restart
pm2 start romiku-media
```

### Security Breach

```bash
# 1. Revoke all tokens
UPDATE admin_users SET last_login = NULL WHERE 1=1;

# 2. Reset admin passwords
# Contact all admins to reset passwords

# 3. Review audit logs
sqlite3 data/romiku.db "SELECT * FROM audit_log WHERE created_at > datetime('now', '-1 hour');"

# 4. Notify affected users
# Send notification emails to all users if data was exposed
```

### DDoS Attack

```bash
# 1. Enable rate limiting (already configured)
# 2. Check nginx logs
tail -f /var/log/nginx/access.log | grep -c "429"

# 3. Block malicious IPs
# Add to Nginx blacklist:
deny 192.0.2.1;

# 4. Restart nginx
sudo systemctl restart nginx
```

---

## 📞 SUPPORT & RESOURCES

### Useful Links
- Node.js Documentation: https://nodejs.org/docs/
- Express.js Guide: https://expressjs.com/
- SQLite Documentation: https://www.sqlite.org/docs.html
- JWT Best Practices: https://tools.ietf.org/html/rfc8949
- OWASP Security Guide: https://owasp.org/

### Contact
- **Email:** support@romikumedia.com
- **Slack:** #romiku-operations
- **On-Call:** Page engineering-oncall

---

## ✅ PRE-LAUNCH CHECKLIST

- [ ] All security headers configured
- [ ] SSL certificate installed
- [ ] Database backups tested
- [ ] Admin users created and passwords changed
- [ ] Rate limiting verified
- [ ] Logging configured
- [ ] Monitoring alerts set up
- [ ] Incident response plan documented
- [ ] GDPR/CCPA compliance verified
- [ ] Load testing completed
- [ ] Staging environment matches production
- [ ] DNS configured
- [ ] CDN configured (if applicable)
- [ ] Email notifications working
- [ ] Backup restoration tested

---

**Deployment ready!** 🎉
