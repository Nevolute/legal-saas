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

// Helper: Detect if query is in English
function isEnglish(query) {
  if (!query) return true;

  // Check for non-Latin scripts (Hindi, other Indian languages)
  const devanagariPattern = /[\u0900-\u097F]/; // Hindi/Sanskrit
  const bengaliPattern = /[\u0980-\u09FF]/; // Bengali
  const tamilPattern = /[\u0B80-\u0BFF]/; // Tamil
  const teluguPattern = /[\u0C00-\u0C7F]/; // Telugu
  const gujaratiPattern = /[\u0A80-\u0AFF]/; // Gujarati
  const kannadaPattern = /[\u0C80-\u0CFF]/; // Kannada
  const malayalamPattern = /[\u0D00-\u0D7F]/; // Malayalam
  const punjabiPattern = /[\u0A00-\u0A7F]/; // Punjabi

  if (devanagariPattern.test(query) ||
    bengaliPattern.test(query) ||
    tamilPattern.test(query) ||
    teluguPattern.test(query) ||
    gujaratiPattern.test(query) ||
    kannadaPattern.test(query) ||
    malayalamPattern.test(query) ||
    punjabiPattern.test(query)) {
    return false;
  }

  // Check for common non-English words/patterns
  const commonHindiWords = ['मैं', 'मुझे', 'क्या', 'कैसे', 'कब', 'कहाँ', 'पुलिस', 'गिरफ्तार'];
  const queryLower = query.toLowerCase();

  if (commonHindiWords.some(word => query.includes(word))) {
    return false;
  }

  return true;
}

// Helper: Detect if query is gibberish/nonsensical
function isGibberish(query) {
  if (!query || query.trim().length < 3) return false;

  const normalized = query.toLowerCase().trim();

  // Check 1: Very long word without spaces (likely keyboard mashing)
  const words = normalized.split(/\s+/);
  const hasVeryLongWord = words.some(word => word.length > 25);
  if (hasVeryLongWord) return true;

  // Check 2: Ratio of vowels to consonants (English typically has ~40% vowels)
  const letters = normalized.replace(/[^a-z]/g, '');
  if (letters.length < 3) return false;

  const vowels = letters.match(/[aeiou]/g) || [];
  const vowelRatio = vowels.length / letters.length;

  // If less than 10% vowels or more than 80% vowels, likely gibberish
  if (vowelRatio < 0.1 || vowelRatio > 0.8) return true;

  // Check 3: Repeating character patterns (e.g., "aaaaaa", "asdfasdf")
  const hasRepeatingPattern = /(.)\1{5,}/.test(normalized); // Same char 6+ times
  if (hasRepeatingPattern) return true;

  // Check 4: No recognizable English words (check against common words)
  const commonWords = new Set([
    'the', 'be', 'to', 'of', 'and', 'a', 'in', 'that', 'have', 'i',
    'it', 'for', 'not', 'on', 'with', 'he', 'as', 'you', 'do', 'at',
    'this', 'but', 'his', 'by', 'from', 'they', 'we', 'say', 'her', 'she',
    'or', 'an', 'will', 'my', 'one', 'all', 'would', 'there', 'their',
    // Legal terms
    'police', 'arrest', 'bail', 'court', 'lawyer', 'case', 'law', 'legal',
    'me', 'was', 'is', 'are', 'am', 'been', 'being', 'what', 'when', 'where'
  ]);

  const recognizedWords = words.filter(word =>
    word.length > 2 && commonWords.has(word)
  );

  // If query has 3+ words but no recognized words, it's likely gibberish
  if (words.length >= 3 && recognizedWords.length === 0) return true;

  return false;
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
    arrest: ['arrest', 'detained', 'custody', 'apprehended', 'caught', 'seized'],
    bail: ['bail', 'release', 'bond', 'surety', 'parole'],
    police_misconduct: ['bribe', 'extortion', 'torture', 'harassment', 'money', 'beating', 'abuse'],
    false_accusation: ['false', 'fake', 'fabricated', 'malicious', 'wrongful', 'innocent'],
    legal_procedure: ['court', 'hearing', 'trial', 'chargesheet', 'fir', 'case', 'judge', 'magistrate']
  };

  const scores = {};
  for (const [intent, keywords] of Object.entries(intents)) {
    scores[intent] = keywords.filter(kw => normalized.includes(kw)).length;
  }

  const topIntent = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
  return topIntent[1] > 0 ? topIntent[0] : 'general';
}

// Helper: Check if query is legal-related
function isLegalQuery(query) {
  if (!query) return false;

  const normalized = query.toLowerCase();

  // Legal keywords - comprehensive list
  const legalKeywords = [
    // People/Entities
    'police', 'cop', 'officer', 'constable', 'inspector', 'authority', 'law enforcement',
    'lawyer', 'advocate', 'attorney', 'counsel', 'judge', 'magistrate', 'court',
    // Actions
    'arrest', 'detained', 'custody', 'apprehended', 'caught', 'seized', 'imprisoned',
    'bail', 'release', 'bond', 'surety', 'parole',
    'charge', 'accused', 'defendant', 'plaintiff', 'prosecution', 'defense',
    // Legal concepts
    'fir', 'case', 'complaint', 'chargesheet', 'hearing', 'trial', 'verdict', 'judgment',
    'warrant', 'summon', 'notice', 'subpoena',
    'rights', 'law', 'legal', 'illegal', 'crime', 'criminal', 'offense', 'violation',
    // Specific crimes/issues
    'harassment', 'assault', 'theft', 'robbery', 'fraud', 'cheating', 'forgery',
    'murder', 'rape', 'violence', 'abuse', 'domestic', 'bribe', 'corruption', 'extortion',
    // Legal documents/concepts
    'constitution', 'article', 'section', 'act', 'code', 'ipc', 'bns', 'crpc',
    'innocent', 'guilty', 'evidence', 'witness', 'testimony', 'confession',
    // Legal situations
    'imprisoned', 'jail', 'prison', 'lockup', 'remand', 'custody',
    'investigation', 'interrogation', 'statement',
    'victim', 'accused', 'complainant', 'suspect'
  ];

  // Check if query contains at least one legal keyword
  const hasLegalKeyword = legalKeywords.some(keyword => normalized.includes(keyword));
  if (hasLegalKeyword) return true;

  // Check for common legal question patterns
  const legalPatterns = [
    /can (police|they|i) (arrest|detain|charge)/i,
    /what (are|is) my (rights|right)/i,
    /how (to|do i) (file|lodge|register) (fir|complaint|case)/i,
    /(is it|it is) (legal|illegal|crime|criminal)/i,
    /can i (sue|file case|get bail|appeal)/i,
    /(was|am|been) (arrested|detained|charged|accused)/i,
    /need (lawyer|legal help|legal advice)/i
  ];

  const matchesPattern = legalPatterns.some(pattern => pattern.test(query));
  if (matchesPattern) return true;

  return false;
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

    // Check if query is in English
    if (!isEnglish(userQuery)) {
      console.log('🌐 Non-English language detected');
      return res.json({
        needsClarification: true,
        clarification: {
          question: 'I can only provide guidance in English at this time.',
          suggestions: [
            'Please rephrase your query in English',
            'Example: "Police arrested me without showing warrant"',
            'Example: "Bail application was denied"'
          ],
          reason: 'language',
          message: '🌐 I am currently learning to support multiple Indian languages. For now, please ask your question in English, and I will do my best to help you.'
        },
        disclaimer: "⚠️ NOT LEGAL ADVICE - English queries only"
      });
    }

    // Check if query is gibberish/nonsensical
    if (isGibberish(userQuery)) {
      console.log('🤔 Gibberish input detected');
      return res.json({
        unableToAnswer: true,
        message: {
          title: 'I cannot understand this query.',
          explanation: 'Your input appears to be random characters or nonsensical text. I need a clear description of your legal situation in plain English to help you.',
          suggestions: [
            '🔹 Describe your situation in a complete sentence',
            '🔹 Example: "Police arrested me without showing warrant"',
            '🔹 Example: "My bail application was denied"',
            '🔹 Use normal words to explain what happened'
          ],
          futureNote: '💡 Tip: I work best when you describe your legal issue in simple, clear English sentences.',
          disclaimer: '⚠️ This is NOT legal advice. Always consult a qualified lawyer for your specific situation.'
        },
        auditId: `audit_${Date.now()}`
      });
    }

    // Check if query is actually legal-related
    if (!isLegalQuery(userQuery)) {
      console.log('📚 Non-legal query detected');
      return res.json({
        unableToAnswer: true,
        message: {
          title: 'This doesn\'t appear to be a legal question.',
          explanation: 'I am a specialized legal guidance tool for Indian law. I can only help with legal matters like arrests, bail, police conduct, court procedures, and your legal rights.',
          suggestions: [
            '🔹 I can help with: Police arrests, bail procedures, false accusations',
            '🔹 I can help with: Court hearings, legal rights, FIR filing',
            '🔹 I can help with: Police harassment, legal procedures, criminal cases',
            '🔹 Example: "Police arrested me without showing warrant"',
            '🔹 Example: "How to file FIR for harassment?"'
          ],
          futureNote: '💡 For non-legal questions, please try a general search engine or appropriate specialized service.',
          disclaimer: '⚠️ This tool provides legal information only, not advice on other topics.'
        },
        auditId: `audit_${Date.now()}`
      });
    }

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

    // Final check: If still no matches, return unable-to-answer response
    if (matches.length === 0) {
      console.log('😞 Unable to find relevant cases');
      return res.json({
        unableToAnswer: true,
        message: {
          title: 'I apologize, but I cannot provide specific guidance for your query at this moment.',
          explanation: 'I am still learning and expanding my knowledge base. Your question may be too specific or outside my current expertise.',
          suggestions: [
            '🔹 Try rephrasing your query with more general terms',
            '🔹 Focus on the main legal issue (arrest, bail, police conduct, etc.)',
            '🔹 Consult a qualified lawyer for immediate assistance'
          ],
          futureNote: '📚 I am continuously being updated with more cases and better understanding. Please try again in the future, and I should be able to assist you better.',
          disclaimer: '⚠️ This is NOT legal advice. Always consult a qualified lawyer for your specific situation.'
        },
        auditId: `audit_${Date.now()}`
      });
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
