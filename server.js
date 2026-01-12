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

// Enhanced stop words for better keyword extraction
const STOP_WORDS = new Set([
  'the', 'is', 'at', 'which', 'on', 'a', 'an', 'and', 'or', 'but', 'in', 'with',
  'to', 'for', 'of', 'as', 'by', 'from', 'this', 'that', 'these', 'those',
  'was', 'were', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'could', 'should', 'may', 'might', 'can', 'am', 'are',
  'what', 'when', 'where', 'who', 'whom', 'how', 'why', 'me', 'my', 'myself',
  'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours', 'yourself'
]);

// Legal domain synonyms for better matching
const SYNONYMS = {
  'arrested': ['detained', 'custody', 'apprehended', 'caught', 'seized'],
  'police': ['cop', 'officer', 'law enforcement', 'constable'],
  'bail': ['release', 'bond', 'surety', 'parole'],
  'warrant': ['order', 'writ', 'authorization'],
  'bribe': ['money', 'extortion', 'corruption', 'payoff'],
  'false': ['fake', 'fabricated', 'wrongful', 'malicious'],
  'lawyer': ['advocate', 'attorney', 'counsel', 'legal advisor'],
  'court': ['magistrate', 'judge', 'tribunal', 'judicial']
};

// Question patterns that need clarification
const CLARIFICATION_PATTERNS = {
  vague: [
    /^help$/i,
    /^what to do$/i,
    /^legal advice$/i,
    /^tell me$/i,
    /^i need help$/i
  ],
  ambiguous: [
    /arrested.*and.*bail/i,  // Multiple topics
    /police.*money.*case/i    // Complex scenario
  ],
  incomplete: [
    /^police$/i,
    /^arrest$/i,
    /^bail$/i,
    /^case$/i
  ]
};

// Helper: Enhanced keyword extraction with stemming and synonyms
function extractSearchTerms(query) {
  if (!query || typeof query !== 'string') return '';

  // Normalize query
  const normalized = query.toLowerCase().trim();

  // Extract words
  const words = normalized
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(word => word.length > 2 && !STOP_WORDS.has(word));

  // Add synonyms for key legal terms
  const expandedWords = [...words];
  words.forEach(word => {
    if (SYNONYMS[word]) {
      expandedWords.push(...SYNONYMS[word]);
    }
  });

  // Deduplicate and build FTS5 query
  const uniqueWords = [...new Set(expandedWords)];

  return uniqueWords.slice(0, 20).join(' OR ');
}

// Helper: Detect if query needs clarification
function needsClarification(query) {
  if (!query || query.trim().length < 3) {
    return {
      needed: true,
      reason: 'empty',
      question: 'Could you please describe your legal situation in more detail?',
      suggestions: [
        'Example: "Police arrested me without showing warrant"',
        'Example: "Bail application was denied"',
        'Example: "Police officer asked for money"'
      ]
    };
  }

  // Check for vague queries
  for (const pattern of CLARIFICATION_PATTERNS.vague) {
    if (pattern.test(query)) {
      return {
        needed: true,
        reason: 'vague',
        question: 'I need more details to help you. Can you describe what happened?',
        suggestions: [
          'Were you arrested? Describe the circumstances',
          'Do you need information about bail?',
          'Are you facing police harassment?'
        ]
      };
    }
  }

  // Check for incomplete queries
  for (const pattern of CLARIFICATION_PATTERNS.incomplete) {
    if (pattern.test(query)) {
      return {
        needed: true,
        reason: 'incomplete',
        question: `Can you provide more context about "${query}"?`,
        suggestions: [
          'What exactly happened?',
          'When did this occur?',
          'What is your main concern?'
        ]
      };
    }
  }

  // Check for ambiguous multi-topic queries
  for (const pattern of CLARIFICATION_PATTERNS.ambiguous) {
    if (pattern.test(query)) {
      return {
        needed: true,
        reason: 'ambiguous',
        question: 'Your query covers multiple topics. Which is your primary concern?',
        suggestions: [
          'Arrest procedures and rights',
          'Bail application process',
          'Police misconduct or harassment'
        ]
      };
    }
  }

  return { needed: false };
}

// Helper: Classify query intent
function classifyIntent(query) {
  const normalized = query.toLowerCase();

  const intents = {
    arrest: ['arrest', 'detained', 'custody', 'apprehended'],
    bail: ['bail', 'release', 'bond', 'surety'],
    police_misconduct: ['bribe', 'extortion', 'torture', 'harassment', 'money'],
    false_accusation: ['false', 'fake', 'fabricated', 'malicious', 'wrongful'],
    legal_procedure: ['court', 'hearing', 'trial', 'chargesheet', 'fir']
  };

  const scores = {};
  for (const [intent, keywords] of Object.entries(intents)) {
    scores[intent] = keywords.filter(kw => normalized.includes(kw)).length;
  }

  const topIntent = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return topIntent[1] > 0 ? topIntent[0] : 'general';
}

// Helper: Generate process steps from matched cases
function generateStepsFromCases(cases, intent) {
  // Base steps that apply to most legal situations
  const baseSteps = [
    { step: 1, action: "Remain silent", basis: "Article 20(3) - Right against self-incrimination" },
    { step: 2, action: "Demand written grounds of arrest", basis: "Article 22(1) - Constitutional right" },
    { step: 3, action: "Request magistrate inspection within 24 hours", basis: "Article 22(2)" },
    { step: 4, action: "CONSULT LAWYER IMMEDIATELY", basis: "Mandatory for legal protection" }
  ];

  // Customize based on intent and matched cases
  if (cases.length > 0) {
    const firstCase = cases[0];

    if (intent === 'bail' && firstCase.practical_takeaway) {
      baseSteps[1] = {
        step: 2,
        action: firstCase.practical_takeaway.substring(0, 150),
        basis: `Based on ${firstCase.title.substring(0, 40)}...`
      };
    } else if (intent === 'police_misconduct' && firstCase.practical_takeaway) {
      baseSteps[2] = {
        step: 3,
        action: firstCase.practical_takeaway.substring(0, 150),
        basis: `Legal remedy: ${firstCase.legal_sections || 'See case for details'}`
      };
    } else if (firstCase.practical_takeaway) {
      baseSteps[1].action = firstCase.practical_takeaway.substring(0, 100);
    }
  }

  return baseSteps;
}

// Helper: Generate scam patterns from cases
function generateScamPatternsFromCases(cases, intent) {
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

  // Intent-specific default patterns
  if (patterns.length === 0) {
    if (intent === 'arrest') {
      patterns.push(
        { name: "NO WARRANT", indicator: "Refuses to show FIR or grounds of arrest", counter: "Demand written grounds (Art 22)", severity: "CRITICAL" },
        { name: "NO LAWYER ACCESS", indicator: "Denies lawyer during interrogation", counter: "Demand lawyer within 3 hours (Sec 50 BNS)", severity: "CRITICAL" }
      );
    } else if (intent === 'police_misconduct') {
      patterns.push(
        { name: "EXTORTION", indicator: "Officer asks for cash to settle", counter: "File FIR under Sec 170 BNS (Report to CBI)", severity: "CRITICAL" },
        { name: "TORTURE", indicator: "Physical abuse during custody", counter: "Get medical exam + FIR against officer", severity: "CRITICAL" }
      );
    } else if (intent === 'bail') {
      patterns.push(
        { name: "UNREASONABLE BAIL", indicator: "Bail amount exceeds financial capacity", counter: "Petition court to modify bail conditions", severity: "HIGH" }
      );
    } else {
      // General defaults
      patterns.push(
        { name: "NO WARRANT", indicator: "Refuses to show FIR or grounds of arrest", counter: "Demand written grounds (Art 22)", severity: "CRITICAL" },
        { name: "EXTORTION", indicator: "Officer asks for cash to settle", counter: "File FIR under Sec 170 BNS", severity: "CRITICAL" },
        { name: "DELAYED PRODUCTION", indicator: "Not produced before magistrate in 24h", counter: "Demand immediate magistrate inspection", severity: "HIGH" }
      );
    }
  }

  return patterns.slice(0, 3);
}

// Helper: Format case for API response
function formatCase(caseData) {
  return {
    title: caseData.title,
    year: caseData.year,
    holding: caseData.key_holding || caseData.practical_takeaway,
    url: caseData.url,
    category: caseData.category
  };
}

// Main API endpoint
app.post('/api/query', (req, res) => {
  try {
    const userQuery = req.body.query || '';
    console.log('📝 Query received:', userQuery);

    // Check if clarification is needed
    const clarification = needsClarification(userQuery);
    if (clarification.needed) {
      console.log('❓ Clarification needed:', clarification.reason);
      return res.json({
        needsClarification: true,
        clarification: {
          question: clarification.question,
          suggestions: clarification.suggestions,
          reason: clarification.reason
        },
        disclaimer: "⚠️ NOT LEGAL ADVICE - Please provide more details"
      });
    }

    // Classify intent
    const intent = classifyIntent(userQuery);
    console.log('🎯 Intent classified:', intent);

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

    // Fallback: Get cases by intent category
    if (matches.length === 0) {
      const categoryMap = {
        arrest: 'False Arrest',
        bail: 'Bail',
        police_misconduct: 'Police Misconduct',
        false_accusation: 'False Arrest',
        legal_procedure: 'Criminal Procedure'
      };

      const category = categoryMap[intent] || 'False Arrest';

      matches = db.prepare(`
        SELECT * FROM cases 
        WHERE category = ?
        ORDER BY year DESC
        LIMIT 3
      `).all(category);

      console.log(`🔄 Using fallback: ${category} cases`);
    }

    // Build response
    const response = {
      disclaimer: "⚠️ NOT LEGAL ADVICE",
      intent: intent,
      process: {
        steps: generateStepsFromCases(matches, intent)
      },
      scamFlags: generateScamPatternsFromCases(matches, intent),
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
  console.log(`🧠 Natural language understanding: ENABLED`);
  console.log(`❓ Clarifying questions: ENABLED`);
});
