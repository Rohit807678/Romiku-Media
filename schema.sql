-- ================================================
-- ROMIKU MEDIA DATABASE SCHEMA
-- Production-Ready SQLite Schema
-- ================================================

-- Reviews Table
-- Core review data for brands and creators
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK(user_type IN ('creator', 'brand')),
  company_or_channel TEXT,
  email_hash TEXT NOT NULL UNIQUE,  -- SHA-256 hash, never stored raw
  email_encrypted TEXT NOT NULL,    -- Encrypted email, never displayed
  rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
  review_text TEXT NOT NULL,
  approved INTEGER DEFAULT 0,       -- 0=pending, 1=approved, -1=rejected
  flagged INTEGER DEFAULT 0,        -- 0=clean, 1=flagged for review
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  approved_at DATETIME,
  ip_address TEXT,                  -- For spam detection
  user_agent TEXT                   -- For spam detection
);

-- Admin Users Table
-- Staff accounts for review management
CREATE TABLE IF NOT EXISTS admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,      -- Bcrypt hashed
  role TEXT DEFAULT 'moderator' CHECK(role IN ('admin', 'moderator', 'viewer')),
  active INTEGER DEFAULT 1,
  last_login DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Creator Registrations
-- Lead collection for creator sign-ups
CREATE TABLE IF NOT EXISTS creator_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  creator_name TEXT NOT NULL,
  platform TEXT,                    -- instagram, youtube, tiktok, etc.
  niche TEXT,
  followers_subscribers INTEGER,
  profile_links TEXT,               -- JSON array of URLs
  country TEXT,
  additional_notes TEXT,
  status TEXT DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'approved', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);

-- Brand Registrations
-- Lead collection for brand sign-ups
CREATE TABLE IF NOT EXISTS brand_registrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone_number TEXT,
  company_name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  marketing_budget_range TEXT,
  campaign_goal TEXT,
  target_audience TEXT,
  additional_requirements TEXT,
  status TEXT DEFAULT 'new' CHECK(status IN ('new', 'contacted', 'approved', 'rejected')),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ip_address TEXT
);

-- Spam/Abuse Prevention
-- Rate limiting and abuse detection
CREATE TABLE IF NOT EXISTS abuse_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip_address TEXT NOT NULL,
  event_type TEXT NOT NULL,         -- 'review_submission', 'form_submission', etc.
  count INTEGER DEFAULT 1,
  last_attempt DATETIME DEFAULT CURRENT_TIMESTAMP,
  blocked INTEGER DEFAULT 0,
  reason TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Audit Trail
-- Track all administrative actions
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  admin_id INTEGER,
  action TEXT NOT NULL,             -- 'approved_review', 'deleted_review', etc.
  target_id INTEGER,
  target_type TEXT,                 -- 'review', 'user', etc.
  details TEXT,                     -- JSON object with changes
  ip_address TEXT,
  user_agent TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(admin_id) REFERENCES admin_users(id)
);

-- ================================================
-- INDEXES FOR PERFORMANCE
-- ================================================

-- Review indexes
CREATE INDEX IF NOT EXISTS idx_reviews_approved ON reviews(approved);
CREATE INDEX IF NOT EXISTS idx_reviews_user_type ON reviews(user_type);
CREATE INDEX IF NOT EXISTS idx_reviews_created_at ON reviews(created_at);
CREATE INDEX IF NOT EXISTS idx_reviews_email_hash ON reviews(email_hash);
CREATE INDEX IF NOT EXISTS idx_reviews_flagged ON reviews(flagged);

-- Abuse prevention indexes
CREATE INDEX IF NOT EXISTS idx_abuse_log_ip ON abuse_log(ip_address);
CREATE INDEX IF NOT EXISTS idx_abuse_log_last_attempt ON abuse_log(last_attempt);

-- Registration indexes
CREATE INDEX IF NOT EXISTS idx_creator_reg_email ON creator_registrations(email);
CREATE INDEX IF NOT EXISTS idx_creator_reg_status ON creator_registrations(status);
CREATE INDEX IF NOT EXISTS idx_brand_reg_email ON brand_registrations(email);
CREATE INDEX IF NOT EXISTS idx_brand_reg_status ON brand_registrations(status);

-- ================================================
-- VIEWS FOR COMMON QUERIES
-- ================================================

-- Approved reviews for public display (emails never exposed)
CREATE VIEW IF NOT EXISTS public_reviews AS
SELECT 
  id,
  name,
  user_type,
  company_or_channel,
  rating,
  review_text,
  created_at,
  approved_at
FROM reviews
WHERE approved = 1 AND flagged = 0
ORDER BY created_at DESC;

-- Admin dashboard stats
CREATE VIEW IF NOT EXISTS review_stats AS
SELECT 
  COUNT(*) as total_reviews,
  SUM(CASE WHEN approved = 1 THEN 1 ELSE 0 END) as approved_count,
  SUM(CASE WHEN approved = 0 THEN 1 ELSE 0 END) as pending_count,
  SUM(CASE WHEN approved = -1 THEN 1 ELSE 0 END) as rejected_count,
  AVG(rating) as average_rating,
  SUM(CASE WHEN user_type = 'brand' THEN 1 ELSE 0 END) as brand_count,
  SUM(CASE WHEN user_type = 'creator' THEN 1 ELSE 0 END) as creator_count
FROM reviews;

-- ================================================
-- MIGRATION: Load seed data
-- ================================================

-- Insert default admin user (password will be set during initialization)
-- Username: admin
-- Password: (set via environment variable or setup script)
INSERT OR IGNORE INTO admin_users (username, email, password_hash, role) 
VALUES ('admin', 'admin@romikumedia.com', '', 'admin');

-- Insert sample seed reviews (will be migrated from localStorage)
-- These are the existing reviews from the website
INSERT OR IGNORE INTO reviews (
  name, user_type, company_or_channel, email_hash, email_encrypted, 
  rating, review_text, approved, created_at
) VALUES 
('Sarah Kim', 'brand', 'Lumen Beauty', 'hash1', 'enc1', 5, 
 'Romiku Media transformed our influencer strategy. We saw a 340% increase in engagement within the first month. The team is incredibly responsive and data-driven.', 
 1, '2026-05-18'),
('Marcus Reed', 'brand', 'NovaTech', 'hash2', 'enc2', 5,
 'The creator matching is unmatched. Every collaboration felt authentic and drove real results for our brand. Highly recommend for any serious marketer.',
 1, '2026-05-02'),
('Aisha Patel', 'creator', '@aisha.creates', 'hash3', 'enc3', 5,
 'As a creator, Romiku helped me triple my brand deal income in six months. They truly understand both sides of the table. Game-changing agency.',
 1, '2026-04-27'),
('James Liu', 'brand', 'Orbit Apparel', 'hash4', 'enc4', 5,
 'Professional, fast, and data-driven. Romiku is the agency every modern brand needs in their corner. The transparency is next level.',
 1, '2026-04-15'),
('Elena Novak', 'brand', 'Velvet Co.', 'hash5', 'enc5', 4,
 'The transparency and support are excellent. I always know exactly what is happening with my campaigns. Would love even more creator variety, but overall outstanding.',
 1, '2026-04-02'),
('David Torres', 'brand', 'Pulse Fitness', 'hash6', 'enc6', 5,
 'From strategy to execution, Romiku delivers premium quality at startup speed. Our latest campaign exceeded every KPI we set.',
 1, '2026-03-20'),
('Priya Sharma', 'creator', '@priyalifestyle', 'hash7', 'enc7', 5,
 'Finally an agency that treats creators as partners, not just tools. The brand matches are perfect and payments are always on time.',
 1, '2026-03-08'),
('Tom Anderson', 'brand', 'Northwave', 'hash8', 'enc8', 5,
 'We have worked with many agencies. Romiku is in a different league. Their strategic thinking and creator network are exceptional.',
 1, '2026-02-22');
