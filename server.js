const express = require('express');
const cors = require('cors');
const Database = require('better-sqlite3');
const path = require('path');

const app = express();
app.use(express.json());
app.use(cors());

// Initialize SQLite database (read-only for production)
const DB_PATH = path.join(__dirname, 'data/legal_cases.db');
const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });

console.log('✅ Connected to SQLite database:', DB_PATH);

// Helper: Extract search keywords from user query
function extractSearchTerms(query) {
  if (!query || typeof query !== 'string') return '';

  // Remove special characters and extract meaningful words
  const words = query
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2); // Keep words with 3+ chars

  // Build FTS5 query (OR all terms for better matching)
  return words.join(' OR ');
}

// Helper: Generate process steps from matched cases
function generateStepsFromCases(cases) {
  // Base steps that apply to most legal situations
  const baseSteps = [
    { step: 1, action: "Remain silent", basis: "Article 20(3) - Right against self-incrimination" },
    { step: 2, action: "Demand written grounds of arrest", basis: "Article 22(1) - Constitutional right" },
    { step: 3, action: "Request magistrate inspection within 24 hours", basis: "Article 22(2)" },
    { step: 4, action: "CONSULT LAWYER IMMEDIATELY", basis: "Mandatory for legal protection" }
  ];

  // If we have specific matches, customize step 2 based on first case
  if (cases.length > 0 && cases[0].practical_takeaway) {
    baseSteps[1].action = cases[0].practical_takeaway.substring(0, 100);
  }

  return baseSteps;
}

// Helper: Generate scam patterns from cases
function generateScamPatternsFromCases(cases) {
  const patterns = [];

  // Extract patterns from matched cases
  cases.forEach(caseData => {
    if (caseData.category === 'Police Misconduct' || caseData.category === 'False Arrest') {
      patterns.push({
        name: caseData.category.toUpperCase(),
        indicator: caseData.key_holding ? caseData.key_holding.substring(0, 80) + '...' : 'Check for violations',
        counter: caseData.practical_takeaway || 'Consult lawyer immediately',
        severity: 'CRITICAL'
      });
    }
  });

  // Add default patterns if not enough from cases
  if (patterns.length === 0) {
    patterns.push(
      { name: "NO WARRANT", indicator: "Refuses to show FIR or grounds of arrest", counter: "Demand written grounds (Art 22)", severity: "CRITICAL" },
      { name: "EXTORTION", indicator: "Officer asks for cash to settle", counter: "File FIR under Sec 170 BNS", severity: "CRITICAL" },
      { name: "DELAYED PRODUCTION", indicator: "Not produced before magistrate in 24h", counter: "Demand immediate magistrate inspection", severity: "HIGH" }
    );
  }

  return patterns.slice(0, 3);
}

// Helper: Format case for API response
function formatCase(caseData) {
  return {
    title: caseData.title,
    year: caseData.year,
    holding: caseData.key_holding || caseData.practical_takeaway,
    url: caseData.url
  };
}

// Main API endpoint
app.post('/api/query', (req, res) => {
  try {
    const userQuery = req.body.query || '';
    console.log('📝 Query received:', userQuery);

    // Extract search terms
    const searchTerms = extractSearchTerms(userQuery);
    console.log('🔍 Search terms:', searchTerms);

    let matches = [];

    // Try FTS5 search if we have search terms
    if (searchTerms) {
      try {
        matches = db.prepare(`
          SELECT c.*, rank
          FROM cases_fts
          JOIN cases c ON cases_fts.rowid = c.rowid
          WHERE cases_fts MATCH ?
          ORDER BY rank
          LIMIT 3
        `).all(searchTerms);

        console.log(`✅ Found ${matches.length} matches via FTS5`);
      } catch (ftsError) {
        console.warn('⚠️ FTS5 error, falling back:', ftsError.message);
      }
    }

    // Fallback: Get recent False Arrest cases if no matches
    if (matches.length === 0) {
      matches = db.prepare(`
        SELECT * FROM cases 
        WHERE category = 'False Arrest'
        ORDER BY year DESC
        LIMIT 3
      `).all();

      console.log('🔄 Using fallback: False Arrest cases');
    }

    // Build response
    const response = {
      disclaimer: "⚠️ NOT LEGAL ADVICE",
      process: {
        steps: generateStepsFromCases(matches)
      },
      scamFlags: generateScamPatternsFromCases(matches),
      sources: matches.map(formatCase),
      auditId: `audit_${Date.now()}`
    };

    res.json(response);

  } catch (error) {
    console.error('❌ Error processing query:', error);
    res.status(500).json({
      error: 'Internal server error',
      disclaimer: "⚠️ NOT LEGAL ADVICE - CONSULT LAWYER"
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  try {
    // Verify database connection
    const count = db.prepare('SELECT COUNT(*) as count FROM cases').get();
    res.json({
      status: 'ok',
      database: 'connected',
      cases: count.count
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      database: 'disconnected'
    });
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Closing database connection...');
  db.close();
  process.exit(0);
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`✅ Legal SaaS MVP on http://localhost:${PORT}`);
  console.log(`📊 Database: ${db.prepare('SELECT COUNT(*) as count FROM cases').get().count} cases loaded`);
});
