const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const cors = require('cors');
const crypto = require('crypto');
const sqlite3 = require('sqlite3').verbose();
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const jwt = require('jsonwebtoken');
const bcryptjs = require('bcryptjs');

// ================================================
// CONFIGURATION
// ================================================

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const DB_PATH = path.join(__dirname, 'data', 'romiku.db');
const DATA_DIR = path.join(__dirname, 'data');
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-change-in-production';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (err) {
    console.error('Error creating data directory:', err.message);
  }
}

// ================================================
// DATABASE INITIALIZATION
// ================================================

let db;

function initDatabase() {
  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Database connection error:', err.message);
        reject(err);
        return;
      }
      console.log('Connected to SQLite database');
      
      // Enable foreign keys
      db.run('PRAGMA foreign_keys = ON', (err) => {
        if (err) {
          console.error('Error enabling foreign keys:', err);
          reject(err);
          return;
        }
        
        // Load schema
        loadSchema()
          .then(() => resolve())
          .catch(reject);
      });
    });
  });
}

async function loadSchema() {
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  return new Promise((resolve, reject) => {
    db.exec(schema, (err) => {
      if (err) {
        console.error('Error loading schema:', err);
        reject(err);
        return;
      }
      console.log('Database schema loaded');
      
      // Initialize default admin user
      initDefaultAdmin().then(resolve).catch(reject);
    });
  });
}

async function initDefaultAdmin() {
  return new Promise((resolve, reject) => {
    const passwordHash = bcryptjs.hashSync(ADMIN_PASSWORD, 10);
    
    db.run(
      'INSERT OR IGNORE INTO admin_users (username, email, password_hash, role) VALUES (?, ?, ?, ?)',
      ['admin', 'admin@romikumedia.com', passwordHash, 'admin'],
      (err) => {
        if (err) {
          console.error('Error initializing admin user:', err);
          reject(err);
          return;
        }
        console.log('Default admin user initialized');
        resolve();
      }
    );
  });
}

// ================================================
// UTILITIES
// ================================================

function hashEmail(email) {
  return crypto.createHash('sha256').update(email.toLowerCase()).digest('hex');
}

function encryptEmail(email) {
  // In production, use proper encryption (e.g., bcrypt or AES)
  return crypto.createHash('sha256').update(email + JWT_SECRET).digest('hex');
}

function maskEmail(email) {
  const [local, domain] = email.split('@');
  return `${local.substring(0, 2)}***@${domain}`;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// ================================================
// MIDDLEWARE
// ================================================

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  frameguard: { action: 'deny' },
  noSniff: true,
  xssFilter: true,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  credentials: true,
  maxAge: 3600,
}));

// Body parser
app.use(express.json({ limit: '10kb' })); // Limit payload size
app.use(express.urlencoded({ limit: '10kb', extended: true }));
app.use(cookieParser());

// Static files
app.use(express.static(__dirname));

// Rate limiting
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

const reviewLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 reviews per hour per IP
  message: 'Too many review submissions from this IP, please try again later.',
  skip: (req) => req.ip === '127.0.0.1', // Skip for localhost
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 login attempts per 15 minutes
  message: 'Too many login attempts, please try again later.',
});

app.use(generalLimiter);

// ================================================
// AUTHENTICATION MIDDLEWARE
// ================================================

function verifyToken(req, res, next) {
  const token = req.cookies.token || req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function verifyAdmin(req, res, next) {
  verifyToken(req, res, () => {
    if (req.user.role !== 'admin' && req.user.role !== 'moderator') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  });
}

// ================================================
// VALIDATION FUNCTIONS
// ================================================

function validateReviewSubmission(data) {
  const errors = [];
  
  if (!data.name || typeof data.name !== 'string' || data.name.trim().length === 0) {
    errors.push('Name is required');
  }
  if (data.name && data.name.length > 100) {
    errors.push('Name must be less than 100 characters');
  }
  
  if (!data.user_type || !['creator', 'brand'].includes(data.user_type)) {
    errors.push('User type must be "creator" or "brand"');
  }
  
  if (data.company_or_channel && data.company_or_channel.length > 150) {
    errors.push('Company/Channel must be less than 150 characters');
  }
  
  if (!data.email || !isValidEmail(data.email)) {
    errors.push('Valid email is required');
  }
  
  if (!data.rating || data.rating < 1 || data.rating > 5) {
    errors.push('Rating must be between 1 and 5');
  }
  
  if (!data.review_text || typeof data.review_text !== 'string' || data.review_text.trim().length === 0) {
    errors.push('Review text is required');
  }
  if (data.review_text && data.review_text.length > 1000) {
    errors.push('Review text must be less than 1000 characters');
  }
  
  return errors.length > 0 ? errors : null;
}

function validateCreatorRegistration(data) {
  const errors = [];
  
  if (!data.full_name || data.full_name.length === 0) {
    errors.push('Full name is required');
  }
  
  if (!data.email || !isValidEmail(data.email)) {
    errors.push('Valid email is required');
  }
  
  if (!data.creator_name || data.creator_name.length === 0) {
    errors.push('Creator name is required');
  }
  
  if (data.phone_number && !isValidPhone(data.phone_number)) {
    errors.push('Invalid phone number');
  }
  
  return errors.length > 0 ? errors : null;
}

function validateBrandRegistration(data) {
  const errors = [];
  
  if (!data.full_name || data.full_name.length === 0) {
    errors.push('Full name is required');
  }
  
  if (!data.email || !isValidEmail(data.email)) {
    errors.push('Valid email is required');
  }
  
  if (!data.company_name || data.company_name.length === 0) {
    errors.push('Company name is required');
  }
  
  if (data.phone_number && !isValidPhone(data.phone_number)) {
    errors.push('Invalid phone number');
  }
  
  return errors.length > 0 ? errors : null;
}

function isValidEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email) && email.length <= 255;
}

function isValidPhone(phone) {
  const phoneRegex = /^\+?[\d\s\-\(\)]{10,20}$/;
  return phoneRegex.test(phone);
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str
    .replace(/[<>]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .slice(0, 1000);
}

// ================================================
// API ROUTES: REVIEWS (PUBLIC)
// ================================================

// Get all approved reviews (public)
app.get('/api/reviews', async (req, res) => {
  try {
    const { filter = 'all', limit = 20, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM public_reviews';
    const params = [];
    
    if (filter === 'creator') {
      query += ' WHERE user_type = ?';
      params.push('creator');
    } else if (filter === 'brand') {
      query += ' WHERE user_type = ?';
      params.push('brand');
    } else if (filter === '5') {
      query += ' WHERE rating = 5';
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(limit) || 20, 100), parseInt(offset) || 0);
    
    const reviews = await dbAll(query, params);
    res.json(reviews);
  } catch (err) {
    console.error('Error fetching reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Get review statistics
app.get('/api/reviews/stats', async (req, res) => {
  try {
    const stats = await dbGet('SELECT * FROM review_stats');
    res.json(stats);
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Submit new review
app.post('/api/reviews', reviewLimiter, async (req, res) => {
  try {
    const { name, user_type, company_or_channel, email, rating, review_text } = req.body;
    
    // Validate input
    const validationErrors = validateReviewSubmission({
      name, user_type, company_or_channel, email, rating, review_text
    });
    
    if (validationErrors) {
      return res.status(400).json({ errors: validationErrors });
    }
    
    // Check for duplicate email
    const existing = await dbGet(
      'SELECT id FROM reviews WHERE email_hash = ? AND created_at > datetime("now", "-7 days")',
      [hashEmail(email)]
    );
    
    if (existing) {
      return res.status(400).json({
        error: 'You have already submitted a review recently. Please try again in 7 days.'
      });
    }
    
    // Sanitize inputs
    const sanitized = {
      name: sanitizeInput(name).trim(),
      user_type,
      company_or_channel: sanitizeInput(company_or_channel || '').trim(),
      email: email.toLowerCase().trim(),
      rating: parseInt(rating),
      review_text: sanitizeInput(review_text).trim(),
    };
    
    // Insert review (starts as pending/unapproved)
    await dbRun(
      `INSERT INTO reviews (
        name, user_type, company_or_channel, email_hash, email_encrypted,
        rating, review_text, approved, ip_address, user_agent
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        sanitized.name,
        sanitized.user_type,
        sanitized.company_or_channel,
        hashEmail(sanitized.email),
        encryptEmail(sanitized.email),
        sanitized.rating,
        sanitized.review_text,
        req.ip,
        req.get('user-agent'),
      ]
    );
    
    // Log submission
    await dbRun(
      'INSERT INTO abuse_log (ip_address, event_type, count) VALUES (?, ?, 1)',
      [req.ip, 'review_submission']
    );
    
    res.status(201).json({
      message: 'Review submitted successfully! It will appear after admin approval.',
      status: 'pending'
    });
  } catch (err) {
    console.error('Error submitting review:', err);
    res.status(500).json({ error: 'Failed to submit review' });
  }
});

// ================================================
// API ROUTES: ADMIN AUTHENTICATION
// ================================================

// Admin login
app.post('/api/admin/login', authLimiter, async (req, res) => {
  try {
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }
    
    const user = await dbGet(
      'SELECT * FROM admin_users WHERE username = ? AND active = 1',
      [username]
    );
    
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    const passwordMatch = bcryptjs.compareSync(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    
    // Generate JWT token
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: '8h' }
    );
    
    // Update last login
    await dbRun(
      'UPDATE admin_users SET last_login = CURRENT_TIMESTAMP WHERE id = ?',
      [user.id]
    );
    
    // Log audit
    await dbRun(
      'INSERT INTO audit_log (admin_id, action, ip_address, user_agent) VALUES (?, ?, ?, ?)',
      [user.id, 'login', req.ip, req.get('user-agent')]
    );
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
    });
    
    res.json({
      message: 'Login successful',
      token,
      user: { id: user.id, username: user.username, role: user.role }
    });
  } catch (err) {
    console.error('Error logging in:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Admin logout
app.post('/api/admin/logout', verifyToken, async (req, res) => {
  res.clearCookie('token');
  res.json({ message: 'Logged out successfully' });
});

// ================================================
// API ROUTES: ADMIN REVIEW MANAGEMENT
// ================================================

// Get all reviews (admin only)
app.get('/api/admin/reviews', verifyAdmin, async (req, res) => {
  try {
    const { status = 'all', limit = 50, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM reviews';
    const params = [];
    
    if (status === 'pending') {
      query += ' WHERE approved = 0';
    } else if (status === 'approved') {
      query += ' WHERE approved = 1';
    } else if (status === 'rejected') {
      query += ' WHERE approved = -1';
    } else if (status === 'flagged') {
      query += ' WHERE flagged = 1';
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(limit) || 50, 500), parseInt(offset) || 0);
    
    const reviews = await dbAll(query, params);
    res.json(reviews);
  } catch (err) {
    console.error('Error fetching admin reviews:', err);
    res.status(500).json({ error: 'Failed to fetch reviews' });
  }
});

// Approve a review
app.put('/api/admin/reviews/:id/approve', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const review = await dbGet('SELECT * FROM reviews WHERE id = ?', [id]);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    await dbRun(
      'UPDATE reviews SET approved = 1, approved_at = CURRENT_TIMESTAMP, flagged = 0 WHERE id = ?',
      [id]
    );
    
    await dbRun(
      'INSERT INTO audit_log (admin_id, action, target_id, target_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'approved_review', id, 'review', req.ip, req.get('user-agent')]
    );
    
    res.json({ message: 'Review approved' });
  } catch (err) {
    console.error('Error approving review:', err);
    res.status(500).json({ error: 'Failed to approve review' });
  }
});

// Reject a review
app.put('/api/admin/reviews/:id/reject', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    const review = await dbGet('SELECT * FROM reviews WHERE id = ?', [id]);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    await dbRun(
      'UPDATE reviews SET approved = -1 WHERE id = ?',
      [id]
    );
    
    await dbRun(
      'INSERT INTO audit_log (admin_id, action, target_id, target_type, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, 'rejected_review', id, 'review', JSON.stringify({ reason }), req.ip, req.get('user-agent')]
    );
    
    res.json({ message: 'Review rejected' });
  } catch (err) {
    console.error('Error rejecting review:', err);
    res.status(500).json({ error: 'Failed to reject review' });
  }
});

// Edit a review
app.put('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, company_or_channel, review_text, rating } = req.body;
    
    const review = await dbGet('SELECT * FROM reviews WHERE id = ?', [id]);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    const updates = [];
    const params = [];
    
    if (name) {
      updates.push('name = ?');
      params.push(sanitizeInput(name));
    }
    if (company_or_channel) {
      updates.push('company_or_channel = ?');
      params.push(sanitizeInput(company_or_channel));
    }
    if (review_text) {
      updates.push('review_text = ?');
      params.push(sanitizeInput(review_text));
    }
    if (rating) {
      updates.push('rating = ?');
      params.push(Math.max(1, Math.min(5, parseInt(rating))));
    }
    
    if (updates.length === 0) {
      return res.status(400).json({ error: 'No updates provided' });
    }
    
    updates.push('updated_at = CURRENT_TIMESTAMP');
    params.push(id);
    
    const query = `UPDATE reviews SET ${updates.join(', ')} WHERE id = ?`;
    await dbRun(query, params);
    
    await dbRun(
      'INSERT INTO audit_log (admin_id, action, target_id, target_type, details, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [req.user.id, 'edited_review', id, 'review', JSON.stringify({ name, company_or_channel, review_text, rating }), req.ip, req.get('user-agent')]
    );
    
    res.json({ message: 'Review updated' });
  } catch (err) {
    console.error('Error updating review:', err);
    res.status(500).json({ error: 'Failed to update review' });
  }
});

// Delete a review
app.delete('/api/admin/reviews/:id', verifyAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    
    const review = await dbGet('SELECT * FROM reviews WHERE id = ?', [id]);
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }
    
    await dbRun('DELETE FROM reviews WHERE id = ?', [id]);
    
    await dbRun(
      'INSERT INTO audit_log (admin_id, action, target_id, target_type, ip_address, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
      [req.user.id, 'deleted_review', id, 'review', req.ip, req.get('user-agent')]
    );
    
    res.json({ message: 'Review deleted' });
  } catch (err) {
    console.error('Error deleting review:', err);
    res.status(500).json({ error: 'Failed to delete review' });
  }
});

// Get review statistics (admin)
app.get('/api/admin/stats', verifyAdmin, async (req, res) => {
  try {
    const stats = await dbGet('SELECT * FROM review_stats');
    res.json(stats);
  } catch (err) {
    console.error('Error fetching stats:', err);
    res.status(500).json({ error: 'Failed to fetch statistics' });
  }
});

// ================================================
// API ROUTES: REGISTRATIONS
// ================================================

// Submit creator registration
app.post('/api/registrations/creator', reviewLimiter, async (req, res) => {
  try {
    const {
      full_name, email, phone_number, creator_name, platform,
      niche, followers_subscribers, profile_links, country, additional_notes
    } = req.body;
    
    const validationErrors = validateCreatorRegistration({
      full_name, email, phone_number, creator_name
    });
    
    if (validationErrors) {
      return res.status(400).json({ errors: validationErrors });
    }
    
    // Check for duplicate
    const existing = await dbGet(
      'SELECT id FROM creator_registrations WHERE email = ?',
      [email.toLowerCase()]
    );
    
    if (existing) {
      return res.status(400).json({
        error: 'This email is already registered. Please use a different email.'
      });
    }
    
    await dbRun(
      `INSERT INTO creator_registrations (
        full_name, email, phone_number, creator_name, platform,
        niche, followers_subscribers, profile_links, country,
        additional_notes, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitizeInput(full_name),
        email.toLowerCase().trim(),
        sanitizeInput(phone_number || ''),
        sanitizeInput(creator_name),
        sanitizeInput(platform || ''),
        sanitizeInput(niche || ''),
        parseInt(followers_subscribers) || 0,
        JSON.stringify(Array.isArray(profile_links) ? profile_links : []),
        sanitizeInput(country || ''),
        sanitizeInput(additional_notes || ''),
        req.ip,
      ]
    );
    
    // Track event for analytics
    await dbRun(
      'INSERT INTO abuse_log (ip_address, event_type) VALUES (?, ?)',
      [req.ip, 'creator_registration']
    );
    
    res.status(201).json({
      message: 'Creator registration submitted successfully! We will review your profile and get back to you shortly.'
    });
  } catch (err) {
    console.error('Error submitting creator registration:', err);
    res.status(500).json({ error: 'Failed to submit registration' });
  }
});

// Submit brand registration
app.post('/api/registrations/brand', reviewLimiter, async (req, res) => {
  try {
    const {
      full_name, email, phone_number, company_name, industry,
      website, marketing_budget_range, campaign_goal, target_audience,
      additional_requirements
    } = req.body;
    
    const validationErrors = validateBrandRegistration({
      full_name, email, phone_number, company_name
    });
    
    if (validationErrors) {
      return res.status(400).json({ errors: validationErrors });
    }
    
    // Check for duplicate
    const existing = await dbGet(
      'SELECT id FROM brand_registrations WHERE email = ?',
      [email.toLowerCase()]
    );
    
    if (existing) {
      return res.status(400).json({
        error: 'This email is already registered. Please use a different email.'
      });
    }
    
    await dbRun(
      `INSERT INTO brand_registrations (
        full_name, email, phone_number, company_name, industry,
        website, marketing_budget_range, campaign_goal, target_audience,
        additional_requirements, ip_address
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        sanitizeInput(full_name),
        email.toLowerCase().trim(),
        sanitizeInput(phone_number || ''),
        sanitizeInput(company_name),
        sanitizeInput(industry || ''),
        sanitizeInput(website || ''),
        sanitizeInput(marketing_budget_range || ''),
        sanitizeInput(campaign_goal || ''),
        sanitizeInput(target_audience || ''),
        sanitizeInput(additional_requirements || ''),
        req.ip,
      ]
    );
    
    // Track event for analytics
    await dbRun(
      'INSERT INTO abuse_log (ip_address, event_type) VALUES (?, ?)',
      [req.ip, 'brand_registration']
    );
    
    res.status(201).json({
      message: 'Brand registration submitted successfully! Our team will contact you with collaboration opportunities.'
    });
  } catch (err) {
    console.error('Error submitting brand registration:', err);
    res.status(500).json({ error: 'Failed to submit registration' });
  }
});

// ================================================
// ERROR HANDLING
// ================================================

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: NODE_ENV === 'production' ? 'Internal server error' : err.message
  });
});

// ================================================
// SERVER STARTUP
// ================================================

async function start() {
  try {
    await ensureDataDir();
    await initDatabase();
    
    app.listen(PORT, () => {
      console.log(`🚀 Romiku Media server running on http://localhost:${PORT}`);
      console.log(`Environment: ${NODE_ENV}`);
      console.log(`Database: ${DB_PATH}`);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }
}

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  db.close(() => {
    console.log('Database closed');
    process.exit(0);
  });
});

module.exports = app;
